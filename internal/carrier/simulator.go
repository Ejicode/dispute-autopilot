// Package carrier simulates carrier transit milestones and records every event
// in the Evidence Vault with full chain-of-custody. It is a faithful port of
// src/lib/carrier/simulator.ts.
package carrier

import (
	"bytes"
	"context"
	"encoding/json"
	"math/rand"
	"net/http"
	"strconv"
	"strings"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
	"github.com/Ejicode/dispute-autopilot/internal/vault"
)

// milestoneOrder is the canonical carrier transit progression.
var milestoneOrder = []string{
	"LABEL_CREATED",
	"PICKED_UP",
	"IN_TRANSIT",
	"OUT_FOR_DELIVERY",
	"DELIVERED",
}

// CarrierMilestone is a single carrier transit event (src/lib/carrier/simulator.ts).
type CarrierMilestone struct {
	Status      string  `json:"status"`
	Location    string  `json:"location"`
	Description string  `json:"description"`
	Timestamp   string  `json:"timestamp"`
	SignedBy    *string `json:"signed_by,omitempty"`
}

// milestoneEvent is the persisted vault event. It extends CarrierMilestone with
// the internal gps_verified flag the simulator adds on delivery.
type milestoneEvent struct {
	CarrierMilestone
	GPSVerified bool `json:"gps_verified,omitempty"`
}

// trackingPayload is the JSON snapshot archived in the vault.
type trackingPayload struct {
	Carrier        string           `json:"carrier"`
	TrackingNumber any              `json:"tracking_number"`
	Status         string           `json:"status"`
	Events         []milestoneEvent `json:"events"`
	DeliveredAt    any              `json:"delivered_at"`
	Source         string           `json:"source"`
}

// Carrier-realistic milestone descriptions.
var milestoneDescriptions = map[string]func(carrier string) string{
	"LABEL_CREATED":    func(c string) string { return "Shipment label created by merchant. " + c + " awaiting package pickup." },
	"PICKED_UP":        func(c string) string { return "Package accepted at " + c + " origin facility." },
	"IN_TRANSIT":       func(c string) string { return "Package in transit through " + c + " regional distribution network." },
	"OUT_FOR_DELIVERY": func(c string) string { return "Package loaded for delivery on " + c + " route." },
	"DELIVERED":        func(c string) string { return "Package delivered and confirmed by " + c + " delivery agent." },
}

var milestoneLocations = map[string]string{
	"LABEL_CREATED":    "Merchant Fulfillment Center",
	"PICKED_UP":        "Origin Post Office",
	"IN_TRANSIT":       "Regional Distribution Hub",
	"OUT_FOR_DELIVERY": "Local Delivery Station",
	"DELIVERED":        "Delivery Address — Front Door",
}

// GenerateTrackingNumber builds a demo tracking number in the TRK-{num}-{carrier}
// shape used by the TypeScript simulator.
func GenerateTrackingNumber(carrier string) string {
	num := 100000000 + rand.Intn(900000000)
	return "TRK-" + strconv.Itoa(num) + "-" + carrier
}

// AdvanceCarrierStatus progresses an order through carrier transit milestones.
// It returns the full demo_orders row (with items parsed from its JSON string)
// and the resulting delivery status.
func AdvanceCarrierStatus(ctx context.Context, orderID string, targetStatus *string) (map[string]any, error) {
	if err := runtime.RequireDemo(ctx); err != nil {
		return nil, err
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}

	var (
		resultOrder map[string]any
		newStatus   string
		evidence    *types.EvidenceItem
		drafts      []types.AIDraft
	)

	err = db.WithTx(ctx, func(ctx context.Context) error {
		order, err := queryOrder(ctx, db, "SELECT * FROM demo_orders WHERE id = ?", orderID)
		if err != nil {
			return err
		}
		if order == nil {
			return httpx.Errorf(http.StatusNotFound, "Order not found")
		}

		current, _ := order["delivery_status"].(string)
		currentIndex := indexOf(milestoneOrder, current)
		var next string
		switch {
		case targetStatus != nil && *targetStatus != "":
			next = *targetStatus
		case currentIndex < len(milestoneOrder)-1:
			next = milestoneOrder[currentIndex+1]
		default:
			next = "DELIVERED"
		}
		if currentIndex < 0 || !contains(milestoneOrder, next) {
			return httpx.Errorf(http.StatusBadRequest, "Invalid carrier status")
		}
		if indexOf(milestoneOrder, next) < currentIndex {
			return httpx.Errorf(http.StatusConflict, "Carrier status cannot move backwards")
		}
		if next == current {
			resultOrder = order
			newStatus = next
			return nil
		}

		now := config.NowISO()
		carrier := "USPS"
		if c, ok := order["carrier"].(string); ok && c != "" {
			carrier = c
		}

		var deliveredAt *string
		if s, ok := order["delivered_at"].(string); ok && s != "" {
			deliveredAt = &s
		}
		if next == "DELIVERED" && deliveredAt == nil {
			n := now
			deliveredAt = &n
		}
		var deliveredVal any
		if deliveredAt != nil {
			deliveredVal = *deliveredAt
		}

		if _, err := db.Exec(ctx, `UPDATE demo_orders
			SET delivery_status = ?, delivered_at = ?
			WHERE id = ?`, next, deliveredVal, orderID); err != nil {
			return err
		}

		// Build carrier event with professional language.
		location := milestoneLocations[next]
		if location == "" {
			location = "In Transit"
		}
		describe, ok := milestoneDescriptions[next]
		description := "Status: " + next
		if ok {
			description = describe(carrier)
		}

		event := milestoneEvent{CarrierMilestone: CarrierMilestone{
			Status:      next,
			Location:    location,
			Description: description,
			Timestamp:   now,
		}}
		if next == "DELIVERED" {
			buyerName, _ := order["buyer_name"].(string)
			signature := buyerName + " — Signature Captured"
			event.SignedBy = &signature
			event.GPSVerified = true
		}

		// Snapshot tracking history into the vault.
		payload := trackingPayload{
			Carrier:        carrier,
			TrackingNumber: order["tracking_number"],
			Status:         next,
			Events:         []milestoneEvent{event},
			DeliveredAt:    deliveredVal,
			Source:         "CARRIER_SIMULATOR",
		}
		content, err := marshalIndent(payload)
		if err != nil {
			return err
		}

		evidenceType := "TRACKING_HISTORY"
		if next == "DELIVERED" {
			evidenceType = "PROOF_OF_DELIVERY"
		}
		publish := false
		item, err := vault.AddToVault(ctx, vault.AddParams{
			OrderID:      &orderID,
			EvidenceType: evidenceType,
			Source:       "CARRIER_SIMULATOR",
			Title:        carrier + " Update: " + strings.ReplaceAll(next, "_", " "),
			Content:      content,
			Publish:      &publish,
		})
		if err != nil {
			return err
		}
		evidence = &item

		if _, err := store.Audit(ctx, "system", "CARRIER_MILESTONE_UPDATED", map[string]any{
			"order_id":        orderID,
			"tracking_number": order["tracking_number"],
			"carrier":         carrier,
			"status":          next,
			"location":        location,
		}, nil); err != nil {
			return err
		}

		// Keep terminal cases and frozen approval snapshots untouched.
		rows, err := db.Query(ctx, `SELECT `+store.DisputeColumns+` FROM disputes WHERE order_id=? AND status='REQUIRED_ACTION'
			AND NOT EXISTS (SELECT 1 FROM approval_operations WHERE dispute_id=disputes.id)
			AND NOT EXISTS (SELECT 1 FROM approvals WHERE dispute_id=disputes.id AND decision='APPROVED')`, orderID)
		if err != nil {
			return err
		}
		disputes := []types.Dispute{}
		for rows.Next() {
			dispute, err := store.ScanDispute(rows)
			if err != nil {
				rows.Close()
				return err
			}
			disputes = append(disputes, dispute)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()

		for _, dispute := range disputes {
			items, err := vault.EvidenceForDispute(ctx, dispute.ID)
			if err != nil {
				return err
			}
			triage := ai.CalculateEvidenceStrength(dispute.Reason, items)
			if _, err := db.Exec(ctx, "UPDATE disputes SET strength_score=?, recommendation=?, updated_at=? WHERE id=?",
				triage.Score, triage.Recommendation, now, dispute.ID); err != nil {
				return err
			}
			output := ai.GenerateDeterministicDraft(dispute, items, "")
			draft, err := ai.PersistCitedDraft(ctx, dispute, items, output, false)
			if err != nil {
				return err
			}
			drafts = append(drafts, draft)
		}

		updated, err := queryOrder(ctx, db, "SELECT * FROM demo_orders WHERE id = ?", orderID)
		if err != nil {
			return err
		}
		resultOrder = updated
		newStatus = next
		return nil
	})
	if err != nil {
		return nil, err
	}

	if evidence != nil {
		realtime.Default().Publish(ctx, "VAULT_ITEM_ADDED", *evidence)
		for _, draft := range drafts {
			realtime.Default().Publish(ctx, "DRAFT_GENERATED", draft)
		}
		realtime.Default().Publish(ctx, "CARRIER_UPDATE", resultOrder)
	}
	return map[string]any{"order": resultOrder, "newStatus": newStatus}, nil
}

// queryOrder runs a SELECT * against demo_orders and returns the row as a map
// with items parsed from its JSON string. It returns (nil, nil) when no row
// matches.
func queryOrder(ctx context.Context, db *store.Store, query string, args ...any) (map[string]any, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return nil, nil
	}

	values := make([]any, len(columns))
	ptrs := make([]any, len(columns))
	for i := range values {
		ptrs[i] = &values[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	order := make(map[string]any, len(columns))
	for i, column := range columns {
		order[column] = values[i]
	}
	if raw, ok := order["items"].(string); ok {
		if raw == "" {
			raw = "[]"
		}
		var parsed any
		if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
			return nil, err
		}
		order["items"] = parsed
	}
	return order, nil
}

// marshalIndent renders JSON like JSON.stringify(value, null, 2): no HTML
// escaping, two-space indentation, no trailing newline.
func marshalIndent(v any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}

func indexOf(values []string, target string) int {
	for i, value := range values {
		if value == target {
			return i
		}
	}
	return -1
}

func contains(values []string, target string) bool { return indexOf(values, target) >= 0 }
