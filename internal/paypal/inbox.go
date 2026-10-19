package paypal

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// MaxAttempts bounds retries before an event requires operator review.
const MaxAttempts = 10

// WebhookHeaders carries the provider signature headers.
type WebhookHeaders struct {
	AuthAlgo         string
	CertURL          string
	TransmissionID   string
	TransmissionSig  string
	TransmissionTime string
}

// ProcessingResult is the outcome reported to the provider.
type ProcessingResult struct {
	Status     string `json:"status"`
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
	DisputeID  string `json:"disputeId,omitempty"`
}

// SignatureVerifier verifies a provider signature. It is injectable for tests.
type SignatureVerifier func(ctx context.Context, headers WebhookHeaders, event types.PayPalWebhookEvent) (bool, error)

// DefaultVerifier performs real provider verification.
var DefaultVerifier SignatureVerifier = func(ctx context.Context, headers WebhookHeaders, event types.PayPalWebhookEvent) (bool, error) {
	return Default.VerifyWebhookSignature(ctx, VerifyParams{
		AuthAlgo:         headers.AuthAlgo,
		CertURL:          headers.CertURL,
		TransmissionID:   headers.TransmissionID,
		TransmissionSig:  headers.TransmissionSig,
		TransmissionTime: headers.TransmissionTime,
		WebhookID:        os.Getenv("PAYPAL_WEBHOOK_ID"),
		WebhookEvent:     event,
	})
}

type inboxRow struct {
	EventID       string
	EventType     string
	ResourceID    sql.NullString
	Payload       string
	PayloadHash   string
	State         string
	Attempts      int64
	NextAttemptAt int64
	LastError     sql.NullString
}

func complete(state string) bool { return state == "PROCESSED" || state == "IGNORED" }

func readEvent(row inboxRow) (types.PayPalWebhookEvent, error) {
	var body any
	if err := json.Unmarshal([]byte(row.Payload), &body); err != nil {
		return types.PayPalWebhookEvent{}, invalid("Stored receipt integrity check failed.")
	}
	if PayloadHash(body) != row.PayloadHash {
		return types.PayPalWebhookEvent{}, invalid("Stored receipt integrity check failed.")
	}
	return ValidateEnvelope(body)
}

// normalizeForStorage round-trips a value through JSON so that structs and maps
// canonicalize identically when hashed on write and recomputed from storage.
func normalizeForStorage(value any) (any, []byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, nil, err
	}
	var normalized any
	if err := json.Unmarshal(raw, &normalized); err != nil {
		return nil, nil, err
	}
	stored, err := json.Marshal(normalized)
	if err != nil {
		return nil, nil, err
	}
	return normalized, stored, nil
}

func loadInbox(ctx context.Context, db *store.Store, eventID string) (*inboxRow, error) {
	row, err := scanInboxRow(db.QueryRow(ctx,
		"SELECT event_id,event_type,resource_id,payload,payload_hash,state,attempts,next_attempt_at,last_error FROM webhook_inbox WHERE event_id=?",
		eventID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func scanInboxRow(sc store.Scanner) (inboxRow, error) {
	var row inboxRow
	err := sc.Scan(&row.EventID, &row.EventType, &row.ResourceID, &row.Payload, &row.PayloadHash,
		&row.State, &row.Attempts, &row.NextAttemptAt, &row.LastError)
	return row, err
}

func scanInboxRows(rows *sql.Rows) ([]inboxRow, error) {
	defer rows.Close()
	out := []inboxRow{}
	for rows.Next() {
		row, err := scanInboxRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func markComplete(ctx context.Context, db *store.Store, row inboxRow, projection Projection, attempts int64) error {
	state := "PROCESSED"
	if projection.Ignored {
		state = "IGNORED"
	}
	now := config.NowISO()
	if _, err := db.Exec(ctx, "UPDATE webhook_inbox SET state=?,attempts=?,next_attempt_at=0,last_error=NULL,completed_at=? WHERE event_id=?",
		state, attempts, now, row.EventID); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, "UPDATE paypal_events SET status=?,processed_at=? WHERE event_id=?", state, now, row.EventID); err != nil {
		return err
	}
	var disputeID *string
	if projection.DisputeID != "" {
		disputeID = &projection.DisputeID
	}
	_, err := store.Audit(ctx, "paypal", "WEBHOOK_PROJECTION_COMPLETED", map[string]any{
		"event_id": row.EventID,
		"state":    state,
		"attempts": attempts,
	}, disputeID)
	return err
}

// ProcessInboxEvent applies one verified event. No async work happens inside the
// transaction so competing deliveries and retry workers serialize.
func ProcessInboxEvent(ctx context.Context, eventID string, force bool) (ProcessingResult, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return ProcessingResult{}, err
	}

	var committed ProcessingResult
	var notifications []Notification

	err = db.WithTx(ctx, func(ctx context.Context) error {
		row, err := loadInbox(ctx, db, eventID)
		if err != nil {
			return err
		}
		if row == nil {
			committed = ProcessingResult{Status: "ERROR", StatusCode: 404, Message: "Verified event not found."}
			return nil
		}
		if complete(row.State) {
			committed = ProcessingResult{Status: "DUPLICATE", StatusCode: 200, Message: "Event already completed."}
			return nil
		}
		if row.State == "DEAD_LETTER" && !force {
			committed = ProcessingResult{Status: "DEAD_LETTER", StatusCode: 422, Message: "Event requires operator review."}
			return nil
		}
		if !force && row.NextAttemptAt > time.Now().UnixMilli() {
			status := "ERROR"
			if row.State == "DEFERRED" {
				status = "DEFERRED"
			}
			committed = ProcessingResult{Status: status, StatusCode: 503, Message: "Event is durably queued for retry."}
			return nil
		}
		attempts := row.Attempts + 1

		// Inner savepoint rolls back ALL business writes while the outer
		// transaction records the failure state.
		innerErr := db.WithTx(ctx, func(ctx context.Context) error {
			event, err := readEvent(*row)
			if err != nil {
				return err
			}
			projected, err := ProjectWebhook(ctx, event)
			if err != nil {
				return err
			}
			if err := markComplete(ctx, db, *row, projected, attempts); err != nil {
				return err
			}
			if projected.Created && row.ResourceID.Valid {
				waitingRows, err := db.Query(ctx, `SELECT event_id,event_type,resource_id,payload,payload_hash,state,attempts,next_attempt_at,last_error
					FROM webhook_inbox WHERE resource_id=? AND
					(state='DEFERRED' OR (state='DEAD_LETTER' AND last_error LIKE 'DEPENDENCY:%')) ORDER BY received_at,event_id`,
					row.ResourceID.String)
				if err != nil {
					return err
				}
				waiting, err := scanInboxRows(waitingRows)
				if err != nil {
					return err
				}
				for _, waitingRow := range waiting {
					waitingEvent, err := readEvent(waitingRow)
					if err != nil {
						return err
					}
					recovered, err := ProjectWebhook(ctx, waitingEvent)
					if err != nil {
						return err
					}
					if err := markComplete(ctx, db, waitingRow, recovered, waitingRow.Attempts+1); err != nil {
						return err
					}
					projected.Notifications = append(projected.Notifications, recovered.Notifications...)
				}
			}
			if projected.Ignored {
				committed = ProcessingResult{Status: "IGNORED", StatusCode: 200, Message: "Event recorded without a state change.", DisputeID: projected.DisputeID}
			} else {
				committed = ProcessingResult{Status: "PROCESSED", StatusCode: 200, Message: "Event applied.", DisputeID: projected.DisputeID}
			}
			notifications = projected.Notifications
			return nil
		})
		if innerErr == nil {
			return nil
		}

		var invalidErr *InvalidEvent
		var missingErr *MissingDependency
		dead := errors.As(innerErr, &invalidErr) || attempts >= MaxAttempts
		dependency := errors.As(innerErr, &missingErr)
		state := "FAILED"
		switch {
		case dead:
			state = "DEAD_LETTER"
		case dependency:
			state = "DEFERRED"
		}
		message := innerErr.Error()
		if dependency {
			message = "DEPENDENCY: " + message
		}
		var retryAt int64
		if !dead {
			exp := attempts - 1
			if exp > 10 {
				exp = 10
			}
			backoff := int64(30000)
			for i := int64(0); i < exp; i++ {
				backoff *= 2
			}
			if backoff > 3600000 {
				backoff = 3600000
			}
			retryAt = time.Now().UnixMilli() + backoff
		}
		if len(message) > 1000 {
			message = message[:1000]
		}
		if _, err := db.Exec(ctx, "UPDATE webhook_inbox SET state=?,attempts=?,next_attempt_at=?,last_error=?,completed_at=NULL WHERE event_id=?",
			state, attempts, retryAt, message, eventID); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, "UPDATE paypal_events SET status=? WHERE event_id=?", state, eventID); err != nil {
			return err
		}
		if _, err := store.Audit(ctx, "system", "WEBHOOK_PROJECTION_RETRY_STATE", map[string]any{
			"event_id": eventID,
			"state":    state,
			"attempts": attempts,
		}, nil); err != nil {
			return err
		}
		switch {
		case dead:
			committed = ProcessingResult{Status: "DEAD_LETTER", StatusCode: 422, Message: "Verified event requires operator review."}
		case dependency:
			committed = ProcessingResult{Status: "DEFERRED", StatusCode: 503, Message: "Verified event retained for retry."}
		default:
			committed = ProcessingResult{Status: "ERROR", StatusCode: 503, Message: "Verified event retained for retry."}
		}
		return nil
	})
	if err != nil {
		return ProcessingResult{}, err
	}

	// SSE is advisory; delivery failures cannot undo committed processing.
	for _, notification := range notifications {
		realtime.Default().Publish(ctx, notification.Type, notification.Payload)
	}
	return committed, nil
}

// ProcessPayPalWebhook validates a delivery, stores a durable receipt, then
// applies it exactly once.
func ProcessPayPalWebhook(ctx context.Context, headers WebhookHeaders, body any) ProcessingResult {
	return ProcessPayPalWebhookWithVerifier(ctx, headers, body, DefaultVerifier)
}

// ProcessPayPalWebhookWithVerifier is ProcessPayPalWebhook with an injectable
// signature verifier, used by the Trust Lab to exercise replay handling without
// depending on live PayPal cryptography.
func ProcessPayPalWebhookWithVerifier(ctx context.Context, headers WebhookHeaders, body any, verifier SignatureVerifier) ProcessingResult {
	event, err := ValidateEnvelope(body)
	if err != nil {
		return ProcessingResult{Status: "ERROR", StatusCode: 400, Message: "Invalid webhook envelope."}
	}
	for _, header := range []string{headers.AuthAlgo, headers.CertURL, headers.TransmissionID, headers.TransmissionSig, headers.TransmissionTime} {
		if strings.TrimSpace(header) == "" || len(header) > 8192 {
			return ProcessingResult{Status: "INVALID_SIGNATURE", StatusCode: 401, Message: "Required verification headers are missing."}
		}
	}
	verified, err := verifier(ctx, headers, event)
	if err != nil {
		return ProcessingResult{Status: "ERROR", StatusCode: 503, Message: "Webhook verification is temporarily unavailable."}
	}
	if !verified {
		return ProcessingResult{Status: "INVALID_SIGNATURE", StatusCode: 401, Message: "Invalid webhook signature."}
	}

	db, err := store.Merchant(ctx)
	if err != nil {
		return ProcessingResult{Status: "ERROR", StatusCode: 500, Message: "Unable to process webhook."}
	}
	// Normalize the delivery into plain JSON maps before hashing or storing so
	// the receipt hash recomputed from storage is always identical, regardless
	// of the Go type the caller supplied.
	normalized, payloadJSON, err := normalizeForStorage(body)
	if err != nil {
		return ProcessingResult{Status: "ERROR", StatusCode: 500, Message: "Unable to process webhook."}
	}
	hash := PayloadHash(normalized)
	accepted := false
	txErr := db.WithTx(ctx, func(ctx context.Context) error {
		var existingHash string
		scanErr := db.QueryRow(ctx, "SELECT payload_hash FROM webhook_inbox WHERE event_id=?", event.ID).Scan(&existingHash)
		if scanErr == nil {
			accepted = existingHash == hash
			return nil
		}
		if !errors.Is(scanErr, sql.ErrNoRows) {
			return scanErr
		}
		now := config.NowISO()
		var candidate any
		if strings.HasPrefix(event.EventType, "CUSTOMER.DISPUTE.") {
			candidate = event.Resource["dispute_id"]
		} else {
			candidate = event.Resource["id"]
		}
		var candidateVal any
		if s, ok := candidate.(string); ok {
			candidateVal = s
		}
		if _, err := db.Exec(ctx, `INSERT INTO webhook_inbox(event_id,event_type,resource_id,payload,payload_hash,state,received_at)
			VALUES(?,?,?,?,?,'RECEIVED',?)`, event.ID, event.EventType, candidateVal, string(payloadJSON), hash, now); err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `INSERT OR IGNORE INTO paypal_events(id,event_id,event_type,resource_type,summary,payload,status,processed_at)
			VALUES(?,?,?,?,?,?,'RECEIVED',?)`, "evt_"+store.RandomHex(16), event.ID, event.EventType, event.ResourceType, event.Summary, string(payloadJSON), now); err != nil {
			return err
		}
		accepted = true
		return nil
	})
	if txErr != nil {
		return ProcessingResult{Status: "ERROR", StatusCode: 500, Message: "Unable to process webhook."}
	}
	if !accepted {
		return ProcessingResult{Status: "ERROR", StatusCode: 409, Message: "Event ID was already received with different content."}
	}
	result, err := ProcessInboxEvent(ctx, event.ID, false)
	if err != nil {
		return ProcessingResult{Status: "ERROR", StatusCode: 500, Message: "Unable to process webhook."}
	}
	return result
}

// RetryOptions controls a retry sweep.
type RetryOptions struct {
	Limit   int
	EventID string
	Force   bool
}

// RetryOutcome is one retried event's result.
type RetryOutcome struct {
	EventID    string `json:"event_id"`
	Status     string `json:"status"`
	StatusCode int    `json:"statusCode"`
	Message    string `json:"message"`
	DisputeID  string `json:"disputeId,omitempty"`
}

// RetryWebhookEvents retries queued events (used by the maintenance CLI).
func RetryWebhookEvents(ctx context.Context, options RetryOptions) ([]RetryOutcome, error) {
	limit := options.Limit
	if limit == 0 {
		limit = 100
	}
	if limit < 1 || limit > 1000 {
		return nil, errors.New("Retry limit must be between 1 and 1000.")
	}
	if options.Force && options.EventID == "" {
		return nil, errors.New("Force retry requires an explicit event ID.")
	}

	eventIDs := []string{}
	if options.EventID != "" {
		eventIDs = append(eventIDs, options.EventID)
	} else {
		db, err := store.Merchant(ctx)
		if err != nil {
			return nil, err
		}
		rows, err := db.Query(ctx, `SELECT event_id FROM webhook_inbox
			WHERE state IN ('RECEIVED','FAILED','DEFERRED') AND next_attempt_at<=? ORDER BY received_at,event_id LIMIT ?`,
			time.Now().UnixMilli(), limit)
		if err != nil {
			return nil, err
		}
		eventIDs, err = scanStrings(rows)
		if err != nil {
			return nil, err
		}
	}

	outcomes := []RetryOutcome{}
	for _, eventID := range eventIDs {
		result, err := ProcessInboxEvent(ctx, eventID, options.Force)
		if err != nil {
			return nil, err
		}
		outcomes = append(outcomes, RetryOutcome{
			EventID:    eventID,
			Status:     result.Status,
			StatusCode: result.StatusCode,
			Message:    result.Message,
			DisputeID:  result.DisputeID,
		})
	}
	return outcomes, nil
}
