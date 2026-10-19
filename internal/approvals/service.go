// Package approvals implements the human-gated provider mutation flow: review,
// exact-snapshot digest, reservation, execution, and reconciliation.
package approvals

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/paypal"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
	"github.com/Ejicode/dispute-autopilot/internal/vault"
)

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

// operationColumns is the canonical projection for approval_operations.
const operationColumns = `id, dispute_id, action_type, snapshot_digest, snapshot, approver, idempotency_key, state, response, executed_at, created_at, updated_at`

type operation struct {
	ID             string
	DisputeID      string
	ActionType     string
	SnapshotDigest string
	Snapshot       string
	Approver       string
	IdempotencyKey string
	State          string
	Response       sql.NullString
	ExecutedAt     sql.NullString
	CreatedAt      string
	UpdatedAt      string
}

type reviewResult struct {
	digest   string
	snapshot map[string]any
}

// ParseAction validates an explicit, supported action type.
func ParseAction(value any) (string, error) {
	if s, ok := value.(string); ok && (s == string(types.ActionProvideEvidence) || s == string(types.ActionAcceptClaim)) {
		return s, nil
	}
	return "", httpx.Errorf(http.StatusBadRequest, "An explicit supported action_type is required.")
}

// RequireDispute loads a dispute or fails with 404.
func RequireDispute(ctx context.Context, id string) (types.Dispute, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return types.Dispute{}, err
	}
	dispute, err := store.ScanDispute(db.QueryRow(ctx, "SELECT "+store.DisputeColumns+" FROM disputes WHERE id=?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return types.Dispute{}, httpx.Errorf(http.StatusNotFound, "Dispute not found.")
	}
	return dispute, err
}

func operationFor(ctx context.Context, disputeID string) (*operation, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}
	op, err := scanOperation(db.QueryRow(ctx, "SELECT "+operationColumns+" FROM approval_operations WHERE dispute_id=?", disputeID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &op, nil
}

func scanOperation(sc store.Scanner) (operation, error) {
	var op operation
	err := sc.Scan(&op.ID, &op.DisputeID, &op.ActionType, &op.SnapshotDigest, &op.Snapshot,
		&op.Approver, &op.IdempotencyKey, &op.State, &op.Response, &op.ExecutedAt, &op.CreatedAt, &op.UpdatedAt)
	return op, err
}

func checkPolicy(ctx context.Context, dispute types.Dispute) error {
	if err := runtime.RequireMatchingProvenance(ctx, dispute.Provenance); err != nil {
		return err
	}
	if dispute.Status != string(types.StatusRequiredAction) {
		return httpx.Errorf(http.StatusConflict, "This dispute is not awaiting a merchant action.")
	}
	deadline, err := paypal.Timestamp(dispute.ResponseDeadline)
	if err != nil || deadline <= config.NowMillis() {
		return httpx.Errorf(http.StatusUnprocessableEntity, "The response deadline is expired or unknown.")
	}
	if dispute.AmountCents <= 0 || !currencyPattern.MatchString(dispute.Currency) {
		return httpx.Errorf(http.StatusUnprocessableEntity, "Dispute amount or currency is invalid.")
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return err
	}
	var existingID string
	err = db.QueryRow(ctx, "SELECT id FROM approvals WHERE dispute_id=? AND decision='APPROVED' LIMIT 1", dispute.ID).Scan(&existingID)
	if err == nil {
		return httpx.Errorf(http.StatusConflict, "An earlier approval requires reconciliation before another action.")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	return nil
}

// buildReview performs synchronous capture: no work happens between reading the
// review inputs and reserving execution.
func buildReview(ctx context.Context, dispute types.Dispute, action string) (reviewResult, error) {
	if err := checkPolicy(ctx, dispute); err != nil {
		return reviewResult{}, err
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return reviewResult{}, err
	}
	sc, _ := scope.From(ctx)

	var draft map[string]any
	evidenceMaps := []map[string]any{}
	evidenceTyped := []types.EvidenceItem{}

	if action == string(types.ActionProvideEvidence) {
		draftRows, err := rawRows(ctx, db, "SELECT * FROM ai_drafts WHERE dispute_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", dispute.ID)
		if err != nil {
			return reviewResult{}, err
		}
		if len(draftRows) > 0 {
			draft = draftRows[0]
		}
		evidenceMaps, err = rawRows(ctx, db, "SELECT * FROM evidence_items WHERE dispute_id=? OR order_id=? ORDER BY id", dispute.ID, dispute.OrderID.Str())
		if err != nil {
			return reviewResult{}, err
		}
		rows, err := db.Query(ctx, "SELECT "+store.EvidenceColumns+" FROM evidence_items WHERE dispute_id=? OR order_id=? ORDER BY id", dispute.ID, dispute.OrderID.Str())
		if err != nil {
			return reviewResult{}, err
		}
		evidenceTyped, err = store.ScanEvidenceRows(rows)
		if err != nil {
			return reviewResult{}, err
		}
	}

	var payload map[string]any
	evidenceIDs := []string{}
	for _, item := range evidenceTyped {
		evidenceIDs = append(evidenceIDs, item.ID)
	}
	notes := "Seller accepted buyer claim."
	var draftID any
	var draftText string

	if action == string(types.ActionProvideEvidence) {
		for _, item := range evidenceTyped {
			if err := runtime.RequireMatchingProvenance(ctx, item.Provenance); err != nil {
				return reviewResult{}, err
			}
		}
		if draft == nil || intVal(draft["verified"]) != 1 || intVal(draft["schema_valid"]) != 1 {
			return reviewResult{}, httpx.Errorf(http.StatusUnprocessableEntity, "A verified response draft is required.")
		}
		for _, item := range evidenceTyped {
			if vault.CalculateSHA256(item.Content) != item.SHA256Hash {
				return reviewResult{}, httpx.Errorf(http.StatusUnprocessableEntity, "Evidence integrity check failed.")
			}
		}
		draftText, _ = draft["draft_text"].(string)
		claims, _ := draft["claims"].(string)
		parsedClaims := ai.RawClaims(claims)
		if len(parsedClaims) == 0 {
			return reviewResult{}, httpx.Errorf(http.StatusUnprocessableEntity, "Draft claims are incomplete.")
		}
		for _, c := range parsedClaims {
			if c == nil {
				return reviewResult{}, httpx.Errorf(http.StatusUnprocessableEntity, "Draft claims are incomplete.")
			}
			expected, ok := c["expected_value"].(string)
			if !ok || strings.TrimSpace(expected) == "" {
				return reviewResult{}, httpx.Errorf(http.StatusUnprocessableEntity, "Draft claims are incomplete.")
			}
		}
		if !ai.VerifyCitedDraft(parsedClaims, draftText, evidenceTyped, dispute).Verified {
			return reviewResult{}, httpx.Errorf(http.StatusUnprocessableEntity, "Draft facts or narrative no longer match the evidence. Regenerate the draft.")
		}

		citedTracking := map[string]bool{}
		for _, c := range parsedClaims {
			if claimType, _ := c["claim_type"].(string); claimType == "TRACKING_NUMBER" {
				if evidenceID, ok := c["evidence_id"].(string); ok {
					citedTracking[evidenceID] = true
				}
			}
		}
		tracking := []map[string]any{}
		for _, item := range evidenceTyped {
			if !citedTracking[item.ID] {
				continue
			}
			var parsed map[string]any
			if err := json.Unmarshal([]byte(item.Content), &parsed); err != nil {
				continue
			}
			carrier, _ := parsed["carrier"].(string)
			trackingNumber, _ := parsed["tracking_number"].(string)
			if strings.TrimSpace(carrier) != "" && strings.TrimSpace(trackingNumber) != "" {
				tracking = append(tracking, map[string]any{
					"carrier_name":    carrier,
					"tracking_number": trackingNumber,
				})
			}
		}
		if len(tracking) == 0 {
			return reviewResult{}, httpx.Errorf(http.StatusUnprocessableEntity, "Recorded carrier and tracking number are required.")
		}
		payload = map[string]any{
			"evidences": []any{
				map[string]any{
					"evidence_type": "PROOF_OF_FULFILLMENT",
					"evidence_info": map[string]any{"tracking_info": tracking},
					"notes":         draftText,
				},
			},
		}
		notes = draftText
		draftID, _ = draft["id"]
	} else {
		payload = map[string]any{"note": "Seller accepted buyer claim."}
	}

	snapshot := map[string]any{
		"environment":       string(sc.Mode),
		"action_type":       action,
		"dispute_id":        dispute.ID,
		"paypal_dispute_id": dispute.PayPalDisputeID,
		"amount_cents":      dispute.AmountCents,
		"currency":          dispute.Currency,
		"evidence_ids":      evidenceIDs,
		"notes":             notes,
		"timestamp":         dispute.UpdatedAt,
		"draft_id":          draftID,
		"response_deadline": dispute.ResponseDeadline,
		"provider_payload":  payload,
	}

	digestInput, err := json.Marshal(map[string]any{
		"snapshot": snapshot,
		"draft":    draft,
		"evidence": evidenceMaps,
		"status":   dispute.Status,
	})
	if err != nil {
		return reviewResult{}, err
	}
	return reviewResult{digest: vault.CalculateSHA256(string(digestInput)), snapshot: snapshot}, nil
}

// ReviewAction returns the reviewed digest and snapshot for a human.
func ReviewAction(ctx context.Context, id, action string) (map[string]any, error) {
	dispute, err := RequireDispute(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := paypal.Default.AssertMerchantAccess(ctx); err != nil {
		return nil, err
	}
	existing, err := operationFor(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		var snapshot any
		_ = json.Unmarshal([]byte(existing.Snapshot), &snapshot)
		return map[string]any{
			"snapshot_digest": existing.SnapshotDigest,
			"snapshot":        snapshot,
			"operation":       map[string]any{"id": existing.ID, "state": existing.State},
		}, nil
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}
	var review reviewResult
	if err := db.WithTx(ctx, func(ctx context.Context) error {
		r, err := buildReview(ctx, dispute, action)
		if err != nil {
			return err
		}
		review = r
		return nil
	}); err != nil {
		return nil, err
	}
	return map[string]any{"snapshot_digest": review.digest, "snapshot": review.snapshot}, nil
}

func operationResult(op *operation) map[string]any {
	if op.State == "SUCCEEDED" {
		var body map[string]any
		if err := json.Unmarshal([]byte(op.Response.String), &body); err == nil {
			return body
		}
		return map[string]any{}
	}
	message := "Provider outcome is uncertain. Reconcile with PayPal before any further action."
	if op.State == "SUBMITTING" {
		message = "Submission is in progress. Refresh to check its status; do not start another action."
	}
	return map[string]any{
		"approval_id": op.ID,
		"state":       op.State,
		"success":     false,
		"message":     message,
	}
}

func operationStatus(op *operation) int {
	if op.State == "SUCCEEDED" {
		return http.StatusOK
	}
	if op.State == "SUBMITTING" {
		return http.StatusAccepted
	}
	return http.StatusConflict
}

// ExecuteApproval reserves and then executes exactly one reviewed provider action.
func ExecuteApproval(ctx context.Context, id, action, digest string) (int, map[string]any, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return 0, nil, err
	}
	if _, err := RequireDispute(ctx, id); err != nil {
		return 0, nil, err
	}
	if err := paypal.Default.AssertMerchantAccess(ctx); err != nil {
		return 0, nil, err
	}
	sc, _ := scope.From(ctx)

	var reserved *operation
	fresh := false
	if err := db.WithTx(ctx, func(ctx context.Context) error {
		existing, err := operationFor(ctx, id)
		if err != nil {
			return err
		}
		if existing != nil {
			if existing.SnapshotDigest != digest || existing.ActionType != action {
				return httpx.Errorf(http.StatusConflict, "Another action has already been reserved for this dispute.")
			}
			reserved = existing
			fresh = false
			return nil
		}
		dispute, err := RequireDispute(ctx, id)
		if err != nil {
			return err
		}
		review, err := buildReview(ctx, dispute, action)
		if err != nil {
			return err
		}
		if review.digest != digest {
			return httpx.Errorf(http.StatusConflict, "The draft, evidence, or dispute changed. Review the action again.")
		}
		operationID := "app_" + store.RandomHex(16)
		now := config.NowISO()
		approver := ""
		if sc.User != nil {
			approver = sc.User.ID
		}
		snapshotJSON, err := json.Marshal(review.snapshot)
		if err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `INSERT INTO approval_operations(id,dispute_id,action_type,snapshot_digest,snapshot,approver,idempotency_key,state,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,'SUBMITTING',?,?)`,
			operationID, id, action, digest, string(snapshotJSON), approver, operationID, now, now); err != nil {
			return err
		}
		if draftID, ok := review.snapshot["draft_id"]; ok && draftID != nil {
			if _, err := db.Exec(ctx, `INSERT INTO approvals(id,draft_id,dispute_id,approver,exact_action_snapshot,decision,idempotency_key,created_at)
				VALUES(?,?,?,?,?,'APPROVED',?,?)`,
				operationID, draftID, id, approver, string(snapshotJSON), operationID, now); err != nil {
				return err
			}
		}
		if _, err := store.Audit(ctx, "user", "HUMAN_APPROVAL_GRANTED", map[string]any{
			"approval_id":     operationID,
			"approver":        approver,
			"action_type":     action,
			"snapshot_digest": digest,
		}, &id); err != nil {
			return err
		}
		reserved, err = operationFor(ctx, id)
		fresh = true
		return err
	}); err != nil {
		return 0, nil, err
	}
	if !fresh {
		return operationStatus(reserved), operationResult(reserved), nil
	}

	op := reserved
	var snapshot map[string]any
	_ = json.Unmarshal([]byte(op.Snapshot), &snapshot)
	actionSnapshot := snapshotToAction(snapshot)

	var call paypal.ProviderCall
	var callErr error
	switch action {
	case string(types.ActionProvideEvidence):
		call, callErr = paypal.Default.ProvideEvidence(ctx, id, actionSnapshot, op.IdempotencyKey)
	case string(types.ActionAcceptClaim):
		call, callErr = paypal.Default.AcceptClaim(ctx, id, actionSnapshot, op.IdempotencyKey)
	}
	if callErr != nil || !call.Success {
		// An exception is not proof the provider did nothing. Never resubmit.
		if _, err := db.Exec(ctx, "UPDATE approval_operations SET state='UNCERTAIN',updated_at=? WHERE id=? AND state='SUBMITTING'",
			config.NowISO(), op.ID); err != nil {
			return 0, nil, err
		}
		if _, err := store.Audit(ctx, "system", "APPROVAL_EXECUTION_UNCERTAIN", map[string]any{"approval_id": op.ID}, &id); err != nil {
			return 0, nil, err
		}
		current, err := operationFor(ctx, id)
		if err != nil {
			return 0, nil, err
		}
		return operationStatus(current), operationResult(current), nil
	}

	var body map[string]any
	if err := db.WithTx(ctx, func(ctx context.Context) error {
		now := config.NowISO()
		// Acknowledgement is not final resolution and cannot overwrite a newer webhook.
		if _, err := db.Exec(ctx, "UPDATE disputes SET status='UNDER_REVIEW',updated_at=? WHERE id=? AND status='REQUIRED_ACTION' AND updated_at=?",
			now, id, snapshot["timestamp"]); err != nil {
			return err
		}
		dispute, err := RequireDispute(ctx, id)
		if err != nil {
			return err
		}
		response := map[string]any{
			"success":       true,
			"approval_id":   op.ID,
			"state":         "SUCCEEDED",
			"dispute":       dispute,
			"paypal_result": call,
		}
		responseJSON, err := json.Marshal(response)
		if err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE approval_operations SET state='SUCCEEDED',response=?,executed_at=?,updated_at=? WHERE id=?",
			string(responseJSON), now, now, op.ID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE approvals SET executed_at=? WHERE id=?", now, op.ID); err != nil {
			return err
		}
		if _, err := store.Audit(ctx, "system", "APPROVAL_EXECUTION_ACKNOWLEDGED", map[string]any{
			"approval_id":     op.ID,
			"snapshot_digest": digest,
		}, &id); err != nil {
			return err
		}
		body = response
		return nil
	}); err != nil {
		return 0, nil, err
	}

	// A notification failure must not reclassify an acknowledged operation.
	realtime.Default().Publish(ctx, "ACTION_APPROVED", body)
	return http.StatusOK, body, nil
}

func snapshotToAction(snapshot map[string]any) types.ExactActionSnapshot {
	b, err := json.Marshal(snapshot)
	if err != nil {
		return types.ExactActionSnapshot{}
	}
	var action types.ExactActionSnapshot
	_ = json.Unmarshal(b, &action)
	return action
}

func intVal(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	case bool:
		if n {
			return 1
		}
	}
	return 0
}

// rawRows returns rows as loosely-typed maps, matching `SELECT *` row objects.
func rawRows(ctx context.Context, db *store.Store, query string, args ...any) ([]map[string]any, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(cols))
		pointers := make([]any, len(cols))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		record := make(map[string]any, len(cols))
		for i, col := range cols {
			if b, ok := values[i].([]byte); ok {
				record[col] = string(b)
			} else {
				record[col] = values[i]
			}
		}
		out = append(out, record)
	}
	return out, rows.Err()
}
