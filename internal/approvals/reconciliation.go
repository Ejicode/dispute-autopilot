package approvals

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/paypal"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

const (
	staleSubmissionMs = 120000
	leaseMs           = 90000
	cooldownMs        = 30000
)

var outcomeCodePattern = regexp.MustCompile(`^[A-Z_]{1,100}$`)

var paypalStatusMap = map[string]string{
	"OPEN":                        string(types.StatusUnderReview),
	"WAITING_FOR_SELLER_RESPONSE": string(types.StatusRequiredAction),
	"WAITING_FOR_BUYER_RESPONSE":  string(types.StatusUnderReview),
	"UNDER_REVIEW":                string(types.StatusUnderReview),
	"RESOLVED":                    string(types.StatusResolved),
	"CLOSED":                      string(types.StatusClosed),
}

type observation struct {
	ProviderID     string  `json:"provider_id"`
	ProviderStatus string  `json:"provider_status"`
	Status         string  `json:"status"`
	UpdatedAt      string  `json:"updated_at"`
	UpdatedMs      int64   `json:"updated_ms"`
	Deadline       *string `json:"deadline"`
	Outcome        *string `json:"outcome"`
}

func terminalStatus(status string) bool {
	return status == string(types.StatusResolved) || status == string(types.StatusClosed)
}

func disputeSignature(d types.Dispute) string {
	var outcome any
	if d.Outcome.Valid {
		outcome = d.Outcome.Str()
	}
	b, _ := json.Marshal([]any{d.PayPalDisputeID, d.Status, outcome, d.ResponseDeadline, d.UpdatedAt, d.AmountCents, d.Currency})
	return string(b)
}

func anyStr(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func parseMillis(s string) (int64, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UnixMilli(), nil
		}
	}
	return 0, errors.New("unparseable time")
}

func validateObservation(value any, dispute types.Dispute) (observation, error) {
	fail := httpx.Errorf(http.StatusBadGateway, "Provider details are incomplete or inconsistent. Manual review is required.")
	obj, ok := value.(map[string]any)
	if !ok {
		return observation{}, fail
	}
	providerID, _ := obj["dispute_id"].(string)
	if providerID != dispute.PayPalDisputeID {
		return observation{}, fail
	}
	statusRaw, ok := obj["status"].(string)
	if !ok {
		return observation{}, fail
	}
	status, ok := paypalStatusMap[statusRaw]
	if !ok {
		return observation{}, fail
	}
	updated, err := paypal.Timestamp(obj["update_time"])
	if err != nil || updated > config.NowMillis()+300000 {
		return observation{}, fail
	}
	updateTime, _ := obj["update_time"].(string)
	if raw, present := obj["dispute_amount"]; present {
		amount, currency, moneyErr := paypal.Money(raw)
		if moneyErr != nil || amount != dispute.AmountCents || currency != dispute.Currency {
			return observation{}, fail
		}
	}
	var deadline *string
	if raw, present := obj["seller_response_due_date"]; present {
		if raw != nil && raw != "" {
			if _, err := paypal.Timestamp(raw); err != nil {
				return observation{}, fail
			}
		}
		s, _ := raw.(string)
		deadline = &s
	}
	var outcome *string
	if raw, present := obj["dispute_outcome"]; present {
		outcomeObj, ok := raw.(map[string]any)
		if !ok {
			return observation{}, fail
		}
		code, ok := outcomeObj["outcome_code"].(string)
		if !ok || !outcomeCodePattern.MatchString(code) {
			return observation{}, fail
		}
		outcome = &code
	}
	return observation{
		ProviderID:     dispute.PayPalDisputeID,
		ProviderStatus: statusRaw,
		Status:         status,
		UpdatedAt:      updateTime,
		UpdatedMs:      updated,
		Deadline:       deadline,
		Outcome:        outcome,
	}, nil
}

// ReconciliationHistory returns the immutable reconciliation log for a dispute.
func ReconciliationHistory(ctx context.Context, id string) (map[string]any, error) {
	if _, err := RequireDispute(ctx, id); err != nil {
		return nil, err
	}
	op, err := operationFor(ctx, id)
	if err != nil {
		return nil, err
	}
	if op == nil {
		return nil, httpx.Errorf(http.StatusConflict, "This dispute has no approval operation to reconcile.")
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := rawRows(ctx, db, "SELECT * FROM dispute_reconciliations WHERE dispute_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20", id)
	if err != nil {
		return nil, err
	}
	var executedAt *string
	if op.ExecutedAt.Valid {
		value := op.ExecutedAt.String
		executedAt = &value
	}
	history := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if raw, ok := row["observation"].(string); ok && raw != "" {
			var parsed any
			if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
				row["observation"] = parsed
			}
		} else {
			row["observation"] = nil
		}
		history = append(history, row)
	}
	return map[string]any{
		"operation": map[string]any{
			"id":                  op.ID,
			"state":               op.State,
			"provider_request_id": op.IdempotencyKey,
			"executed_at":         executedAt,
		},
		"retry_allowed": false,
		"history":       history,
	}, nil
}

// ReconcileDispute observes provider state without authorizing another mutation.
func ReconcileDispute(ctx context.Context, id string) (int, map[string]any, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return 0, nil, err
	}
	original, err := RequireDispute(ctx, id)
	if err != nil {
		return 0, nil, err
	}
	if err := runtime.RequireMatchingProvenance(ctx, original.Provenance); err != nil {
		return 0, nil, err
	}
	sc, _ := scope.From(ctx)
	if sc.Mode == config.ModeDemo {
		return 0, nil, httpx.Errorf(http.StatusConflict, "Provider reconciliation is unavailable in demo mode.")
	}
	if err := paypal.Default.AssertMerchantAccess(ctx); err != nil {
		return 0, nil, err
	}
	actor := ""
	if sc.User != nil {
		actor = sc.User.ID
	}
	if actor == "" {
		return 0, nil, httpx.Errorf(http.StatusUnauthorized, "Authenticated merchant required.")
	}

	token := store.RandomHex(16)
	var op *operation
	if err := db.WithTx(ctx, func(ctx context.Context) error {
		current, err := operationFor(ctx, id)
		if err != nil {
			return err
		}
		if current == nil {
			return httpx.Errorf(http.StatusConflict, "This dispute has no approval operation to reconcile.")
		}
		var snapshot map[string]any
		_ = json.Unmarshal([]byte(current.Snapshot), &snapshot)
		env, _ := snapshot["environment"].(string)
		ppid, _ := snapshot["paypal_dispute_id"].(string)
		if env != string(sc.Mode) || ppid != original.PayPalDisputeID {
			return httpx.Errorf(http.StatusUnprocessableEntity, "Operation does not match this environment or dispute.")
		}
		if current.State != "SUBMITTING" && current.State != "UNCERTAIN" {
			return httpx.Errorf(http.StatusConflict, "Only unresolved approval operations can be reconciled.")
		}
		if current.State == "SUBMITTING" {
			updatedMs, parseErr := parseMillis(current.UpdatedAt)
			if parseErr != nil || config.NowMillis()-updatedMs < staleSubmissionMs {
				return httpx.Errorf(http.StatusConflict, "Submission may still be in progress. Wait before reconciling.")
			}
		}
		var leaseExpiry int64
		leaseErr := db.QueryRow(ctx, "SELECT expires_at FROM reconciliation_leases WHERE dispute_id=?", id).Scan(&leaseExpiry)
		if leaseErr == nil && leaseExpiry > config.NowMillis() {
			return httpx.Errorf(http.StatusConflict, "Reconciliation is already in progress.")
		}
		if leaseErr != nil && !errors.Is(leaseErr, sql.ErrNoRows) {
			return leaseErr
		}
		var lastCreated string
		lastErr := db.QueryRow(ctx, "SELECT created_at FROM dispute_reconciliations WHERE dispute_id=? ORDER BY rowid DESC LIMIT 1", id).Scan(&lastCreated)
		if lastErr == nil {
			if lastMs, perr := parseMillis(lastCreated); perr == nil && config.NowMillis()-lastMs < cooldownMs {
				return httpx.Errorf(http.StatusTooManyRequests, "Wait 30 seconds between reconciliation attempts.")
			}
		} else if !errors.Is(lastErr, sql.ErrNoRows) {
			return lastErr
		}
		if _, err := db.Exec(ctx, "INSERT INTO reconciliation_leases VALUES(?,?,?) ON CONFLICT(dispute_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at",
			id, token, config.NowMillis()+leaseMs); err != nil {
			return err
		}
		if current.State == "SUBMITTING" {
			if _, err := db.Exec(ctx, "UPDATE approval_operations SET state='UNCERTAIN',updated_at=? WHERE id=? AND state='SUBMITTING'",
				config.NowISO(), current.ID); err != nil {
				return err
			}
			if _, err := store.Audit(ctx, "system", "STALE_SUBMISSION_REQUIRES_RECONCILIATION", map[string]any{"operation_id": current.ID}, &id); err != nil {
				return err
			}
		}
		if _, err := store.Audit(ctx, "user", "DISPUTE_RECONCILIATION_STARTED", map[string]any{
			"operation_id": current.ID,
			"actor":        actor,
			"attempt":      token,
		}, &id); err != nil {
			return err
		}
		op = current
		return nil
	}); err != nil {
		return 0, nil, err
	}

	var obs *observation
	errorMessage := ""
	if details, err := paypal.Default.GetDisputeDetails(ctx, id); err != nil {
		var httpErr *httpx.HTTPError
		if errors.As(err, &httpErr) && httpErr.Status == http.StatusBadGateway {
			errorMessage = httpErr.Message
		} else {
			errorMessage = "Provider lookup failed. No action was retried."
		}
	} else if parsed, verr := validateObservation(details, original); verr != nil {
		var httpErr *httpx.HTTPError
		if errors.As(verr, &httpErr) && httpErr.Message != "" {
			errorMessage = httpErr.Message
		} else {
			errorMessage = "Provider details are incomplete or inconsistent. Manual review is required."
		}
	} else {
		obs = &parsed
	}

	var resultBody map[string]any
	completeErr := func() error {
		return db.WithTx(ctx, func(ctx context.Context) error {
			var leaseToken string
			var leaseExpiry int64
			if err := db.QueryRow(ctx, "SELECT token,expires_at FROM reconciliation_leases WHERE dispute_id=?", id).
				Scan(&leaseToken, &leaseExpiry); err != nil {
				return httpx.Errorf(http.StatusConflict, "Reconciliation lease expired or was superseded. Check history before trying again.")
			}
			if leaseToken != token || leaseExpiry <= config.NowMillis() {
				return httpx.Errorf(http.StatusConflict, "Reconciliation lease expired or was superseded. Check history before trying again.")
			}
			current, err := RequireDispute(ctx, id)
			if err != nil {
				return err
			}
			currentOp, err := operationFor(ctx, id)
			if err != nil {
				return err
			}
			if currentOp == nil {
				return httpx.Errorf(http.StatusConflict, "This dispute has no approval operation to reconcile.")
			}
			var versionMs int64
			hasVersion := true
			if err := db.QueryRow(ctx, "SELECT provider_updated_ms FROM paypal_dispute_versions WHERE paypal_dispute_id=?", current.PayPalDisputeID).
				Scan(&versionMs); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					hasVersion = false
				} else {
					return err
				}
			}

			outcomeResult := "ERROR"
			message := "Provider state observed; submission delivery remains unconfirmed."
			if errorMessage != "" {
				message = errorMessage
			}
			auditID := "rec_" + store.RandomHex(16)

			switch {
			case currentOp.ID != op.ID || currentOp.State == "SUCCEEDED" || disputeSignature(current) != disputeSignature(original):
				outcomeResult = "SUPERSEDED"
				message = "Local state changed during the lookup; the observation did not overwrite it."
			case obs != nil:
				switch {
				case hasVersion && obs.UpdatedMs < versionMs:
					outcomeResult = "STALE"
				case (terminalStatus(current.Status) && current.Status != obs.Status) ||
					(hasVersion && obs.UpdatedMs == versionMs && (current.Status != obs.Status ||
						(obs.Deadline != nil && current.ResponseDeadline != *obs.Deadline) ||
						(obs.Outcome != nil && current.Outcome.Str() != "" && current.Outcome.Str() != "PENDING" && current.Outcome.Str() != *obs.Outcome))):
					outcomeResult = "CONFLICT"
					message = "Provider observation conflicts with recorded lifecycle state; manual review is required."
				default:
					deadline := current.ResponseDeadline
					if obs.Deadline != nil {
						deadline = *obs.Deadline
					}
					var outcome any
					if obs.Outcome != nil {
						outcome = *obs.Outcome
					} else if current.Outcome.Str() == "PENDING" {
						outcome = nil
					} else if current.Outcome.Valid {
						outcome = current.Outcome.Str()
					}
					changed := current.Status != obs.Status || current.ResponseDeadline != deadline || current.Outcome.Str() != anyStr(outcome)
					outcomeResult = "UNCHANGED"
					if changed {
						outcomeResult = "APPLIED"
						if _, err := db.Exec(ctx, "UPDATE disputes SET status=?,response_deadline=?,outcome=?,updated_at=? WHERE id=?",
							obs.Status, deadline, outcome, config.NowISO(), id); err != nil {
							return err
						}
						if _, err := db.Exec(ctx, "UPDATE ai_drafts SET verified=0 WHERE dispute_id=?", id); err != nil {
							return err
						}
					}
					if _, err := db.Exec(ctx, `INSERT INTO paypal_dispute_versions VALUES(?,?,?) ON CONFLICT(paypal_dispute_id) DO UPDATE SET provider_updated_ms=excluded.provider_updated_ms,last_event_id=excluded.last_event_id`,
						current.PayPalDisputeID, obs.UpdatedMs, auditID); err != nil {
						return err
					}
				}
			}

			var serialized any
			var observationHash any
			if obs != nil {
				b, err := json.Marshal(obs)
				if err != nil {
					return err
				}
				serialized = string(b)
				observationHash = paypal.PayloadHash(obs)
			}
			if _, err := db.Exec(ctx, "INSERT INTO dispute_reconciliations VALUES(?,?,?,?,?,?,?,?,?,?)",
				auditID, id, op.ID, actor, string(sc.Mode), outcomeResult, serialized, observationHash, message, config.NowISO()); err != nil {
				return err
			}
			if _, err := store.Audit(ctx, "user", "DISPUTE_RECONCILIATION_COMPLETED", map[string]any{
				"reconciliation_id": auditID,
				"operation_id":      op.ID,
				"result":            outcomeResult,
				"actor":             actor,
				"retry_allowed":     false,
			}, &id); err != nil {
				return err
			}
			if _, err := db.Exec(ctx, "DELETE FROM reconciliation_leases WHERE dispute_id=? AND token=?", id, token); err != nil {
				return err
			}

			updated, err := RequireDispute(ctx, id)
			if err != nil {
				return err
			}
			updatedOp, err := operationFor(ctx, id)
			if err != nil {
				return err
			}
			operationState := ""
			if updatedOp != nil {
				operationState = updatedOp.State
			}
			resultBody = map[string]any{
				"reconciliation_id": auditID,
				"result":            outcomeResult,
				"message":           message,
				"observation":       obs,
				"dispute":           updated,
				"operation_state":   operationState,
				"retry_allowed":     false,
			}
			return nil
		})
	}()
	// Always release the lease for this attempt, matching the finally block.
	_, _ = db.Exec(ctx, "DELETE FROM reconciliation_leases WHERE dispute_id=? AND token=?", id, token)
	if completeErr != nil {
		return 0, nil, completeErr
	}

	if resultBody["result"] == "APPLIED" {
		realtime.Default().Publish(ctx, "DISPUTE_RECONCILED", resultBody)
	}
	statusCode := http.StatusOK
	if resultBody["result"] == "ERROR" {
		statusCode = http.StatusBadGateway
	}
	return statusCode, resultBody, nil
}
