package paypal

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// TestWebhookReliability is the ported scripts/test-webhooks.ts suite. It drives
// the real SQLite inbox with an injected signature verifier so delivery,
// idempotency, ordering, retry and recovery semantics are all exercised.
func TestWebhookReliability(t *testing.T) {
	t.Setenv("APP_MODE", "sandbox")
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("PAYPAL_WEBHOOK_ID", "test-webhook")
	t.Setenv("PAYPAL_CLIENT_ID", "")
	t.Setenv("PAYPAL_CLIENT_SECRET", "")
	Default = NewClient()
	store.Close()
	t.Cleanup(store.Close)

	const merchant = "usr_cccccccccccccccccccccccccccccccc"
	const foreign = "usr_dddddddddddddddddddddddddddddddd"

	ctx, err := scope.With(context.Background(), merchant, config.ModeSandbox, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("store.Merchant: %v", err)
	}

	now := "2026-10-14T10:00:00.000Z"
	later := "2026-10-14T11:00:00.000Z"
	newest := "2026-10-14T12:00:00.000Z"

	headers := WebhookHeaders{
		AuthAlgo:         "SHA256withRSA",
		CertURL:          "https://example.test/cert",
		TransmissionID:   "test-transmission",
		TransmissionSig:  "test-signature",
		TransmissionTime: now,
	}
	verifyTrue := func(context.Context, WebhookHeaders, types.PayPalWebhookEvent) (bool, error) {
		return true, nil
	}
	verifyFalse := func(context.Context, WebhookHeaders, types.PayPalWebhookEvent) (bool, error) {
		return false, nil
	}

	check := func(condition bool, label string) {
		t.Helper()
		if !condition {
			t.Errorf("FAIL %s", label)
		}
	}
	mustJSON := func(v any) string {
		b, err := httpx.Marshal(v)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		return string(b)
	}

	event := func(id, eventType string, resource map[string]any, timeStr string) map[string]any {
		resourceType := "capture"
		if strings.HasPrefix(eventType, "CUSTOMER") {
			resourceType = "dispute"
		}
		return map[string]any{
			"id": id, "event_type": eventType, "resource_type": resourceType,
			"create_time": timeStr, "resource": resource,
		}
	}
	capture := func(id string, captureID ...string) map[string]any {
		providerID := id
		if len(captureID) > 0 {
			providerID = captureID[0]
		}
		return event(id, "PAYMENT.CAPTURE.COMPLETED", map[string]any{
			"id": providerID, "amount": map[string]any{"value": "12.34", "currency_code": "USD"},
			"status": "COMPLETED", "create_time": now,
		}, now)
	}
	created := func(id string, providerID ...string) map[string]any {
		pid := id
		if len(providerID) > 0 {
			pid = providerID[0]
		}
		return event(id, "CUSTOMER.DISPUTE.CREATED", map[string]any{
			"dispute_id": pid, "update_time": now, "status": "WAITING_FOR_SELLER_RESPONSE",
			"reason":                   "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
			"disputed_transactions":    []any{map[string]any{"seller_transaction_id": "TX-" + pid}},
			"dispute_amount":           map[string]any{"value": "12.34", "currency_code": "USD"},
			"seller_response_due_date": "2026-12-01T00:00:00Z",
		}, now)
	}

	send := func(body any, verify SignatureVerifier) ProcessingResult {
		return ProcessPayPalWebhookWithVerifier(ctx, headers, body, verify)
	}

	count := func(table string) int {
		var n int
		if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM "+table).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		return n
	}

	type receiptRow struct {
		state         string
		attempts      int64
		completedAt   sql.NullString
		payloadHash   string
		payload       string
		nextAttemptAt int64
		lastError     sql.NullString
	}
	receipt := func(id string) receiptRow {
		var r receiptRow
		err := db.QueryRow(ctx,
			"SELECT state,attempts,completed_at,payload_hash,payload,next_attempt_at,last_error FROM webhook_inbox WHERE event_id=?",
			id).Scan(&r.state, &r.attempts, &r.completedAt, &r.payloadHash, &r.payload, &r.nextAttemptAt, &r.lastError)
		if err != nil {
			t.Fatalf("receipt %s: %v", id, err)
		}
		return r
	}
	dispute := func(providerID string) (status string, outcome sql.NullString, orderID sql.NullString, deadline string, exists bool) {
		err := db.QueryRow(ctx,
			"SELECT status,outcome,order_id,response_deadline FROM disputes WHERE paypal_dispute_id=?",
			providerID).Scan(&status, &outcome, &orderID, &deadline)
		if errors.Is(err, sql.ErrNoRows) {
			return "", sql.NullString{}, sql.NullString{}, "", false
		}
		if err != nil {
			t.Fatalf("dispute %s: %v", providerID, err)
		}
		return status, outcome, orderID, deadline, true
	}

	// Capture realtime notifications so we can assert they are suppressed on
	// rollback and ordered correctly on recovery.
	events, cancel := realtime.Default().Subscribe(realtime.Channel(config.ModeSandbox, merchant))
	t.Cleanup(cancel)
	var notes []realtime.Event
	collect := func() {
		for {
			select {
			case ev := <-events:
				notes = append(notes, ev)
			default:
				return
			}
		}
	}

	// --- Signature and envelope validation ---
	check(send(capture("bad-signature"), verifyFalse).StatusCode == 401 && count("webhook_inbox") == 0,
		"invalid signatures never reach the inbox")
	check(ProcessPayPalWebhookWithVerifier(ctx, WebhookHeaders{}, capture("missing-headers"), verifyTrue).StatusCode == 401,
		"missing verification headers fail closed")
	check(ProcessPayPalWebhook(ctx, headers, capture("unconfigured")).StatusCode == 401,
		"unconfigured provider verifier no longer accepts mock signatures")

	outage := send(capture("verification-outage"), func(context.Context, WebhookHeaders, types.PayPalWebhookEvent) (bool, error) {
		return false, errors.New("unavailable")
	})
	check(outage.StatusCode == 503 && count("webhook_inbox") == 0,
		"verification outage remains retryable without trusting the event")

	badTime := capture("bad-time")
	badTime["create_time"] = "yesterday"
	malformed := []struct {
		name string
		body any
	}{
		{"null body", nil},
		{"array body", []any{}},
		{"empty object", map[string]any{}},
		{"missing resource", event("missing-resource", "PAYMENT.CAPTURE.COMPLETED", nil, now)},
		{"invalid create_time", badTime},
	}
	for _, tc := range malformed {
		check(send(tc.body, verifyTrue).StatusCode == 400, "malformed webhook envelope rejected: "+tc.name)
	}

	// --- Happy path, deduplication and content binding ---
	res := send(capture("capture-one"), verifyTrue)
	check(res.Status == "PROCESSED", "verified capture commits successfully")
	row := receipt("capture-one")
	check(row.state == "PROCESSED" && row.attempts == 1 && row.completedAt.Valid,
		"completion and attempt metadata persisted")
	check(count("evidence_items") == 1 && count("paypal_captures") == 1,
		"capture produces one evidence item and one capture mapping")

	collect()
	published := len(notes)
	dup := send(capture("capture-one"), verifyTrue)
	collect()
	check(dup.Status == "DUPLICATE" && count("evidence_items") == 1 && len(notes) == published,
		"completed duplicate causes no evidence or notification side effects")

	check(send(capture("different-event-id", "capture-one"), verifyTrue).Status == "IGNORED" && count("evidence_items") == 1,
		"different event IDs for the same capture cannot duplicate evidence")

	reordered := capture("capture-one")
	reordered["resource"].(map[string]any)["amount"] = map[string]any{"currency_code": "USD", "value": "12.34"}
	check(send(reordered, verifyTrue).Status == "DUPLICATE", "object key order does not change event identity")

	changed := capture("capture-one")
	changed["summary"] = "changed payload"
	check(send(changed, verifyTrue).StatusCode == 409, "same event ID with changed content is rejected")
	check(send(capture("capture-one"), verifyFalse).StatusCode == 401, "replayed completed events still require signature verification")

	if _, err := db.Exec(ctx, "UPDATE webhook_inbox SET payload='{}' WHERE event_id='capture-one'"); err == nil {
		t.Error("FAIL stored verified payload is immutable")
	}

	// --- Concurrent verified delivery projects exactly once ---
	gate := make(chan struct{})
	var entered sync.WaitGroup
	entered.Add(2)
	concurrentVerifier := func(context.Context, WebhookHeaders, types.PayPalWebhookEvent) (bool, error) {
		entered.Done()
		<-gate
		return true, nil
	}
	var (
		wg      sync.WaitGroup
		results [2]ProcessingResult
	)
	wg.Add(2)
	for i := 0; i < 2; i++ {
		go func(slot int) {
			defer wg.Done()
			results[slot] = send(capture("concurrent"), concurrentVerifier)
		}(i)
	}
	entered.Wait()
	close(gate)
	wg.Wait()
	processed, duplicated := 0, 0
	for _, r := range results {
		switch r.Status {
		case "PROCESSED":
			processed++
		case "DUPLICATE":
			duplicated++
		}
	}
	check(processed == 1 && duplicated == 1, "concurrent verified delivery projects once")

	// --- Projection failure rolls back business writes and stays retryable ---
	if _, err := db.Exec(ctx, "CREATE TRIGGER fail_capture BEFORE INSERT ON paypal_captures WHEN NEW.capture_id='rollback-capture' BEGIN SELECT RAISE(ABORT,'injected capture failure'); END;"); err != nil {
		t.Fatalf("create fail_capture trigger: %v", err)
	}
	beforeEvidence := count("evidence_items")
	collect()
	beforeNotes := len(notes)
	check(send(capture("rollback", "rollback-capture"), verifyTrue).StatusCode == 503,
		"projection failure returns a retryable status")
	row = receipt("rollback")
	check(row.state == "FAILED" && row.attempts == 1 && !row.completedAt.Valid,
		"failed projection remains durably retryable")
	collect()
	check(count("evidence_items") == beforeEvidence && len(notes) == beforeNotes,
		"failed projection rolls back evidence and suppresses notifications")
	retry := send(capture("rollback", "rollback-capture"), verifyTrue)
	check(retry.StatusCode == 503 && receipt("rollback").attempts == 1, "retry backoff prevents immediate repeated work")

	if _, err := db.Exec(ctx, "DROP TRIGGER fail_capture"); err != nil {
		t.Fatalf("drop fail_capture trigger: %v", err)
	}
	if _, err := db.Exec(ctx, "UPDATE webhook_inbox SET next_attempt_at=0 WHERE event_id='rollback'"); err != nil {
		t.Fatalf("reset rollback backoff: %v", err)
	}
	outcomes, err := RetryWebhookEvents(ctx, RetryOptions{})
	if err != nil {
		t.Fatalf("RetryWebhookEvents: %v", err)
	}
	recovered := false
	for _, outcome := range outcomes {
		if outcome.EventID == "rollback" && outcome.Status == "PROCESSED" {
			recovered = true
		}
	}
	check(recovered && receipt("rollback").attempts == 2, "scheduled retry recovers failed projection")
	check(count("evidence_items") == beforeEvidence+1, "recovery writes one complete capture")

	// --- Draft failure rolls back the whole dispute projection ---
	if _, err := db.Exec(ctx, "CREATE TRIGGER fail_draft BEFORE INSERT ON ai_drafts BEGIN SELECT RAISE(ABORT,'injected draft failure'); END;"); err != nil {
		t.Fatalf("create fail_draft trigger: %v", err)
	}
	priorDisputes, priorDrafts := count("disputes"), count("ai_drafts")
	collect()
	priorNotes := len(notes)
	check(send(created("draft-failure"), verifyTrue).StatusCode == 503, "draft persistence failure is recoverable")
	collect()
	check(count("disputes") == priorDisputes && count("ai_drafts") == priorDrafts && len(notes) == priorNotes,
		"draft failure rolls back dispute, version, draft, and events together")
	if _, err := db.Exec(ctx, "DROP TRIGGER fail_draft"); err != nil {
		t.Fatalf("drop fail_draft trigger: %v", err)
	}
	recoveredResult, err := ProcessInboxEvent(ctx, "draft-failure", true)
	if err != nil {
		t.Fatalf("ProcessInboxEvent(draft-failure): %v", err)
	}
	_, _, _, _, exists := dispute("draft-failure")
	check(recoveredResult.Status == "PROCESSED" && exists, "failed dispute can be recovered without duplicate-key poisoning")

	// --- Out-of-order resolution is retained, then repaired by creation ---
	deferred := send(event("resolve-first", "CUSTOMER.DISPUTE.RESOLVED", map[string]any{
		"dispute_id": "out-of-order", "update_time": later,
	}, later), verifyTrue)
	_, _, _, _, exists = dispute("out-of-order")
	check(deferred.Status == "DEFERRED" && !exists, "resolution before creation is retained without inventing a dispute")

	collect()
	repair := send(created("create-later", "out-of-order"), verifyTrue)
	collect()
	status, outcome, _, _, _ := dispute("out-of-order")
	check(repair.Status == "PROCESSED", "creation repairs previously deferred resolution")
	check(status == "RESOLVED" && !outcome.Valid, "missing outcome remains unknown instead of becoming a seller win")
	observedResolved := false
	for _, ev := range notes {
		if d, ok := ev.Payload.(types.Dispute); ok && d.Status == "RESOLVED" {
			observedResolved = true
		}
	}
	check(receipt("resolve-first").state == "PROCESSED" && observedResolved,
		"deferred resolution commits before creation notifications are delivered")

	// --- Ordering: late updates, authoritative outcomes, conflicts ---
	lateOpen := send(event("late-open", "CUSTOMER.DISPUTE.UPDATED", map[string]any{
		"dispute_id": "out-of-order", "status": "WAITING_FOR_SELLER_RESPONSE", "update_time": newest,
	}, newest), verifyTrue)
	status, _, _, _, _ = dispute("out-of-order")
	check(lateOpen.Status == "IGNORED" && status == "RESOLVED", "late updates cannot reopen a terminal dispute")

	final := event("confirmed-outcome", "CUSTOMER.DISPUTE.RESOLVED", map[string]any{
		"dispute_id": "out-of-order", "update_time": newest,
		"dispute_outcome": map[string]any{"outcome_code": "RESOLVED_BUYER_FAVOUR"},
	}, newest)
	check(send(final, verifyTrue).Status == "PROCESSED", "newer resolution can supply an authoritative outcome")
	_, outcome, _, _, _ = dispute("out-of-order")
	check(outcome.String == "RESOLVED_BUYER_FAVOUR", "authoritative outcome persisted")

	conflict := event("conflicting-outcome", "CUSTOMER.DISPUTE.RESOLVED", map[string]any{
		"dispute_id": "out-of-order", "update_time": newest,
		"dispute_outcome": map[string]any{"outcome_code": "RESOLVED_SELLER_FAVOUR"},
	}, newest)
	conflictResult := send(conflict, verifyTrue)
	_, outcome, _, _, _ = dispute("out-of-order")
	check(conflictResult.Status == "DEAD_LETTER" && outcome.String == "RESOLVED_BUYER_FAVOUR",
		"conflicting terminal outcomes at one timestamp require review")

	send(created("ordered"), verifyTrue)
	orderedUpdate := send(event("ordered-update", "CUSTOMER.DISPUTE.UPDATED", map[string]any{
		"dispute_id": "ordered", "status": "UNDER_REVIEW", "update_time": newest,
		"seller_response_due_date": "2026-12-15T00:00:00Z",
	}, newest), verifyTrue)
	status, _, _, deadline, _ := dispute("ordered")
	check(orderedUpdate.Status == "PROCESSED" && status == "UNDER_REVIEW" && deadline == "2026-12-15T00:00:00Z",
		"newer update applies provider status and deadline")

	oldUpdate := send(event("old-update", "CUSTOMER.DISPUTE.UPDATED", map[string]any{
		"dispute_id": "ordered", "status": "WAITING_FOR_SELLER_RESPONSE", "update_time": later,
	}, later), verifyTrue)
	status, _, _, _, _ = dispute("ordered")
	check(oldUpdate.Status == "IGNORED" && status == "UNDER_REVIEW", "older update cannot overwrite newer state")

	tiedUpdate := send(event("tied-update", "CUSTOMER.DISPUTE.UPDATED", map[string]any{
		"dispute_id": "ordered", "status": "WAITING_FOR_SELLER_RESPONSE", "update_time": newest,
	}, newest), verifyTrue)
	status, _, _, _, _ = dispute("ordered")
	check(tiedUpdate.Status == "DEAD_LETTER" && status == "UNDER_REVIEW",
		"conflicting updates with tied timestamps require review instead of silently overwriting")

	noDeadline := created("no-deadline")
	delete(noDeadline["resource"].(map[string]any), "seller_response_due_date")
	check(send(noDeadline, verifyTrue).Status == "PROCESSED", "creation without a deadline is accepted")
	_, _, _, deadline, _ = dispute("no-deadline")
	check(deadline == "", "missing deadline remains unknown")

	repeat := created("repeat-create", "ordered")
	repeat["create_time"] = newest
	check(send(repeat, verifyTrue).Status == "IGNORED", "duplicate creation with a different event ID preserves existing state")

	unknown := send(event("unknown", "UNHANDLED.EVENT", map[string]any{"id": "unknown"}, now), verifyTrue)
	check(unknown.Status == "IGNORED" && receipt("unknown").state == "IGNORED", "unsupported events are explicitly recorded as ignored")

	check(send(event("missing-id", "CUSTOMER.DISPUTE.CREATED", map[string]any{"status": "OPEN"}, now), verifyTrue).Status == "DEAD_LETTER",
		"invalid verified resource becomes visible dead letter")

	// --- Bounded retries and late dependency recovery ---
	send(event("dead-dependency", "CUSTOMER.DISPUTE.RESOLVED", map[string]any{
		"dispute_id": "very-late", "update_time": later,
	}, later), verifyTrue)
	if _, err := db.Exec(ctx, "UPDATE webhook_inbox SET attempts=9,next_attempt_at=0 WHERE event_id='dead-dependency'"); err != nil {
		t.Fatalf("prime dead-dependency: %v", err)
	}
	dead, err := ProcessInboxEvent(ctx, "dead-dependency", false)
	if err != nil {
		t.Fatalf("ProcessInboxEvent(dead-dependency): %v", err)
	}
	check(dead.Status == "DEAD_LETTER", "retry attempts are bounded")

	send(created("very-late-create", "very-late"), verifyTrue)
	status, _, _, _, _ = dispute("very-late")
	check(status == "RESOLVED" && receipt("dead-dependency").state == "PROCESSED",
		"late dependency arrival can recover an exhausted deferred resolution")

	// --- Legacy processed receipts do not suppress missing business state ---
	old := created("legacy-receipt")
	if _, err := db.Exec(ctx, "INSERT INTO paypal_events VALUES(?,?,?,?,?,?,?,?)",
		"legacy", old["id"], old["event_type"], old["resource_type"], "", mustJSON(old), "PROCESSED", now); err != nil {
		t.Fatalf("insert legacy receipt: %v", err)
	}
	legacyResult := send(old, verifyTrue)
	_, _, _, _, exists = dispute("legacy-receipt")
	check(legacyResult.Status == "PROCESSED" && exists, "legacy processed receipts do not suppress missing business state")

	// --- Capture/order correlation and late repair ---
	if _, err := db.Exec(ctx, `INSERT INTO demo_orders(id,order_number,buyer_name,buyer_email,shipping_address,items,total_cents,paypal_order_id,created_at,provenance)
		VALUES('linked-order','ORDER-1','Buyer','buyer@example.test','Test Street','[]',1234,'PAYPAL-ORDER',?,'PAYPAL_SANDBOX')`, now); err != nil {
		t.Fatalf("insert linked order: %v", err)
	}
	correlated := capture("correlated-capture", "CAP-LINKED")
	correlated["resource"].(map[string]any)["supplementary_data"] = map[string]any{
		"related_ids": map[string]any{"order_id": "PAYPAL-ORDER"},
	}
	send(correlated, verifyTrue)
	correlatedDispute := created("correlated-dispute")
	correlatedDispute["resource"].(map[string]any)["disputed_transactions"] = []any{
		map[string]any{"seller_transaction_id": "CAP-LINKED"},
	}
	send(correlatedDispute, verifyTrue)
	_, _, orderID, _, _ := dispute("correlated-dispute")
	check(orderID.String == "linked-order", "capture identity correlates a dispute with its provider order")

	var linkedOrder string
	if err := db.QueryRow(ctx, "SELECT order_id FROM evidence_items WHERE id=(SELECT evidence_id FROM paypal_captures WHERE capture_id='CAP-LINKED')").Scan(&linkedOrder); err != nil {
		t.Fatalf("query linked evidence: %v", err)
	}
	check(linkedOrder == "linked-order", "capture evidence is linked to its known order")

	beforeCapture := created("dispute-before-capture")
	beforeCapture["resource"].(map[string]any)["disputed_transactions"] = []any{
		map[string]any{"seller_transaction_id": "CAP-LATE"},
	}
	send(beforeCapture, verifyTrue)
	_, _, orderID, _, _ = dispute("dispute-before-capture")
	check(!orderID.Valid, "missing capture mapping remains unknown")

	lateCapture := capture("late-capture", "CAP-LATE")
	lateCapture["resource"].(map[string]any)["supplementary_data"] = map[string]any{
		"related_ids": map[string]any{"order_id": "PAYPAL-ORDER"},
	}
	send(lateCapture, verifyTrue)
	_, _, orderID, _, _ = dispute("dispute-before-capture")
	check(orderID.String == "linked-order", "late capture repairs an existing dispute association")

	snapshot := count("evidence_items")
	conflictingCapture := capture("conflicting-capture", "capture-one")
	conflictingCapture["resource"].(map[string]any)["amount"] = map[string]any{"value": "99.00", "currency_code": "USD"}
	check(send(conflictingCapture, verifyTrue).Status == "DEAD_LETTER" && count("evidence_items") == snapshot,
		"conflicting facts for an existing capture do not replace its evidence")

	// --- Isolation: retry processing stays within the configured workspace ---
	foreignCtx, err := scope.With(context.Background(), foreign, config.ModeSandbox, nil)
	if err != nil {
		t.Fatalf("foreign scope: %v", err)
	}
	foreignDB, err := store.Merchant(foreignCtx)
	if err != nil {
		t.Fatalf("foreign merchant: %v", err)
	}
	var foreignInbox int
	if err := foreignDB.QueryRow(foreignCtx, "SELECT COUNT(*) FROM webhook_inbox").Scan(&foreignInbox); err != nil {
		t.Fatalf("foreign inbox count: %v", err)
	}
	check(foreignInbox == 0, "retry processing stays within configured merchant workspace")
}
