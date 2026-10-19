package paypal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
	"github.com/Ejicode/dispute-autopilot/internal/vault"
)

// Notification is a realtime event queued by a projection.
type Notification struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

// Projection is the outcome of applying one provider event.
type Projection struct {
	Ignored       bool           `json:"ignored,omitempty"`
	DisputeID     string         `json:"disputeId,omitempty"`
	Created       bool           `json:"created,omitempty"`
	Notifications []Notification `json:"notifications"`
}

var statusMap = map[string]string{
	"OPEN":                        string(types.StatusUnderReview),
	"WAITING_FOR_SELLER_RESPONSE": string(types.StatusRequiredAction),
	"WAITING_FOR_BUYER_RESPONSE":  string(types.StatusUnderReview),
	"UNDER_REVIEW":                string(types.StatusUnderReview),
	"RESOLVED":                    string(types.StatusResolved),
	"CLOSED":                      string(types.StatusClosed),
	"REQUIRED_ACTION":             string(types.StatusRequiredAction),
}

func terminalStatus(status string) bool {
	return status == string(types.StatusResolved) || status == string(types.StatusClosed)
}

func refreshDraft(ctx context.Context, disputeID string, notifications *[]Notification) error {
	db, err := store.Merchant(ctx)
	if err != nil {
		return err
	}
	dispute, err := store.ScanDispute(db.QueryRow(ctx, "SELECT "+store.DisputeColumns+" FROM disputes WHERE id=?", disputeID))
	if err != nil {
		return err
	}
	evidenceRows, err := db.Query(ctx,
		"SELECT "+store.EvidenceColumns+" FROM evidence_items WHERE dispute_id=? OR order_id=? ORDER BY captured_at, id",
		disputeID, dispute.OrderID.Str())
	if err != nil {
		return err
	}
	evidence, err := store.ScanEvidenceRows(evidenceRows)
	if err != nil {
		return err
	}
	triage := ai.CalculateEvidenceStrength(dispute.Reason, evidence)
	if _, err := db.Exec(ctx, "UPDATE disputes SET strength_score=?, recommendation=? WHERE id=?", triage.Score, triage.Recommendation, disputeID); err != nil {
		return err
	}
	dispute.StrengthScore = int64(triage.Score)
	dispute.Recommendation = triage.Recommendation
	if !terminalStatus(dispute.Status) {
		draft, err := ai.PersistCitedDraft(ctx, dispute, evidence, ai.GenerateDeterministicDraft(dispute, evidence, ""), false)
		if err != nil {
			return err
		}
		*notifications = append(*notifications, Notification{Type: "DRAFT_GENERATED", Payload: draft})
	}
	return nil
}

func projectDispute(ctx context.Context, event types.PayPalWebhookEvent) (Projection, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return Projection{}, err
	}
	sc, _ := scope.From(ctx)
	provenance := string(config.ProvenanceFor(sc.Mode))
	resource := event.Resource
	notifications := []Notification{}

	providerID, err := Identifier(resource["dispute_id"], "dispute ID")
	if err != nil {
		return Projection{}, err
	}

	versionSource := any(event.CreateTime)
	if v, present := resource["update_time"]; present && v != nil {
		versionSource = v
	}
	version, err := Timestamp(versionSource)
	if err != nil {
		return Projection{}, err
	}

	status := ""
	if event.EventType == "CUSTOMER.DISPUTE.RESOLVED" {
		status = string(types.StatusResolved)
	} else if s, ok := resource["status"].(string); ok {
		status = statusMap[s]
	}
	if status == "" {
		return Projection{}, invalid("Unsupported or missing dispute status.")
	}

	var outcome *string
	if raw, present := resource["dispute_outcome"]; present {
		obj, ok := Object(raw)
		if !ok {
			return Projection{}, invalid("Invalid dispute outcome.")
		}
		code, ok := obj["outcome_code"].(string)
		if !ok || !codePattern.MatchString(code) {
			return Projection{}, invalid("Invalid dispute outcome.")
		}
		outcome = &code
	}

	if raw, present := resource["seller_response_due_date"]; present && raw != nil && raw != "" {
		if _, err := Timestamp(raw); err != nil {
			return Projection{}, err
		}
	}

	var amountCents int64
	var amountCurrency string
	hasAmount := false
	if raw, present := resource["dispute_amount"]; present {
		amountCents, amountCurrency, err = Money(raw)
		if err != nil {
			return Projection{}, err
		}
		hasAmount = true
	}

	reasonStr := ""
	reasonPresent := false
	if raw, present := resource["reason"]; present {
		s, ok := raw.(string)
		if !ok || !codePattern.MatchString(s) {
			return Projection{}, invalid("Invalid dispute reason.")
		}
		reasonStr = s
		reasonPresent = true
	}

	current, err := scanDisputeOpt(ctx, db, "SELECT "+store.DisputeColumns+" FROM disputes WHERE paypal_dispute_id=?", providerID)
	if err != nil {
		return Projection{}, err
	}
	if current != nil && current.Provenance != provenance {
		return Projection{}, invalid("Dispute provenance does not match this environment.")
	}

	var previousMs int64
	previousExists := true
	if err := db.QueryRow(ctx, "SELECT provider_updated_ms FROM paypal_dispute_versions WHERE paypal_dispute_id=?", providerID).Scan(&previousMs); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			previousExists = false
		} else {
			return Projection{}, err
		}
	}

	if current != nil && event.EventType == "CUSTOMER.DISPUTE.CREATED" {
		return Projection{Ignored: true, DisputeID: current.ID, Notifications: notifications}, nil
	}
	if current != nil && terminalStatus(current.Status) && !terminalStatus(status) {
		return Projection{Ignored: true, DisputeID: current.ID, Notifications: notifications}, nil
	}
	if current != nil && previousExists && version == previousMs && terminalStatus(current.Status) && terminalStatus(status) {
		currentOutcome := current.Outcome.Str()
		if current.Status != status || (outcome != nil && currentOutcome != "" && currentOutcome != "PENDING" && *outcome != currentOutcome) {
			return Projection{}, invalid("Conflicting terminal states at the same provider timestamp require reconciliation.")
		}
		if outcome == nil || currentOutcome == *outcome {
			return Projection{Ignored: true, DisputeID: current.ID, Notifications: notifications}, nil
		}
	}
	if current != nil && previousExists && version == previousMs && !terminalStatus(status) {
		deadlineChanged := false
		if raw, present := resource["seller_response_due_date"]; present {
			if s, ok := raw.(string); ok && s != "" {
				dms, err := Timestamp(raw)
				if err != nil {
					return Projection{}, err
				}
				curMs, curErr := parseTimestamp(current.ResponseDeadline)
				deadlineChanged = curErr != nil || dms != curMs
			} else {
				deadlineChanged = current.ResponseDeadline != ""
			}
		}
		if current.Status != status || deadlineChanged ||
			(hasAmount && (amountCents != current.AmountCents || amountCurrency != current.Currency)) ||
			(reasonPresent && reasonStr != current.Reason) {
			return Projection{}, invalid("Conflicting dispute states at the same provider timestamp require reconciliation.")
		}
	}
	if previousExists && (version < previousMs || (version == previousMs && !terminalStatus(status))) {
		id := ""
		if current != nil {
			id = current.ID
		}
		return Projection{Ignored: true, DisputeID: id, Notifications: notifications}, nil
	}
	if current == nil && event.EventType != "CUSTOMER.DISPUTE.CREATED" {
		return Projection{}, missingDep("Dispute creation has not arrived yet.")
	}

	created := current == nil
	now := config.NowISO()

	if current == nil {
		transactions, _ := resource["disputed_transactions"].([]any)
		var txRaw any
		if len(transactions) > 0 {
			if first, ok := transactions[0].(map[string]any); ok {
				txRaw = first["seller_transaction_id"]
			}
		}
		transactionID, err := Identifier(txRaw, "seller transaction ID")
		if err != nil {
			return Projection{}, err
		}
		if !hasAmount || !reasonPresent {
			return Projection{}, invalid("Dispute amount and reason are required.")
		}
		var orderID any
		var foundOrder string
		err = db.QueryRow(ctx, `SELECT id FROM demo_orders
			WHERE (id=(SELECT order_id FROM paypal_captures WHERE capture_id=?) OR paypal_order_id=?) AND provenance=? LIMIT 1`,
			transactionID, transactionID, provenance).Scan(&foundOrder)
		if err == nil {
			orderID = foundOrder
		} else if !errors.Is(err, sql.ErrNoRows) {
			return Projection{}, err
		}
		id := "dsp_" + store.RandomHex(16)
		deadline := ""
		if raw, present := resource["seller_response_due_date"]; present {
			if s, ok := raw.(string); ok {
				deadline = s
			}
		}
		var outcomeVal any
		if outcome != nil {
			outcomeVal = *outcome
		}
		if _, err := db.Exec(ctx, `INSERT INTO disputes(id,paypal_dispute_id,transaction_id,order_id,reason,amount_cents,currency,status,response_deadline,outcome,created_at,updated_at,provenance)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			id, providerID, transactionID, orderID, reasonStr, amountCents, amountCurrency, status, deadline, outcomeVal, now, now, provenance); err != nil {
			return Projection{}, err
		}
		if orderID != nil {
			if err := vault.LinkOrderEvidence(ctx, orderID.(string), id); err != nil {
				return Projection{}, err
			}
		}
		fetched, err := fetchDispute(ctx, db, id)
		if err != nil {
			return Projection{}, err
		}
		current = &fetched
	} else {
		deadline := current.ResponseDeadline
		if raw, present := resource["seller_response_due_date"]; present {
			if s, ok := raw.(string); ok {
				deadline = s
			} else {
				deadline = ""
			}
		}
		var newOutcome any
		if outcome != nil {
			newOutcome = *outcome
		} else if current.Outcome.Str() == "PENDING" {
			newOutcome = nil
		} else if current.Outcome.Valid {
			newOutcome = current.Outcome.Str()
		}
		newAmount := current.AmountCents
		newCurrency := current.Currency
		if hasAmount {
			newAmount = amountCents
			newCurrency = amountCurrency
		}
		newReason := current.Reason
		if reasonPresent {
			newReason = reasonStr
		}
		if _, err := db.Exec(ctx, `UPDATE disputes SET status=?, outcome=?, response_deadline=?, amount_cents=?, currency=?, reason=?, updated_at=? WHERE id=?`,
			status, newOutcome, deadline, newAmount, newCurrency, newReason, now, current.ID); err != nil {
			return Projection{}, err
		}
		if _, err := db.Exec(ctx, "UPDATE ai_drafts SET verified=0 WHERE dispute_id=?", current.ID); err != nil {
			return Projection{}, err
		}
	}

	if _, err := db.Exec(ctx, `INSERT INTO paypal_dispute_versions VALUES(?,?,?) ON CONFLICT(paypal_dispute_id) DO UPDATE SET provider_updated_ms=excluded.provider_updated_ms,last_event_id=excluded.last_event_id`,
		providerID, version, event.ID); err != nil {
		return Projection{}, err
	}
	if err := refreshDraft(ctx, current.ID, &notifications); err != nil {
		return Projection{}, err
	}
	updated, err := fetchDispute(ctx, db, current.ID)
	if err != nil {
		return Projection{}, err
	}
	disputeID := current.ID
	if _, err := store.Audit(ctx, "paypal", "DISPUTE_WEBHOOK_APPLIED", map[string]any{
		"event_id":          event.ID,
		"paypal_dispute_id": providerID,
		"status":            updated.Status,
		"outcome":           updated.Outcome.Ptr(),
	}, &disputeID); err != nil {
		return Projection{}, err
	}
	notificationType := "DISPUTE_OPENED"
	if terminalStatus(updated.Status) {
		notificationType = "PAYPAL_API_RESOLVED"
	}
	notifications = append(notifications, Notification{Type: notificationType, Payload: updated})
	return Projection{DisputeID: current.ID, Created: created, Notifications: notifications}, nil
}

func projectCapture(ctx context.Context, event types.PayPalWebhookEvent) (Projection, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return Projection{}, err
	}
	sc, _ := scope.From(ctx)
	provenance := string(config.ProvenanceFor(sc.Mode))
	resource := event.Resource
	notifications := []Notification{}

	captureID, err := Identifier(resource["id"], "capture ID")
	if err != nil {
		return Projection{}, err
	}
	amountCents, currency, err := Money(resource["amount"])
	if err != nil {
		return Projection{}, err
	}
	if raw, present := resource["status"]; present && raw != "COMPLETED" {
		return Projection{}, invalid("Capture is not completed.")
	}
	if raw, present := resource["create_time"]; present {
		if _, err := Timestamp(raw); err != nil {
			return Projection{}, err
		}
	}
	providerOrderID := ""
	if supp, ok := Object(resource["supplementary_data"]); ok {
		if rel, ok := Object(supp["related_ids"]); ok {
			if raw, present := rel["order_id"]; present {
				providerOrderID, err = Identifier(raw, "provider order ID")
				if err != nil {
					return Projection{}, err
				}
			}
		}
	}

	var createTime any
	if raw, present := resource["create_time"]; present {
		createTime = raw
	}
	contentBytes, err := json.Marshal(map[string]any{
		"capture_id":   captureID,
		"amount_cents": amountCents,
		"currency":     currency,
		"status":       "COMPLETED",
		"create_time":  createTime,
	})
	if err != nil {
		return Projection{}, err
	}
	content := string(contentBytes)
	hash := vault.CalculateSHA256(content)

	var existingHash string
	var existingProviderOrder sql.NullString
	err = db.QueryRow(ctx, "SELECT content_hash, paypal_order_id FROM paypal_captures WHERE capture_id=?", captureID).
		Scan(&existingHash, &existingProviderOrder)
	if err == nil {
		if existingHash != hash || (existingProviderOrder.Valid && providerOrderID != "" && existingProviderOrder.String != providerOrderID) {
			return Projection{}, invalid("Conflicting capture facts require reconciliation.")
		}
		return Projection{Ignored: true, Notifications: notifications}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Projection{}, err
	}

	var orderIDPtr *string
	if providerOrderID != "" {
		var id string
		if err := db.QueryRow(ctx, "SELECT id FROM demo_orders WHERE paypal_order_id=? AND provenance=?", providerOrderID, provenance).Scan(&id); err == nil {
			orderIDPtr = &id
		} else if !errors.Is(err, sql.ErrNoRows) {
			return Projection{}, err
		}
	}

	legacy, legacyErr := store.ScanEvidenceRow(db.QueryRow(ctx, `SELECT `+store.EvidenceColumns+` FROM evidence_items
		WHERE source='PAYMENT_CAPTURE_WEBHOOK'
		AND json_extract(CASE WHEN json_valid(content) THEN content ELSE '{}' END,'$.capture_id')=? LIMIT 1`, captureID))
	if legacyErr != nil && !errors.Is(legacyErr, sql.ErrNoRows) {
		return Projection{}, legacyErr
	}

	var evidence types.EvidenceItem
	if legacyErr == nil {
		if legacy.Provenance != provenance {
			return Projection{}, invalid("Legacy capture provenance requires reconciliation.")
		}
		var value map[string]any
		if err := json.Unmarshal([]byte(legacy.Content), &value); err != nil {
			return Projection{}, invalid("Legacy capture evidence requires reconciliation.")
		}
		legacyAmount, amountOK := value["amount_cents"].(float64)
		legacyCurrency, currencyOK := value["currency"].(string)
		if !amountOK || int64(legacyAmount) != amountCents || !currencyOK || legacyCurrency != currency ||
			vault.CalculateSHA256(legacy.Content) != legacy.SHA256Hash {
			return Projection{}, invalid("Legacy capture evidence requires reconciliation.")
		}
		evidence = legacy
		if orderIDPtr != nil && !legacy.OrderID.Valid {
			if _, err := db.Exec(ctx, "UPDATE evidence_items SET order_id=? WHERE id=?", *orderIDPtr, legacy.ID); err != nil {
				return Projection{}, err
			}
		}
	} else {
		publish := false
		evidence, err = vault.AddToVault(ctx, vault.AddParams{
			OrderID:      orderIDPtr,
			EvidenceType: "ORDER_CONFIRMATION",
			Source:       "PAYMENT_CAPTURE_WEBHOOK",
			Title:        "Payment Capture " + captureID,
			Content:      content,
			Publish:      &publish,
			Provenance:   provenance,
		})
		if err != nil {
			return Projection{}, err
		}
		notifications = append(notifications, Notification{Type: "VAULT_ITEM_ADDED", Payload: evidence})
	}

	var providerOrderVal any
	if providerOrderID != "" {
		providerOrderVal = providerOrderID
	}
	var orderVal any
	if orderIDPtr != nil {
		orderVal = *orderIDPtr
	}
	if _, err := db.Exec(ctx, "INSERT INTO paypal_captures VALUES(?,?,?,?,?)", captureID, providerOrderVal, orderVal, evidence.ID, hash); err != nil {
		return Projection{}, err
	}

	if orderIDPtr != nil {
		rows, err := db.Query(ctx, "SELECT id FROM disputes WHERE transaction_id=? AND order_id IS NULL AND provenance=?", captureID, provenance)
		if err != nil {
			return Projection{}, err
		}
		disputeIDs, err := scanStrings(rows)
		if err != nil {
			return Projection{}, err
		}
		for _, disputeID := range disputeIDs {
			if _, err := db.Exec(ctx, "UPDATE disputes SET order_id=?, updated_at=? WHERE id=?", *orderIDPtr, config.NowISO(), disputeID); err != nil {
				return Projection{}, err
			}
			if err := vault.LinkOrderEvidence(ctx, *orderIDPtr, disputeID); err != nil {
				return Projection{}, err
			}
			if err := refreshDraft(ctx, disputeID, &notifications); err != nil {
				return Projection{}, err
			}
		}
	}
	return Projection{Notifications: notifications}, nil
}

// ProjectWebhook applies one provider event. It performs only synchronous local
// work; callers wrap it in a SQLite transaction.
func ProjectWebhook(ctx context.Context, event types.PayPalWebhookEvent) (Projection, error) {
	switch event.EventType {
	case "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED":
		return projectDispute(ctx, event)
	case "PAYMENT.CAPTURE.COMPLETED":
		return projectCapture(ctx, event)
	default:
		return Projection{Ignored: true, Notifications: []Notification{}}, nil
	}
}

func scanDisputeOpt(ctx context.Context, db *store.Store, query string, args ...any) (*types.Dispute, error) {
	d, err := store.ScanDispute(db.QueryRow(ctx, query, args...))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &d, nil
}

func scanStrings(rows *sql.Rows) ([]string, error) {
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}
