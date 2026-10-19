// Command seed prepares the offline CLI demo workspace with realistic dispute
// data. It targets the shared "demo" merchant, exactly like the original script.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
	"github.com/Ejicode/dispute-autopilot/internal/vault"
)

func main() {
	config.LoadEnvFiles()
	mode := config.MustApplicationMode()
	ctx, err := scope.With(context.Background(), "demo", mode, nil)
	if err != nil {
		log.Fatalf("seed: %v", err)
	}
	if err := runtime.RequireDemo(ctx); err != nil {
		log.Fatalf("seed: %v", err)
	}
	if err := seed(ctx); err != nil {
		log.Fatalf("seed failed: %v", err)
	}
	log.Print("Seeding complete: 2 active disputes, 2 orders, 6 vault items created.")
}

func seed(ctx context.Context) error {
	db, err := store.Merchant(ctx)
	if err != nil {
		return err
	}

	for _, statement := range []string{
		"DELETE FROM approval_operations",
		"DELETE FROM paypal_captures",
		"DELETE FROM paypal_dispute_versions",
		"DELETE FROM webhook_inbox",
		"DELETE FROM approvals",
		"DELETE FROM ai_drafts",
		"DELETE FROM evidence_items",
		"DELETE FROM disputes",
		"DELETE FROM demo_orders",
		"DELETE FROM paypal_events",
		"DELETE FROM audit_log",
	} {
		if _, err := db.Exec(ctx, statement); err != nil {
			return err
		}
	}

	now := time.Now()

	// 1. Demo order 1 — high-value tech gadget.
	const order1ID = "ord_101"
	const order1Number = "ORD-2026-98214"
	const tracking1 = "TRK-98214-USPS"
	order1Items := compactJSON([]orderItem{{Name: "UltraHD 4K Drone Pro", Quantity: 1, UnitPriceCents: 124000, SKU: "DRONE-4K-PRO"}})
	if _, err := db.Exec(ctx, `INSERT INTO demo_orders (
		id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency,
		paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		order1ID, order1Number, "Jordan Miller", "jordan.miller@example.com",
		"742 Evergreen Terrace, Springfield, OR 97477", order1Items, 124000, "USD",
		"PP-ORDER-98214", "USPS", tracking1, "DELIVERED",
		isoAgoDays(now, 4), isoAgoDays(now, 7)); err != nil {
		return err
	}

	captured := capture{ctx: ctx}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order1ID),
		EvidenceType: string(types.EvidenceOrderConfirmation),
		Source:       "STOREFRONT_GATEWAY",
		Title:        "Itemized Order Confirmation & Payment Receipt",
		Content: prettyJSON(orderConfirmation1{
			OrderNumber:     order1Number,
			BuyerName:       "Jordan Miller",
			Email:           "jordan.miller@example.com",
			ShippingAddress: "742 Evergreen Terrace, Springfield, OR 97477",
			TotalCents:      124000,
			Currency:        "USD",
			PaymentMethod:   "PayPal Express Checkout",
			TransactionID:   "9XY88192031124",
			SKU:             "DRONE-4K-PRO",
			Timestamp:       isoAgoDays(now, 7),
		}),
	}); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order1ID),
		EvidenceType: string(types.EvidenceTrackingHistory),
		Source:       "CARRIER_SIMULATOR",
		Title:        "Carrier Shipment Tracking Log (USPS)",
		Content: prettyJSON(trackingHistory{
			Carrier:        "USPS Priority Mail Express",
			TrackingNumber: tracking1,
			Status:         "DELIVERED",
			Events: []trackingEvent{
				{Status: "LABEL_CREATED", Timestamp: isoAgoDays(now, 6), Location: "Portland, OR"},
				{Status: "PICKED_UP", Timestamp: isoAgoDays(now, 5.8), Location: "Portland, OR"},
				{Status: "IN_TRANSIT", Timestamp: isoAgoDays(now, 5), Location: "Eugene Sorting Hub, OR"},
				{Status: "OUT_FOR_DELIVERY", Timestamp: isoAgoDays(now, 4.2), Location: "Springfield, OR"},
				{Status: "DELIVERED", Timestamp: isoAgoDays(now, 4), Location: "Springfield, OR", SignedBy: "J. MILLER"},
			},
			Label: "DEMO DATA - CARRIER SIMULATOR",
		}),
	}); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order1ID),
		EvidenceType: string(types.EvidenceProofOfDelivery),
		Source:       "CARRIER_SIMULATOR",
		Title:        "Carrier Electronic Proof of Delivery & Signature",
		Content: prettyJSON(proofOfDelivery{
			Carrier:            "USPS Priority Mail Express",
			TrackingNumber:     tracking1,
			DeliveryAddress:    "742 Evergreen Terrace, Springfield, OR 97477",
			DeliveredAt:        isoAgoDays(now, 4),
			RecipientSignature: "J. MILLER (SIGNATURE_VERIFIED)",
			GPSCoordinates:     "44.0462° N, 123.0220° W",
			Label:              "DEMO DATA - CARRIER SIMULATOR",
		}),
	}); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order1ID),
		EvidenceType: string(types.EvidenceRefundPolicy),
		Source:       "STOREFRONT_TERMS",
		Title:        "Merchant Terms of Sale & Fulfillment Policy",
		Content:      "All orders over $750 require adult signature confirmation. Tracking details automatically transmitted to customer email upon carrier intake.",
	}); err != nil {
		return err
	}

	// Dispute 1 — the $1,240 hero case expiring in 36 hours.
	const dispute1ID = "dsp_hero_1240"
	dispute1 := types.Dispute{
		ID:               dispute1ID,
		PayPalDisputeID:  "PP-D-99214",
		TransactionID:    "9XY88192031124",
		OrderID:          types.NullString(order1ID),
		Reason:           string(types.ReasonNotReceived),
		AmountCents:      124000,
		Currency:         "USD",
		Status:           string(types.StatusRequiredAction),
		ResponseDeadline: isoAheadHours(now, 36),
		Outcome:          types.NullString("PENDING"),
		StrengthScore:    100,
		Recommendation:   string(types.RecommendFight),
		CreatedAt:        isoAgoHours(now, 12),
		UpdatedAt:        isoAgoHours(now, 12),
	}
	if err := insertDispute(ctx, db, dispute1); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, "UPDATE evidence_items SET dispute_id = ? WHERE order_id = ?", dispute1ID, order1ID); err != nil {
		return err
	}
	evidence1, err := vault.EvidenceForDispute(ctx, dispute1ID)
	if err != nil {
		return err
	}
	if _, err := ai.GenerateCitedDraft(ctx, dispute1, evidence1,
		`Buyer stated: "Package never arrived at my address. Requesting full refund."`); err != nil {
		return err
	}
	if _, err := store.Audit(ctx, "paypal", "DISPUTE_SYNCHRONIZED", map[string]any{
		"dispute_id":        dispute1ID,
		"paypal_dispute_id": dispute1.PayPalDisputeID,
		"amount_cents":      124000,
		"source":            "PAYPAL_SANDBOX_WEBHOOK",
	}, ptr(dispute1ID)); err != nil {
		return err
	}

	// 2. Dispute 2 — $185 SNAD dispute expiring in 44 hours.
	const order2ID = "ord_102"
	const tracking2 = "TRK-55219-FEDEX"
	order2Items := compactJSON([]orderItem{{Name: "Wireless Ergonomic Keyboard", Quantity: 1, UnitPriceCents: 18500, SKU: "KEY-ERG-01"}})
	if _, err := db.Exec(ctx, `INSERT INTO demo_orders (
		id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency,
		paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		order2ID, "ORD-2026-55219", "Morgan Chen", "morgan.chen@example.com",
		"450 Mission St, San Francisco, CA 94105", order2Items, 18500, "USD",
		"PP-ORDER-55219", "FedEx", tracking2, "DELIVERED",
		isoAgoDays(now, 3), isoAgoDays(now, 6)); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order2ID),
		EvidenceType: string(types.EvidenceOrderConfirmation),
		Source:       "STOREFRONT_GATEWAY",
		Title:        "Keyboard Purchase Invoice",
		Content: compactJSON(orderConfirmation2{
			OrderNumber:     "ORD-2026-55219",
			BuyerName:       "Morgan Chen",
			AmountCents:     18500,
			Currency:        "USD",
			ShippingAddress: "450 Mission St, San Francisco, CA 94105",
		}),
	}); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order2ID),
		EvidenceType: string(types.EvidenceRefundPolicy),
		Source:       "STOREFRONT_TERMS",
		Title:        "Hardware Return Guidelines",
		Content:      "Items must be returned in original packaging with serial number intact.",
	}); err != nil {
		return err
	}

	const dispute2ID = "dsp_snad_185"
	dispute2 := types.Dispute{
		ID:               dispute2ID,
		PayPalDisputeID:  "PP-D-55219",
		TransactionID:    "8TY441992010",
		OrderID:          types.NullString(order2ID),
		Reason:           string(types.ReasonNotAsDescribed),
		AmountCents:      18500,
		Currency:         "USD",
		Status:           string(types.StatusRequiredAction),
		ResponseDeadline: isoAheadHours(now, 44),
		Outcome:          types.NullString("PENDING"),
		StrengthScore:    80,
		Recommendation:   string(types.RecommendFight),
		CreatedAt:        isoAgoHours(now, 8),
		UpdatedAt:        isoAgoHours(now, 8),
	}
	if err := insertDispute(ctx, db, dispute2); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, "UPDATE evidence_items SET dispute_id = ? WHERE order_id = ?", dispute2ID, order2ID); err != nil {
		return err
	}
	evidence2, err := vault.EvidenceForDispute(ctx, dispute2ID)
	if err != nil {
		return err
	}
	if _, err := ai.GenerateCitedDraft(ctx, dispute2, evidence2,
		`Buyer stated: "Keycaps feel slightly different from what I expected."`); err != nil {
		return err
	}
	return nil
}

// capture bubbles evidence-capture errors out of the seed flow.
type capture struct{ ctx context.Context }

func (c capture) add(params vault.AddParams) error {
	_, err := vault.AddToVault(c.ctx, params)
	return err
}

func insertDispute(ctx context.Context, db *store.Store, dispute types.Dispute) error {
	_, err := db.Exec(ctx, `INSERT INTO disputes (
		id, paypal_dispute_id, transaction_id, order_id, reason, amount_cents, currency, status,
		response_deadline, outcome, strength_score, recommendation, created_at, updated_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		dispute.ID, dispute.PayPalDisputeID, dispute.TransactionID, dispute.OrderID.Str(),
		dispute.Reason, dispute.AmountCents, dispute.Currency, dispute.Status,
		dispute.ResponseDeadline, dispute.Outcome.Str(), dispute.StrengthScore, dispute.Recommendation,
		dispute.CreatedAt, dispute.UpdatedAt)
	return err
}

func ptr(value string) *string { return &value }

func isoAgoDays(now time.Time, days float64) string {
	return config.FormatISO(now.Add(-time.Duration(days * 24 * float64(time.Hour))))
}

func isoAgoHours(now time.Time, hours float64) string {
	return config.FormatISO(now.Add(-time.Duration(hours * float64(time.Hour))))
}

func isoAheadHours(now time.Time, hours float64) string {
	return config.FormatISO(now.Add(time.Duration(hours * float64(time.Hour))))
}

// compactJSON encodes without HTML escaping, matching JSON.stringify(v).
func compactJSON(v any) string {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(v); err != nil {
		log.Fatalf("seed: encode: %v", err)
	}
	return string(bytes.TrimRight(buf.Bytes(), "\n"))
}

// prettyJSON encodes with 2-space indentation and no HTML escaping, matching
// JSON.stringify(v, null, 2).
func prettyJSON(v any) string {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(v); err != nil {
		log.Fatalf("seed: encode: %v", err)
	}
	return string(bytes.TrimRight(buf.Bytes(), "\n"))
}

type orderItem struct {
	Name           string `json:"name"`
	Quantity       int    `json:"quantity"`
	UnitPriceCents int64  `json:"unit_price_cents"`
	SKU            string `json:"sku"`
}

type orderConfirmation1 struct {
	OrderNumber     string `json:"order_number"`
	BuyerName       string `json:"buyer_name"`
	Email           string `json:"email"`
	ShippingAddress string `json:"shipping_address"`
	TotalCents      int64  `json:"total_cents"`
	Currency        string `json:"currency"`
	PaymentMethod   string `json:"payment_method"`
	TransactionID   string `json:"transaction_id"`
	SKU             string `json:"sku"`
	Timestamp       string `json:"timestamp"`
}

type trackingEvent struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Location  string `json:"location"`
	SignedBy  string `json:"signed_by,omitempty"`
}

type trackingHistory struct {
	Carrier        string          `json:"carrier"`
	TrackingNumber string          `json:"tracking_number"`
	Status         string          `json:"status"`
	Events         []trackingEvent `json:"events"`
	Label          string          `json:"label"`
}

type proofOfDelivery struct {
	Carrier            string `json:"carrier"`
	TrackingNumber     string `json:"tracking_number"`
	DeliveryAddress    string `json:"delivery_address"`
	DeliveredAt        string `json:"delivered_at"`
	RecipientSignature string `json:"recipient_signature"`
	GPSCoordinates     string `json:"gps_coordinates"`
	Label              string `json:"label"`
}

type orderConfirmation2 struct {
	OrderNumber     string `json:"order_number"`
	BuyerName       string `json:"buyer_name"`
	AmountCents     int64  `json:"amount_cents"`
	Currency        string `json:"currency"`
	ShippingAddress string `json:"shipping_address"`
}
