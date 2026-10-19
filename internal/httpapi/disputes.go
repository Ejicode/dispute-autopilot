package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/approvals"
	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
	"github.com/Ejicode/dispute-autopilot/internal/vault"
)

var currencyCodePattern = regexp.MustCompile(`^[A-Z]{3}$`)

var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

var supportedReasons = map[string]bool{
	"MERCHANDISE_OR_SERVICE_NOT_RECEIVED":     true,
	"MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": true,
	"UNAUTHORISED":            true,
	"INCORRECT_AMOUNT":        true,
	"DUPLICATE_TRANSACTION":   true,
	"BUYER_CANCELLED_SERVICE": true,
	"OTHER":                   true,
}

func mustJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(data)
}

func boolPtr(value bool) *bool { return &value }

func nonNilClaims(claims []types.Claim) []types.Claim {
	if claims == nil {
		return []types.Claim{}
	}
	return claims
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// safeInt mirrors Number.isSafeInteger for JSON-decoded numbers.
func safeInt(value any) (int64, bool) {
	switch n := value.(type) {
	case int64:
		return n, true
	case float64:
		if math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) || math.Abs(n) >= 9007199254740992 {
			return 0, false
		}
		return int64(n), true
	}
	return 0, false
}

func (a *API) disputesList(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	rows, err := queryMaps(r.Context(), db, `SELECT * FROM disputes
		ORDER BY CASE status WHEN 'REQUIRED_ACTION' THEN 1 WHEN 'UNDER_REVIEW' THEN 2 ELSE 3 END,
		amount_cents DESC, response_deadline ASC`)
	if err != nil {
		return err
	}
	now := config.NowMillis()
	in48Hours := now + 48*3600*1000
	var totalAtRisk int64
	expiring := 0
	required := 0
	for _, dispute := range rows {
		status := stringValue(dispute["status"])
		if status == string(types.StatusRequiredAction) || status == string(types.StatusUnderReview) {
			totalAtRisk += intValue(dispute["amount_cents"])
			required++
			deadline := parseISOMillis(stringValue(dispute["response_deadline"]))
			if deadline != 0 && deadline <= in48Hours && deadline >= now {
				expiring++
			}
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"disputes": rows,
		"metrics": map[string]any{
			"totalAtRiskCents":    totalAtRisk,
			"expiring48hCount":    expiring,
			"requiredActionCount": required,
			"totalCount":          len(rows),
		},
	})
	return nil
}

func (a *API) disputesCreate(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	if err := runtime.RequireDemo(r.Context()); err != nil {
		return err
	}
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	body, err := auth.ReadAuthBody(r, 16384)
	if err != nil {
		return err
	}
	for _, key := range []string{"paypal_dispute_id", "transaction_id", "order_id", "buyer_name", "shipping_address", "buyer_message"} {
		if _, present := body[key]; present {
			limit := 1000
			if key == "buyer_message" {
				limit = 4000
			}
			value, err := auth.Field(body, key, limit)
			if err != nil {
				return err
			}
			body[key] = value
		}
	}
	if raw, present := body["reason"]; present {
		reason, ok := raw.(string)
		if !ok || !supportedReasons[reason] {
			return httpx.Errorf(http.StatusBadRequest, "Invalid dispute reason")
		}
	}
	if raw, present := body["amount_cents"]; present {
		amount, ok := safeInt(raw)
		if !ok || amount <= 0 || amount > 100000000 {
			return httpx.Errorf(http.StatusBadRequest, "Invalid amount_cents")
		}
	}
	if raw, present := body["hours_until_deadline"]; present {
		hours, ok := raw.(float64)
		if !ok || math.IsNaN(hours) || math.IsInf(hours, 0) || hours <= 0 || hours > 2160 {
			return httpx.Errorf(http.StatusBadRequest, "Invalid deadline")
		}
	}
	if raw, present := body["currency"]; present {
		currency, ok := raw.(string)
		if !ok || !currencyCodePattern.MatchString(currency) {
			return httpx.Errorf(http.StatusBadRequest, "Invalid currency")
		}
	}

	disputeID := "dsp_" + store.RandomHex(8)
	paypalDisputeID, _ := body["paypal_dispute_id"].(string)
	if paypalDisputeID == "" {
		paypalDisputeID = "PP-D-" + store.RandomHex(8)
	}
	transactionID, _ := body["transaction_id"].(string)
	if transactionID == "" {
		transactionID = "TXN-" + store.RandomHex(8)
	}
	var orderID *string
	if value, ok := body["order_id"].(string); ok && value != "" {
		orderID = &value
	}
	if orderID != nil {
		found, err := queryMap(r.Context(), db, "SELECT id FROM demo_orders WHERE id = ?", *orderID)
		if err != nil {
			return err
		}
		if found == nil {
			return &rawResponse{status: http.StatusNotFound, body: map[string]any{"error": "Order not found"}}
		}
	}
	reason := "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
	if value, ok := body["reason"].(string); ok {
		reason = value
	}
	amountCents := int64(12000)
	if value, ok := safeInt(body["amount_cents"]); ok {
		amountCents = value
	}
	currency := "USD"
	if value, ok := body["currency"].(string); ok {
		currency = value
	}
	hoursLeft := 36.0
	if value, ok := body["hours_until_deadline"].(float64); ok {
		hoursLeft = value
	}
	deadline := config.FormatISO(time.Now().Add(time.Duration(hoursLeft*3600*1000) * time.Millisecond))
	now := config.NowISO()

	var events []types.EvidenceItem
	var result map[string]any
	if err := db.WithTx(r.Context(), func(ctx context.Context) error {
		existing, err := queryMap(ctx, db, "SELECT id FROM disputes WHERE paypal_dispute_id=?", paypalDisputeID)
		if err != nil {
			return err
		}
		if existing != nil {
			return httpx.Errorf(http.StatusConflict, "Dispute already exists")
		}
		var orderValue any
		if orderID != nil {
			orderValue = *orderID
		}
		if _, err := db.Exec(ctx, `INSERT INTO disputes (
			id, paypal_dispute_id, transaction_id, order_id, reason, amount_cents, currency, status,
			response_deadline, outcome, strength_score, recommendation, created_at, updated_at
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			disputeID, paypalDisputeID, transactionID, orderValue, reason, amountCents, currency,
			string(types.StatusRequiredAction), deadline, "PENDING", 0, string(types.RecommendAskHuman), now, now); err != nil {
			return err
		}
		if orderID != nil {
			if err := vault.LinkOrderEvidence(ctx, *orderID, disputeID); err != nil {
				return err
			}
		} else {
			buyerName, _ := body["buyer_name"].(string)
			if buyerName == "" {
				buyerName = "Sandbox Customer"
			}
			shippingAddress, _ := body["shipping_address"].(string)
			if shippingAddress == "" {
				shippingAddress = "123 Market St, San Jose, CA 95113"
			}
			publish := false
			item, err := vault.AddToVault(ctx, vault.AddParams{
				DisputeID:    &disputeID,
				EvidenceType: "ORDER_CONFIRMATION",
				Source:       "STOREFRONT_CHECKOUT",
				Title:        "Checkout Receipt for " + transactionID,
				Content: mustJSON(map[string]any{
					"transaction_id":   transactionID,
					"amount_cents":     amountCents,
					"currency":         currency,
					"buyer_name":       buyerName,
					"shipping_address": shippingAddress,
					"created_at":       now,
				}),
				Publish: &publish,
			})
			if err != nil {
				return err
			}
			events = append(events, item)
		}
		evidenceItems, err := vault.EvidenceForDispute(ctx, disputeID)
		if err != nil {
			return err
		}
		triage := ai.CalculateEvidenceStrength(reason, evidenceItems)
		if _, err := db.Exec(ctx, "UPDATE disputes SET strength_score = ?, recommendation = ? WHERE id = ?",
			triage.Score, triage.Recommendation, disputeID); err != nil {
			return err
		}
		updated, err := store.ScanDispute(db.QueryRow(ctx, "SELECT "+store.DisputeColumns+" FROM disputes WHERE id = ?", disputeID))
		if err != nil {
			return err
		}
		draft, err := ai.PersistCitedDraft(ctx, updated, evidenceItems, ai.GenerateDeterministicDraft(updated, evidenceItems, ""), false)
		if err != nil {
			return err
		}
		if _, err := store.Audit(ctx, "paypal", "DISPUTE_SIMULATED_OPENED", map[string]any{
			"dispute_id":        disputeID,
			"paypal_dispute_id": paypalDisputeID,
			"amount_cents":      amountCents,
			"reason":            reason,
		}, &disputeID); err != nil {
			return err
		}
		result = map[string]any{"dispute": updated, "draft": draft, "evidenceCount": len(evidenceItems)}
		return nil
	}); err != nil {
		return err
	}
	for _, item := range events {
		realtime.Default().Publish(r.Context(), "VAULT_ITEM_ADDED", item)
	}
	realtime.Default().Publish(r.Context(), "DRAFT_GENERATED", result["draft"])
	realtime.Default().Publish(r.Context(), "DISPUTE_OPENED", result["dispute"])
	httpx.JSON(w, http.StatusOK, result)
	return nil
}

func (a *API) disputeDetail(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	lookup := r.PathValue("id")
	disputeRow, err := queryMap(r.Context(), db, "SELECT * FROM disputes WHERE id = ? OR paypal_dispute_id = ?", lookup, lookup)
	if err != nil {
		return err
	}
	if disputeRow == nil {
		return &rawResponse{status: http.StatusNotFound, body: map[string]any{"error": "Dispute not found"}}
	}
	disputeID := stringValue(disputeRow["id"])
	orderID := stringValue(disputeRow["order_id"])

	evidenceItems, err := queryMaps(r.Context(), db,
		"SELECT * FROM evidence_items WHERE dispute_id = ? OR order_id = ? ORDER BY captured_at ASC", disputeID, orderID)
	if err != nil {
		return err
	}

	draftRow, err := queryMap(r.Context(), db,
		"SELECT * FROM ai_drafts WHERE dispute_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", disputeID)
	if err != nil {
		return err
	}
	var draft any
	if draftRow != nil {
		dispute, err := store.ScanDispute(db.QueryRow(r.Context(), "SELECT "+store.DisputeColumns+" FROM disputes WHERE id = ?", disputeID))
		if err != nil {
			return err
		}
		rows, err := db.Query(r.Context(), "SELECT "+store.EvidenceColumns+
			" FROM evidence_items WHERE dispute_id = ? OR order_id = ? ORDER BY captured_at ASC", disputeID, orderID)
		if err != nil {
			return err
		}
		typedEvidence, err := store.ScanEvidenceRows(rows)
		if err != nil {
			return err
		}
		verification := ai.VerifyCitedDraft(
			ai.RawClaims(stringValue(draftRow["claims"])),
			stringValue(draftRow["draft_text"]), typedEvidence, dispute)
		draft = map[string]any{
			"id":                  draftRow["id"],
			"dispute_id":          draftRow["dispute_id"],
			"classification":      draftRow["classification"],
			"draft_text":          draftRow["draft_text"],
			"claims":              nonNilClaims(verification.VerifiedClaims),
			"schema_valid":        boolValue(draftRow["schema_valid"]),
			"model_name":          draftRow["model_name"],
			"verified":            boolValue(draftRow["verified"]) && verification.Verified,
			"verification_errors": nonNilStrings(verification.Errors),
			"created_at":          draftRow["created_at"],
		}
	}

	approvalRow, err := queryMap(r.Context(), db,
		"SELECT * FROM approvals WHERE dispute_id = ? ORDER BY created_at DESC LIMIT 1", disputeID)
	if err != nil {
		return err
	}
	var approval any
	if approvalRow != nil {
		approvalRow["exact_action_snapshot"] = decodeDetail(approvalRow["exact_action_snapshot"])
		approval = approvalRow
	}

	auditRows, err := queryMaps(r.Context(), db,
		"SELECT * FROM audit_log WHERE dispute_id = ? OR dispute_id IS NULL ORDER BY created_at ASC", disputeID)
	if err != nil {
		return err
	}
	formattedAudit := make([]map[string]any, 0, len(auditRows))
	for _, entry := range auditRows {
		formattedAudit = append(formattedAudit, map[string]any{
			"id":          entry["id"],
			"dispute_id":  entry["dispute_id"],
			"actor":       entry["actor"],
			"action":      entry["action"],
			"detail":      decodeDetail(entry["detail"]),
			"sha256_hash": entry["sha256_hash"],
			"created_at":  entry["created_at"],
		})
	}

	var order any
	if orderID != "" {
		order, err = queryMap(r.Context(), db, "SELECT * FROM demo_orders WHERE id = ?", orderID)
		if err != nil {
			return err
		}
	}

	operation, err := queryMap(r.Context(), db,
		"SELECT id,state,action_type,created_at,executed_at FROM approval_operations WHERE dispute_id=?", disputeID)
	if err != nil {
		return err
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"dispute":       disputeRow,
		"evidenceItems": evidenceItems,
		"draft":         draft,
		"approval":      approval,
		"auditLogs":     formattedAudit,
		"order":         order,
		"operation":     operation,
	})
	return nil
}

func (a *API) approveReview(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	id := r.PathValue("id")
	action, err := approvals.ParseAction(r.URL.Query().Get("action_type"))
	if err != nil {
		return err
	}
	if _, err := approvals.RequireDispute(r.Context(), id); err != nil {
		return err
	}
	review, err := approvals.ReviewAction(r.Context(), id, action)
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, review)
	return nil
}

func (a *API) approveExecute(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	id := r.PathValue("id")
	if _, err := approvals.RequireDispute(r.Context(), id); err != nil {
		return err
	}
	body, err := auth.ReadAuthBody(r, 8192)
	if err != nil {
		return err
	}
	action, err := approvals.ParseAction(body["action_type"])
	if err != nil {
		return err
	}
	for key := range body {
		if key != "action_type" && key != "snapshot_digest" {
			return httpx.Errorf(http.StatusBadRequest, "Only action_type and snapshot_digest are accepted.")
		}
	}
	digest, ok := body["snapshot_digest"].(string)
	if !ok || !digestPattern.MatchString(digest) {
		return httpx.Errorf(http.StatusBadRequest, "A reviewed snapshot_digest is required.")
	}
	status, result, err := approvals.ExecuteApproval(r.Context(), id, action, digest)
	if err != nil {
		return err
	}
	httpx.JSON(w, status, result)
	return nil
}

func (a *API) reconcileHistory(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	history, err := approvals.ReconciliationHistory(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, history)
	return nil
}

func (a *API) reconcileDispute(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	id := r.PathValue("id")
	if _, err := approvals.RequireDispute(r.Context(), id); err != nil {
		return err
	}
	body, err := auth.ReadAuthBody(r, 8192)
	if err != nil {
		return err
	}
	if len(body) != 0 {
		return httpx.Errorf(http.StatusBadRequest, "Reconciliation accepts an empty object; provider state cannot be supplied by the client.")
	}
	status, result, err := approvals.ReconcileDispute(r.Context(), id)
	if err != nil {
		return err
	}
	httpx.JSON(w, status, result)
	return nil
}

func (a *API) verifyDraft(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	lookup := r.PathValue("id")
	dispute, err := scanDisputeByLookup(r, db, lookup)
	if errors.Is(err, sql.ErrNoRows) {
		return &rawResponse{status: http.StatusNotFound, body: map[string]any{"error": "Dispute not found"}}
	}
	if err != nil {
		return err
	}
	body, err := auth.ReadAuthBody(r, 8192)
	if err != nil {
		return err
	}
	if len(body) != 0 {
		return httpx.Errorf(http.StatusBadRequest, "Verification accepts an empty object and rechecks the stored draft. Claims cannot be replaced independently of the narrative.")
	}
	rows, err := db.Query(r.Context(), "SELECT "+store.EvidenceColumns+
		" FROM evidence_items WHERE dispute_id = ? OR order_id = ? ORDER BY captured_at ASC", dispute.ID, dispute.OrderID.Str())
	if err != nil {
		return err
	}
	evidenceItems, err := store.ScanEvidenceRows(rows)
	if err != nil {
		return err
	}
	draftRow, err := queryMap(r.Context(), db,
		"SELECT * FROM ai_drafts WHERE dispute_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", dispute.ID)
	if err != nil {
		return err
	}
	if draftRow == nil {
		return &rawResponse{status: http.StatusNotFound, body: map[string]any{"error": "Draft not found"}}
	}
	verification := ai.VerifyCitedDraft(ai.RawClaims(stringValue(draftRow["claims"])), stringValue(draftRow["draft_text"]), evidenceItems, dispute)
	draftID := stringValue(draftRow["id"])
	verified := 0
	if verification.Verified {
		verified = 1
	}
	var errorsJSON any
	if len(verification.Errors) > 0 {
		errorsJSON = mustJSON(verification.Errors)
	}
	if _, err := db.Exec(r.Context(), "UPDATE ai_drafts SET verified = ?, verification_errors = ? WHERE id = ?",
		verified, errorsJSON, draftID); err != nil {
		return err
	}
	if _, err := store.Audit(r.Context(), "ai", "DRAFT_CLAIMS_VERIFICATION_EVALUATED", map[string]any{
		"dispute_id":   dispute.ID,
		"draft_id":     draftID,
		"verified":     verification.Verified,
		"errors_count": len(verification.Errors),
		"errors":       nonNilStrings(verification.Errors),
	}, &dispute.ID); err != nil {
		return err
	}
	realtime.Default().Publish(r.Context(), "CLAIM_VERIFIED", map[string]any{
		"dispute_id": dispute.ID,
		"draft_id":   draftID,
		"verified":   verification.Verified,
		"claims":     nonNilClaims(verification.VerifiedClaims),
		"errors":     nonNilStrings(verification.Errors),
	})
	httpx.JSON(w, http.StatusOK, map[string]any{
		"verified": verification.Verified,
		"claims":   nonNilClaims(verification.VerifiedClaims),
		"errors":   nonNilStrings(verification.Errors),
	})
	return nil
}

func (a *API) regenerateDraft(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	body, err := auth.ReadAuthBody(r, 8192)
	if err != nil {
		return err
	}
	if len(body) != 0 {
		return httpx.Errorf(http.StatusBadRequest, "Regeneration accepts an empty object.")
	}
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	id := r.PathValue("id")
	var draft types.AIDraft
	if err := db.WithTx(r.Context(), func(ctx context.Context) error {
		dispute, err := store.ScanDispute(db.QueryRow(ctx, "SELECT "+store.DisputeColumns+" FROM disputes WHERE id=?", id))
		if errors.Is(err, sql.ErrNoRows) {
			return httpx.Errorf(http.StatusNotFound, "Dispute not found.")
		}
		if err != nil {
			return err
		}
		if dispute.Status != string(types.StatusRequiredAction) {
			return httpx.Errorf(http.StatusConflict, "An active, unsubmitted dispute is required to regenerate a draft.")
		}
		if existing, err := queryMap(ctx, db, "SELECT id FROM approval_operations WHERE dispute_id=?", dispute.ID); err != nil {
			return err
		} else if existing != nil {
			return httpx.Errorf(http.StatusConflict, "An active, unsubmitted dispute is required to regenerate a draft.")
		}
		if existing, err := queryMap(ctx, db, "SELECT id FROM approvals WHERE dispute_id=? AND decision='APPROVED'", dispute.ID); err != nil {
			return err
		} else if existing != nil {
			return httpx.Errorf(http.StatusConflict, "An active, unsubmitted dispute is required to regenerate a draft.")
		}
		rows, err := db.Query(ctx, "SELECT "+store.EvidenceColumns+
			" FROM evidence_items WHERE dispute_id=? OR order_id=? ORDER BY id", dispute.ID, dispute.OrderID.Str())
		if err != nil {
			return err
		}
		evidence, err := store.ScanEvidenceRows(rows)
		if err != nil {
			return err
		}
		draft, err = ai.PersistCitedDraft(ctx, dispute, evidence, ai.GenerateDeterministicDraft(dispute, evidence, ""), false)
		return err
	}); err != nil {
		return err
	}
	realtime.Default().Publish(r.Context(), "DRAFT_GENERATED", draft)
	httpx.JSON(w, http.StatusCreated, map[string]any{"draft": draft})
	return nil
}

func (a *API) disputePacket(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	lookup := r.PathValue("id")
	dispute, err := scanDisputeByLookup(r, db, lookup)
	if errors.Is(err, sql.ErrNoRows) {
		return &rawResponse{status: http.StatusNotFound, body: map[string]any{"error": "Dispute not found"}}
	}
	if err != nil {
		return err
	}
	rows, err := db.Query(r.Context(), "SELECT "+store.EvidenceColumns+
		" FROM evidence_items WHERE dispute_id = ? OR order_id = ? ORDER BY captured_at ASC", dispute.ID, dispute.OrderID.Str())
	if err != nil {
		return err
	}
	evidenceItems, err := store.ScanEvidenceRows(rows)
	if err != nil {
		return err
	}
	pdf, err := vault.GenerateDisputePDFPacket(dispute, evidenceItems)
	if err != nil {
		return &rawResponse{status: http.StatusInternalServerError, body: map[string]any{"error": "Failed to generate PDF packet: " + err.Error()}}
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="evidence-packet-`+dispute.PayPalDisputeID+`.pdf"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pdf)
	return nil
}

// scanDisputeByLookup finds a dispute by internal id or provider id.
func scanDisputeByLookup(r *http.Request, db *store.Store, lookup string) (types.Dispute, error) {
	return store.ScanDispute(db.QueryRow(r.Context(),
		"SELECT "+store.DisputeColumns+" FROM disputes WHERE id = ? OR paypal_dispute_id = ?", lookup, lookup))
}
