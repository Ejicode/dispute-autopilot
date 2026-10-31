package approvals

// This file ports scripts/test-approvals.ts and scripts/test-reconciliation.ts
// onto the real service functions. Provider I/O is exercised through the real
// PayPal client with http.DefaultTransport replaced by an in-memory transport, so
// no test makes a network call and no credentials are required.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/paypal"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
	"github.com/Ejicode/dispute-autopilot/internal/vault"
)

const (
	merchantID = "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	foreignID  = "usr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

func testAccount(id string) *types.UserAccount {
	return &types.UserAccount{
		ID: id, Name: "Test", Email: id + "@test.example",
		StoreName: "Test Store", Role: "MERCHANT_ADMIN", CreatedAt: "2026-01-01T00:00:00.000Z",
	}
}

// configureEnv mirrors the environment setup every TS script performs.
func configureEnv(t *testing.T, mode config.Mode, merchant string) {
	t.Helper()
	t.Setenv("APP_MODE", string(mode))
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("APP_ORIGIN", "http://localhost:3000")
	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	if mode == config.ModeSandbox {
		t.Setenv("PAYPAL_CLIENT_ID", "test-client")
		t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
		t.Setenv("PAYPAL_MERCHANT_USER_ID", merchant)
	} else {
		t.Setenv("PAYPAL_CLIENT_ID", "")
		t.Setenv("PAYPAL_CLIENT_SECRET", "")
		t.Setenv("PAYPAL_MERCHANT_USER_ID", "")
	}
	paypal.Default = paypal.NewClient()
	t.Cleanup(func() { paypal.Default = paypal.NewClient() })
	store.Close()
	t.Cleanup(store.Close)
}

func merchantContext(t *testing.T, merchant string, mode config.Mode) (context.Context, *store.Store) {
	t.Helper()
	ctx, err := scope.With(context.Background(), merchant, mode, testAccount(merchant))
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("store.Merchant: %v", err)
	}
	return ctx, db
}

func httpStatus(err error) int {
	var he *httpx.HTTPError
	if errors.As(err, &he) {
		return he.Status
	}
	return 0
}

func execSQL(t *testing.T, ctx context.Context, db *store.Store, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(ctx, query, args...); err != nil {
		t.Fatalf("exec %q: %v", query, err)
	}
}

func normalizeJSON(t *testing.T, value any) any {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

func providerAudits(t *testing.T, ctx context.Context, db *store.Store) int {
	t.Helper()
	var n int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM audit_log WHERE action LIKE 'PAYPAL_API_%'").Scan(&n); err != nil {
		t.Fatalf("provider audits: %v", err)
	}
	return n
}

// --- provider transport seam -------------------------------------------------

type capturedRequest struct {
	method string
	url    string
	header http.Header
	body   []byte
}

type mockTransport struct {
	mu       sync.Mutex
	requests []capturedRequest
	handler  func(method, url string, body []byte) (*http.Response, error)
}

func (m *mockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		body, _ = io.ReadAll(req.Body)
		_ = req.Body.Close()
	}
	m.mu.Lock()
	m.requests = append(m.requests, capturedRequest{
		method: req.Method, url: req.URL.String(), header: req.Header.Clone(), body: body,
	})
	handler := m.handler
	m.mu.Unlock()
	if strings.HasSuffix(req.URL.Path, "/oauth2/token") {
		return jsonResponse(http.StatusOK, `{"access_token":"test-token","expires_in":3600}`), nil
	}
	if handler == nil {
		return jsonResponse(http.StatusOK, "{}"), nil
	}
	return handler(req.Method, req.URL.String(), body)
}

func (m *mockTransport) setHandler(handler func(method, url string, body []byte) (*http.Response, error)) {
	m.mu.Lock()
	m.handler = handler
	m.mu.Unlock()
}

func (m *mockTransport) snapshot() []capturedRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]capturedRequest, len(m.requests))
	copy(out, m.requests)
	return out
}

func installMockTransport(t *testing.T) *mockTransport {
	t.Helper()
	m := &mockTransport{}
	saved := http.DefaultTransport
	http.DefaultTransport = m
	t.Cleanup(func() { http.DefaultTransport = saved })
	return m
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     fmt.Sprintf("%d %s", status, http.StatusText(status)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

type callResult struct {
	status int
	body   map[string]any
	err    error
}

// --- fixtures ----------------------------------------------------------------

// insertApprovalFixture mirrors fixture() in test-approvals.ts.
func insertApprovalFixture(t *testing.T, ctx context.Context, db *store.Store, id string, withDraft bool, provenance config.Provenance) {
	t.Helper()
	now := config.NowISO()
	deadline := config.FormatISO(time.Now().Add(time.Hour))
	if _, err := db.Exec(ctx, `INSERT INTO disputes
		(id,paypal_dispute_id,transaction_id,reason,amount_cents,currency,status,response_deadline,strength_score,recommendation,created_at,updated_at,provenance)
		VALUES(?,?,?,'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',10000,'USD','REQUIRED_ACTION',?,0,'ASK A HUMAN',?,?,?)`,
		id, "PP-"+id, "TX-"+id, deadline, now, now, string(provenance)); err != nil {
		t.Fatalf("insert dispute %s: %v", id, err)
	}
	if !withDraft {
		return
	}
	content := `{"carrier":"USPS","tracking_number":"TRACK-` + id + `"}`
	if _, err := db.Exec(ctx, `INSERT INTO evidence_items
		(id,dispute_id,evidence_type,source,title,content,sha256_hash,captured_at,provenance)
		VALUES(?,?,'TRACKING_HISTORY','USPS','Tracking',?,?,?,?)`,
		"ev-"+id, id, content, vault.CalculateSHA256(content), now, string(provenance)); err != nil {
		t.Fatalf("insert evidence %s: %v", id, err)
	}
	claim := types.Claim{
		ClaimID: "c1", ClaimType: "TRACKING_NUMBER",
		ExpectedValue: "TRACK-" + id, EvidenceID: "ev-" + id,
	}
	claim.Text = ai.RenderClaimText(claim.ClaimType, claim.ExpectedValue)
	narrative := ai.RenderCitedNarrative([]types.Claim{claim})
	claimsJSON, err := json.Marshal([]types.Claim{claim})
	if err != nil {
		t.Fatalf("marshal claims %s: %v", id, err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO ai_drafts
		(id,dispute_id,classification,draft_text,claims,model_name,verified,created_at)
		VALUES(?,?,'INR',?,?,'test',1,?)`,
		"draft-"+id, id, narrative, string(claimsJSON), now); err != nil {
		t.Fatalf("insert draft %s: %v", id, err)
	}
}

// insertReconciliationFixture mirrors fixture() in test-reconciliation.ts.
func insertReconciliationFixture(t *testing.T, ctx context.Context, db *store.Store, id, state, updated, provenance string) {
	t.Helper()
	deadline := config.FormatISO(time.Now().Add(time.Hour))
	if _, err := db.Exec(ctx, `INSERT INTO disputes
		(id,paypal_dispute_id,transaction_id,reason,amount_cents,currency,status,response_deadline,strength_score,recommendation,created_at,updated_at,provenance)
		VALUES(?,?,?,'OTHER',1000,'USD','REQUIRED_ACTION',?,0,'ASK A HUMAN',?,?,?)`,
		id, "PP-"+id, "TX-"+id, deadline, updated, updated, provenance); err != nil {
		t.Fatalf("insert dispute %s: %v", id, err)
	}
	snapshot, err := json.Marshal(map[string]any{"environment": "sandbox", "paypal_dispute_id": "PP-" + id})
	if err != nil {
		t.Fatalf("marshal snapshot %s: %v", id, err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO approval_operations
		(id,dispute_id,action_type,snapshot_digest,snapshot,approver,idempotency_key,state,created_at,updated_at)
		VALUES(?,?,'ACCEPT_CLAIM',?,?,?,?,?,?,?)`,
		"op-"+id, id, strings.Repeat("0", 64), string(snapshot), merchantID, "key-"+id, state, updated, updated); err != nil {
		t.Fatalf("insert operation %s: %v", id, err)
	}
}

// --- approvals suite ---------------------------------------------------------

// TestApprovalReviewGuards ports the demo-mode half of scripts/test-approvals.ts:
// review digests, snapshot staleness, draft validation and first execution.
func TestApprovalReviewGuards(t *testing.T) {
	configureEnv(t, config.ModeDemo, merchantID)
	ctx, db := merchantContext(t, merchantID, config.ModeDemo)

	check := func(condition bool, label string) {
		t.Helper()
		if !condition {
			t.Errorf("FAIL %s", label)
		}
	}
	opFor := func(id string) *operation {
		t.Helper()
		op, err := operationFor(ctx, id)
		if err != nil {
			t.Fatalf("operationFor %s: %v", id, err)
		}
		return op
	}

	// Explicit, supported action types are required.
	for _, bad := range []any{nil, "TYPO", []any{"ACCEPT_CLAIM"}, 7} {
		if _, err := ParseAction(bad); httpStatus(err) != http.StatusBadRequest {
			t.Errorf("FAIL invalid approval action rejected: %v", bad)
		}
	}
	if action, err := ParseAction("PROVIDE_EVIDENCE"); err != nil || action != "PROVIDE_EVIDENCE" {
		t.Errorf("FAIL PROVIDE_EVIDENCE parses: %v %v", action, err)
	}
	if action, err := ParseAction("ACCEPT_CLAIM"); err != nil || action != "ACCEPT_CLAIM" {
		t.Errorf("FAIL ACCEPT_CLAIM parses: %v %v", action, err)
	}
	check(true, "supported action types parse")

	insertApprovalFixture(t, ctx, db, "strict", true, config.ProvenanceDemo)
	strictReview, err := ReviewAction(ctx, "strict", "PROVIDE_EVIDENCE")
	if err != nil {
		t.Fatalf("ReviewAction(strict): %v", err)
	}
	check(opFor("strict") == nil && providerAudits(t, ctx, db) == 0,
		"reviewing an action never reserves or calls the provider")

	// Foreign merchants cannot review or approve a dispute they do not own.
	foreignCtx, err := scope.With(context.Background(), foreignID, config.ModeDemo, testAccount(foreignID))
	if err != nil {
		t.Fatalf("foreign scope: %v", err)
	}
	if _, err := ReviewAction(foreignCtx, "strict", "ACCEPT_CLAIM"); httpStatus(err) != http.StatusNotFound {
		t.Errorf("FAIL foreign merchant cannot review action: %v", err)
	}
	if _, _, err := ExecuteApproval(foreignCtx, "strict", "PROVIDE_EVIDENCE", strictReview["snapshot_digest"].(string)); httpStatus(err) != http.StatusNotFound {
		t.Errorf("FAIL foreign merchant cannot approve action: %v", err)
	}

	// Any change to the reviewed inputs invalidates the digest before reservation.
	mutations := []struct {
		id       string
		expected int
		mutate   func()
	}{
		{"draft-change", http.StatusUnprocessableEntity, func() {
			execSQL(t, ctx, db, "UPDATE ai_drafts SET draft_text=? WHERE dispute_id='draft-change'", "Edited after review")
		}},
		{"amount-change", http.StatusConflict, func() {
			execSQL(t, ctx, db, "UPDATE disputes SET amount_cents=12000 WHERE id='amount-change'")
		}},
		{"evidence-change", http.StatusConflict, func() {
			execSQL(t, ctx, db, "UPDATE evidence_items SET title='Changed evidence metadata' WHERE dispute_id='evidence-change'")
		}},
		{"deadline-change", http.StatusConflict, func() {
			execSQL(t, ctx, db, "UPDATE disputes SET response_deadline=? WHERE id='deadline-change'",
				config.FormatISO(time.Now().Add(2*time.Hour)))
		}},
	}
	for _, tc := range mutations {
		insertApprovalFixture(t, ctx, db, tc.id, true, config.ProvenanceDemo)
		review, err := ReviewAction(ctx, tc.id, "PROVIDE_EVIDENCE")
		if err != nil {
			t.Fatalf("ReviewAction(%s): %v", tc.id, err)
		}
		tc.mutate()
		if _, _, err := ExecuteApproval(ctx, tc.id, "PROVIDE_EVIDENCE", review["snapshot_digest"].(string)); httpStatus(err) != tc.expected {
			t.Errorf("FAIL %s invalidates reviewed digest: got %d", tc.id, httpStatus(err))
		}
		if opFor(tc.id) != nil {
			t.Errorf("FAIL %s never reserves an operation", tc.id)
		}
	}

	// The stored verified flag cannot bypass narrative validation.
	insertApprovalFixture(t, ctx, db, "unsupported-narrative", true, config.ProvenanceDemo)
	execSQL(t, ctx, db, "UPDATE ai_drafts SET draft_text=draft_text || ' Delivered successfully.' WHERE dispute_id='unsupported-narrative'")
	if _, err := ReviewAction(ctx, "unsupported-narrative", "PROVIDE_EVIDENCE"); httpStatus(err) != http.StatusUnprocessableEntity {
		t.Errorf("FAIL verified flag cannot bypass unsupported narrative: %v", err)
	}

	// Malformed stored claims fail closed.
	insertApprovalFixture(t, ctx, db, "malformed-claims", true, config.ProvenanceDemo)
	execSQL(t, ctx, db, "UPDATE ai_drafts SET claims='invalid JSON' WHERE dispute_id='malformed-claims'")
	if _, err := ReviewAction(ctx, "malformed-claims", "PROVIDE_EVIDENCE"); httpStatus(err) != http.StatusUnprocessableEntity {
		t.Errorf("FAIL malformed stored claims fail closed: %v", err)
	}

	// Only cited tracking evidence reaches the provider payload.
	insertApprovalFixture(t, ctx, db, "uncited-tracking", true, config.ProvenanceDemo)
	extra := `{"carrier":"USPS","tracking_number":"UNTRUSTED-EXTRA"}`
	execSQL(t, ctx, db, `INSERT INTO evidence_items
		(id,dispute_id,evidence_type,source,title,content,sha256_hash,captured_at,provenance)
		VALUES('extra','uncited-tracking','TRACKING_HISTORY','BUYER_MESSAGE','Untrusted',?,?,?,?)`,
		extra, vault.CalculateSHA256(extra), config.NowISO(), string(config.ProvenanceDemo))
	uncited, err := ReviewAction(ctx, "uncited-tracking", "PROVIDE_EVIDENCE")
	if err != nil {
		t.Fatalf("ReviewAction(uncited-tracking): %v", err)
	}
	citedPayload, err := json.Marshal(uncited["snapshot"].(map[string]any)["provider_payload"])
	if err != nil {
		t.Fatalf("marshal cited payload: %v", err)
	}
	check(!strings.Contains(string(citedPayload), "UNTRUSTED-EXTRA"),
		"uncited tracking is excluded from provider payload")

	// A newer draft, even with an equal timestamp, invalidates the review.
	insertApprovalFixture(t, ctx, db, "latest", true, config.ProvenanceDemo)
	latest, err := ReviewAction(ctx, "latest", "PROVIDE_EVIDENCE")
	if err != nil {
		t.Fatalf("ReviewAction(latest): %v", err)
	}
	execSQL(t, ctx, db, `INSERT INTO ai_drafts
		(id,dispute_id,classification,draft_text,claims,schema_valid,model_name,verified,verification_errors,created_at)
		SELECT 'new-draft',dispute_id,classification,draft_text,claims,schema_valid,model_name,verified,verification_errors,created_at
		FROM ai_drafts WHERE id='draft-latest'`)
	if _, _, err := ExecuteApproval(ctx, "latest", "PROVIDE_EVIDENCE", latest["snapshot_digest"].(string)); httpStatus(err) != http.StatusConflict {
		t.Errorf("FAIL new draft with equal timestamp invalidates review: %v", err)
	}

	// Stale evidence checksums and unverified drafts block approval.
	insertApprovalFixture(t, ctx, db, "corrupt", true, config.ProvenanceDemo)
	execSQL(t, ctx, db, "UPDATE evidence_items SET content='changed' WHERE dispute_id='corrupt'")
	if _, err := ReviewAction(ctx, "corrupt", "PROVIDE_EVIDENCE"); httpStatus(err) != http.StatusUnprocessableEntity {
		t.Errorf("FAIL stale evidence checksum blocks approval: %v", err)
	}
	insertApprovalFixture(t, ctx, db, "unverified", true, config.ProvenanceDemo)
	execSQL(t, ctx, db, "UPDATE ai_drafts SET verified=0 WHERE dispute_id='unverified'")
	if _, err := ReviewAction(ctx, "unverified", "PROVIDE_EVIDENCE"); httpStatus(err) != http.StatusUnprocessableEntity {
		t.Errorf("FAIL unverified evidence submission blocked: %v", err)
	}

	// Expired or unknown deadlines block execution.
	for _, deadline := range []string{"invalid", "2000-01-01T00:00:00Z"} {
		execSQL(t, ctx, db, "UPDATE disputes SET response_deadline=? WHERE id='strict'", deadline)
		if _, err := ReviewAction(ctx, "strict", "ACCEPT_CLAIM"); httpStatus(err) != http.StatusUnprocessableEntity {
			t.Errorf("FAIL expired or unknown deadline blocks execution (%s): %v", deadline, err)
		}
	}

	// Resolved disputes cannot start an operation.
	insertApprovalFixture(t, ctx, db, "resolved", true, config.ProvenanceDemo)
	execSQL(t, ctx, db, "UPDATE disputes SET status='RESOLVED' WHERE id='resolved'")
	if _, err := ReviewAction(ctx, "resolved", "ACCEPT_CLAIM"); httpStatus(err) != http.StatusConflict {
		t.Errorf("FAIL resolved dispute cannot start operation: %v", err)
	}

	// Acceptance needs no evidence draft and records the actor on acknowledgement.
	insertApprovalFixture(t, ctx, db, "no-draft", false, config.ProvenanceDemo)
	acceptance, err := ReviewAction(ctx, "no-draft", "ACCEPT_CLAIM")
	if err != nil {
		t.Fatalf("ReviewAction(no-draft): %v", err)
	}
	check(acceptance["snapshot"].(map[string]any)["draft_id"] == nil,
		"acceptance can be reviewed without an evidence draft")
	status, body, err := ExecuteApproval(ctx, "no-draft", "ACCEPT_CLAIM", acceptance["snapshot_digest"].(string))
	if err != nil {
		t.Fatalf("ExecuteApproval(no-draft): %v", err)
	}
	check(status == http.StatusOK && body["success"] == true, "acceptance without a draft executes")
	op := opFor("no-draft")
	check(op != nil && op.ExecutedAt.Valid && op.Approver == merchantID,
		"execution time and actor recorded after acknowledgement")
	check(op != nil && op.State == "SUCCEEDED", "acknowledged operation is recorded")
	var disputeStatus string
	if err := db.QueryRow(ctx, "SELECT status FROM disputes WHERE id='no-draft'").Scan(&disputeStatus); err != nil {
		t.Fatalf("query no-draft status: %v", err)
	}
	check(disputeStatus == string(types.StatusUnderReview), "acceptance awaits authoritative resolution")
}

// TestApprovalExecutionConcurrency ports the concurrency, uncertainty and
// snapshot-binding half of scripts/test-approvals.ts. It runs in sandbox mode so
// the real client serializes through an injected transport.
func TestApprovalExecutionConcurrency(t *testing.T) {
	configureEnv(t, config.ModeSandbox, merchantID)
	ctx, db := merchantContext(t, merchantID, config.ModeSandbox)
	transport := installMockTransport(t)

	check := func(condition bool, label string) {
		t.Helper()
		if !condition {
			t.Errorf("FAIL %s", label)
		}
	}
	opFor := func(id string) *operation {
		t.Helper()
		op, err := operationFor(ctx, id)
		if err != nil {
			t.Fatalf("operationFor %s: %v", id, err)
		}
		return op
	}
	provideCalls := func() int {
		n := 0
		for _, r := range transport.snapshot() {
			if strings.Contains(r.url, "/provide-evidence") {
				n++
			}
		}
		return n
	}

	insertApprovalFixture(t, ctx, db, "concurrent", true, config.ProvenancePayPalSandbox)
	review, err := ReviewAction(ctx, "concurrent", "PROVIDE_EVIDENCE")
	if err != nil {
		t.Fatalf("ReviewAction(concurrent): %v", err)
	}
	digest := review["snapshot_digest"].(string)

	entered := make(chan struct{})
	release := make(chan struct{})
	var enteredOnce sync.Once
	transport.setHandler(func(method, url string, body []byte) (*http.Response, error) {
		enteredOnce.Do(func() { close(entered) })
		<-release
		return jsonResponse(http.StatusOK, `{"id":"SIMULATED"}`), nil
	})

	firstCh := make(chan callResult, 1)
	go func() {
		status, body, err := ExecuteApproval(ctx, "concurrent", "PROVIDE_EVIDENCE", digest)
		firstCh <- callResult{status: status, body: body, err: err}
	}()

	<-entered
	op := opFor("concurrent")
	check(op != nil && op.State == "SUBMITTING" && !op.ExecutedAt.Valid,
		"reservation precedes provider call without claiming execution")

	if status, _, err := ExecuteApproval(ctx, "concurrent", "PROVIDE_EVIDENCE", digest); err != nil || status != http.StatusAccepted {
		t.Errorf("FAIL concurrent duplicate sees existing in-progress operation: %d %v", status, err)
	}
	if _, _, err := ExecuteApproval(ctx, "concurrent", "ACCEPT_CLAIM", digest); httpStatus(err) != http.StatusConflict {
		t.Errorf("FAIL competing action cannot bypass dispute reservation: %v", err)
	}
	check(provideCalls() == 1, "concurrent requests call provider exactly once")

	var sent capturedRequest
	for _, r := range transport.snapshot() {
		if strings.Contains(r.url, "/provide-evidence") {
			sent = r
		}
	}
	wantBody, err := json.Marshal(review["snapshot"].(map[string]any)["provider_payload"])
	if err != nil {
		t.Fatalf("marshal reviewed payload: %v", err)
	}
	check(string(sent.body) == string(wantBody), "provider receives the persisted reviewed payload")
	check(sent.header.Get("PayPal-Request-Id") == op.IdempotencyKey,
		"provider receives stable operation identity")

	// A resolution that arrives while the provider call is in flight must win.
	execSQL(t, ctx, db, "UPDATE disputes SET status='RESOLVED',outcome='RESOLVED_BUYER_FAVOUR',updated_at=? WHERE id='concurrent'", config.NowISO())
	close(release)
	first := <-firstCh
	if first.err != nil {
		t.Fatalf("concurrent execution: %v", first.err)
	}
	check(first.status == http.StatusOK, "concurrent execution succeeds")
	check(first.body["dispute"].(types.Dispute).Status == string(types.StatusResolved),
		"submission cannot overwrite resolution received while awaiting provider")

	callsBeforeRetry := provideCalls()
	retryStatus, retryBody, err := ExecuteApproval(ctx, "concurrent", "PROVIDE_EVIDENCE", digest)
	if err != nil {
		t.Fatalf("retry concurrent: %v", err)
	}
	check(retryStatus == http.StatusOK, "completed retry returns saved result")
	check(reflect.DeepEqual(normalizeJSON(t, retryBody), normalizeJSON(t, first.body)),
		"completed retry returns the saved result")
	check(provideCalls() == callsBeforeRetry, "completed retry performs no new provider call")

	if _, err := db.Exec(ctx, "UPDATE approval_operations SET snapshot='{}' WHERE dispute_id='concurrent'"); err == nil {
		t.Error("FAIL database rejects snapshot mutation")
	} else {
		check(true, "database rejects snapshot mutation")
	}

	// A provider exception is not proof the provider did nothing.
	insertApprovalFixture(t, ctx, db, "timeout", true, config.ProvenancePayPalSandbox)
	timeoutReview, err := ReviewAction(ctx, "timeout", "PROVIDE_EVIDENCE")
	if err != nil {
		t.Fatalf("ReviewAction(timeout): %v", err)
	}
	timeoutDigest := timeoutReview["snapshot_digest"].(string)
	transport.setHandler(func(method, url string, body []byte) (*http.Response, error) {
		return nil, errors.New("simulated connection loss after sending")
	})
	timeoutBefore := provideCalls()
	status, body, err := ExecuteApproval(ctx, "timeout", "PROVIDE_EVIDENCE", timeoutDigest)
	if err != nil {
		t.Fatalf("ExecuteApproval(timeout): %v", err)
	}
	check(status == http.StatusConflict && body["state"] == "UNCERTAIN", "provider exception persists uncertain outcome")
	op = opFor("timeout")
	check(op != nil && !op.ExecutedAt.Valid, "uncertain operation is not marked executed")
	if status, _, err := ExecuteApproval(ctx, "timeout", "PROVIDE_EVIDENCE", timeoutDigest); err != nil || status != http.StatusConflict || provideCalls() != timeoutBefore+1 {
		t.Errorf("FAIL uncertain operation cannot automatically resubmit: %d %v", status, err)
	}
	uncertain, err := ReviewAction(ctx, "timeout", "PROVIDE_EVIDENCE")
	if err != nil {
		t.Fatalf("ReviewAction(timeout) reload: %v", err)
	}
	check(uncertain["operation"].(map[string]any)["state"] == "UNCERTAIN",
		"status remains visible after reloading review")
}

// TestApprovalProviderTransport ports the transport-binding section of
// scripts/test-approvals.ts: the provider must receive exactly the reviewed
// payload and a stable request id, with no invented facts.
func TestApprovalProviderTransport(t *testing.T) {
	configureEnv(t, config.ModeSandbox, merchantID)
	ctx, db := merchantContext(t, merchantID, config.ModeSandbox)
	transport := installMockTransport(t)

	insertApprovalFixture(t, ctx, db, "transport", true, config.ProvenancePayPalSandbox)

	evidenceReview, err := ReviewAction(ctx, "transport", "PROVIDE_EVIDENCE")
	if err != nil {
		t.Fatalf("ReviewAction(transport, PROVIDE_EVIDENCE): %v", err)
	}
	acceptanceReview, err := ReviewAction(ctx, "transport", "ACCEPT_CLAIM")
	if err != nil {
		t.Fatalf("ReviewAction(transport, ACCEPT_CLAIM): %v", err)
	}

	evidenceSnapshot := snapshotToAction(evidenceReview["snapshot"].(map[string]any))
	acceptanceSnapshot := snapshotToAction(acceptanceReview["snapshot"].(map[string]any))

	if _, err := paypal.Default.ProvideEvidence(ctx, "transport", evidenceSnapshot, "stable-test"); err != nil {
		t.Fatalf("ProvideEvidence: %v", err)
	}
	if _, err := paypal.Default.AcceptClaim(ctx, "transport", acceptanceSnapshot, "stable-accept"); err != nil {
		t.Fatalf("AcceptClaim: %v", err)
	}

	var provideReq, acceptReq *capturedRequest
	for i := range transport.snapshot() {
		r := transport.snapshot()[i]
		if strings.Contains(r.url, "/provide-evidence") {
			req := r
			provideReq = &req
		}
		if strings.Contains(r.url, "/accept-claim") {
			req := r
			acceptReq = &req
		}
	}
	if provideReq == nil || acceptReq == nil {
		t.Fatalf("expected provider requests were not captured")
	}

	wantEvidence, err := json.Marshal(evidenceReview["snapshot"].(map[string]any)["provider_payload"])
	if err != nil {
		t.Fatalf("marshal evidence payload: %v", err)
	}
	wantAcceptance, err := json.Marshal(acceptanceReview["snapshot"].(map[string]any)["provider_payload"])
	if err != nil {
		t.Fatalf("marshal acceptance payload: %v", err)
	}
	if string(provideReq.body) != string(wantEvidence) {
		t.Errorf("FAIL provider transport sends exactly the reviewed evidence body")
	}
	if string(acceptReq.body) != string(wantAcceptance) {
		t.Errorf("FAIL provider transport sends exactly the reviewed acceptance body")
	}
	if provideReq.header.Get("PayPal-Request-Id") != "stable-test" {
		t.Errorf("FAIL provider transport sends the stable request id: %q", provideReq.header.Get("PayPal-Request-Id"))
	}
	if strings.Contains(string(provideReq.body), "TRK-98214-USPS") {
		t.Errorf("FAIL provider does not invent tracking numbers")
	}
	if strings.Contains(string(acceptReq.body), "DID_NOT_SHIP_ITEM") {
		t.Errorf("FAIL provider does not invent an acceptance reason")
	}
}

// --- reconciliation suite ----------------------------------------------------

// TestReconciliationOutcomes ports the observation, staleness, conflict and
// failure handling of scripts/test-reconciliation.ts.
func TestReconciliationOutcomes(t *testing.T) {
	configureEnv(t, config.ModeSandbox, merchantID)
	ctx, db := merchantContext(t, merchantID, config.ModeSandbox)
	transport := installMockTransport(t)

	check := func(condition bool, label string) {
		t.Helper()
		if !condition {
			t.Errorf("FAIL %s", label)
		}
	}
	now := config.NowISO()
	nowMs, err := paypal.Timestamp(now)
	if err != nil {
		t.Fatalf("parse now: %v", err)
	}
	old := config.FormatISO(time.Now().Add(-5 * time.Minute))
	older := config.FormatISO(time.Now().Add(-10 * time.Minute))

	fixture := func(id, state, updated, provenance string) {
		t.Helper()
		insertReconciliationFixture(t, ctx, db, id, state, updated, provenance)
	}
	readStatus := func(id string) string {
		t.Helper()
		var status string
		if err := db.QueryRow(ctx, "SELECT status FROM disputes WHERE id=?", id).Scan(&status); err != nil {
			t.Fatalf("read status %s: %v", id, err)
		}
		return status
	}
	opState := func(id string) string {
		t.Helper()
		op, err := operationFor(ctx, id)
		if err != nil {
			t.Fatalf("operationFor %s: %v", id, err)
		}
		if op == nil {
			return ""
		}
		return op.State
	}
	opExecuted := func(id string) bool {
		t.Helper()
		op, err := operationFor(ctx, id)
		if err != nil {
			t.Fatalf("operationFor %s: %v", id, err)
		}
		return op != nil && op.ExecutedAt.Valid
	}
	countRec := func(id string) int {
		t.Helper()
		var n int
		if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM dispute_reconciliations WHERE dispute_id=?", id).Scan(&n); err != nil {
			t.Fatalf("count reconciliations %s: %v", id, err)
		}
		return n
	}
	leaseToken := func(id string) (string, bool) {
		t.Helper()
		var token string
		err := db.QueryRow(ctx, "SELECT token FROM reconciliation_leases WHERE dispute_id=?", id).Scan(&token)
		if errors.Is(err, sql.ErrNoRows) {
			return "", false
		}
		if err != nil {
			t.Fatalf("read lease %s: %v", id, err)
		}
		return token, true
	}
	versionExists := func(providerID string) bool {
		t.Helper()
		var n int
		if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM paypal_dispute_versions WHERE paypal_dispute_id=?", providerID).Scan(&n); err != nil {
			t.Fatalf("count versions %s: %v", providerID, err)
		}
		return n > 0
	}
	getCalls := func() int {
		n := 0
		for _, r := range transport.snapshot() {
			if r.method == http.MethodGet && strings.Contains(r.url, "/v1/customer/disputes/") {
				n++
			}
		}
		return n
	}
	detail := func(id, status, at string) string {
		return `{"dispute_id":"PP-` + id + `","status":"` + status + `","update_time":"` + at +
			`","dispute_amount":{"value":"10.00","currency_code":"USD"}}`
	}
	respond := func(body string) {
		transport.setHandler(func(method, url string, b []byte) (*http.Response, error) {
			return jsonResponse(http.StatusOK, body), nil
		})
	}

	// Merchant isolation conceals foreign disputes before any provider lookup.
	fixture("auth", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	foreignCtx, err := scope.With(context.Background(), foreignID, config.ModeSandbox, testAccount(foreignID))
	if err != nil {
		t.Fatalf("foreign scope: %v", err)
	}
	if _, _, err := ReconcileDispute(foreignCtx, "auth"); httpStatus(err) != http.StatusNotFound {
		t.Errorf("FAIL foreign merchant cannot reconcile: %v", err)
	}
	if _, err := ReconciliationHistory(foreignCtx, "auth"); httpStatus(err) != http.StatusNotFound {
		t.Errorf("FAIL foreign merchant cannot read history: %v", err)
	}

	// Active submissions cannot be reconciled early.
	respond(detail("fresh", "UNDER_REVIEW", now))
	fixture("fresh", "SUBMITTING", now, string(config.ProvenancePayPalSandbox))
	if _, _, err := ReconcileDispute(ctx, "fresh"); httpStatus(err) != http.StatusConflict {
		t.Errorf("FAIL active submission cannot be reconciled early: %v", err)
	}
	check(opState("fresh") == "SUBMITTING", "active submission state is preserved")

	// Acknowledged operations are not reclassified.
	fixture("success", "SUCCEEDED", old, string(config.ProvenancePayPalSandbox))
	if _, _, err := ReconcileDispute(ctx, "success"); httpStatus(err) != http.StatusConflict {
		t.Errorf("FAIL acknowledged operation is not reclassified: %v", err)
	}

	// Mismatched provenance is rejected before any provider lookup.
	fixture("wrong-origin", "UNCERTAIN", old, string(config.ProvenanceDemo))
	if _, _, err := ReconcileDispute(ctx, "wrong-origin"); httpStatus(err) != http.StatusUnprocessableEntity {
		t.Errorf("FAIL mismatched record provenance rejected: %v", err)
	}
	check(getCalls() == 0, "authorization and state checks run before provider lookup")

	// A stale submission is recovered by provider observation without fabricating
	// an acknowledgement or authorizing a retry.
	fixture("stale-submission", "SUBMITTING", old, string(config.ProvenancePayPalSandbox))
	respond(detail("stale-submission", "UNDER_REVIEW", now))
	status, body, err := ReconcileDispute(ctx, "stale-submission")
	if err != nil {
		t.Fatalf("ReconcileDispute(stale-submission): %v", err)
	}
	check(status == http.StatusOK && body["result"] == "APPLIED", "provider lifecycle observation updates stale local state")
	check(body["dispute"].(types.Dispute).Status == string(types.StatusUnderReview), "stale submission observes UNDER_REVIEW")
	check(opState("stale-submission") == "UNCERTAIN" && !opExecuted("stale-submission"),
		"stale submission becomes uncertain without fabricated acknowledgement")
	check(body["retry_allowed"] == false, "reconciliation never authorizes a blind retry")

	prior := getCalls()
	if _, _, err := ReconcileDispute(ctx, "stale-submission"); httpStatus(err) != http.StatusTooManyRequests || getCalls() != prior {
		t.Errorf("FAIL repeated reconciliation respects cooldown: %v", err)
	}

	history, err := ReconciliationHistory(ctx, "stale-submission")
	if err != nil {
		t.Fatalf("ReconciliationHistory(stale-submission): %v", err)
	}
	entries := history["history"].([]map[string]any)
	check(len(entries) == 1 && entries[0]["actor"] == merchantID, "history exposes the actor")
	check(history["operation"].(map[string]any)["provider_request_id"] == "key-stale-submission",
		"history exposes stable provider request identity")

	if _, err := db.Exec(ctx, "UPDATE dispute_reconciliations SET message='forged'"); err == nil {
		t.Error("FAIL reconciliation observations are immutable")
	}
	if _, err := db.Exec(ctx, "DELETE FROM dispute_reconciliations"); err == nil {
		t.Error("FAIL reconciliation observations cannot be deleted")
	}
	check(true, "reconciliation observations are immutable")

	// The original approval retry still cannot resubmit.
	beforeRetry := getCalls()
	if status, _, err := ExecuteApproval(ctx, "stale-submission", "ACCEPT_CLAIM", strings.Repeat("0", 64)); err != nil || status != http.StatusConflict || getCalls() != beforeRetry {
		t.Errorf("FAIL original approval retry still cannot resubmit: %d %v", status, err)
	}

	// A provider resolution is stored without inventing a seller win.
	fixture("terminal", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	respond(`{"dispute_id":"PP-terminal","status":"RESOLVED","update_time":"` + now +
		`","dispute_amount":{"value":"10.00","currency_code":"USD"},"dispute_outcome":{"outcome_code":"RESOLVED_BUYER_FAVOUR"}}`)
	_, terminalBody, err := ReconcileDispute(ctx, "terminal")
	if err != nil {
		t.Fatalf("ReconcileDispute(terminal): %v", err)
	}
	check(terminalBody["dispute"].(types.Dispute).Outcome.Str() == "RESOLVED_BUYER_FAVOUR",
		"provider outcome is stored without inventing a seller win")
	check(opState("terminal") == "UNCERTAIN" && !opExecuted("terminal"),
		"terminal dispute does not prove our operation executed")

	// A missing provider outcome stays unknown.
	fixture("unknown-outcome", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	respond(detail("unknown-outcome", "RESOLVED", now))
	_, unknownBody, err := ReconcileDispute(ctx, "unknown-outcome")
	if err != nil {
		t.Fatalf("ReconcileDispute(unknown-outcome): %v", err)
	}
	check(!unknownBody["dispute"].(types.Dispute).Outcome.Valid, "missing provider outcome remains unknown")

	// An older provider snapshot cannot overwrite newer webhook state.
	fixture("stale", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	execSQL(t, ctx, db, "INSERT INTO paypal_dispute_versions VALUES(?,?,?)", "PP-stale", nowMs, "webhook-new")
	respond(detail("stale", "UNDER_REVIEW", older))
	_, staleBody, err := ReconcileDispute(ctx, "stale")
	if err != nil {
		t.Fatalf("ReconcileDispute(stale): %v", err)
	}
	check(staleBody["result"] == "STALE" && readStatus("stale") == string(types.StatusRequiredAction),
		"older provider snapshot cannot overwrite newer webhook state")

	// An equal-version conflicting snapshot requires review.
	fixture("tied", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	execSQL(t, ctx, db, "INSERT INTO paypal_dispute_versions VALUES(?,?,?)", "PP-tied", nowMs, "webhook-tie")
	respond(detail("tied", "UNDER_REVIEW", now))
	_, tiedBody, err := ReconcileDispute(ctx, "tied")
	if err != nil {
		t.Fatalf("ReconcileDispute(tied): %v", err)
	}
	check(tiedBody["result"] == "CONFLICT", "conflicting equal-version snapshot requires review")

	// A terminal dispute cannot reopen automatically.
	fixture("closed", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	execSQL(t, ctx, db, "UPDATE disputes SET status='RESOLVED' WHERE id='closed'")
	respond(detail("closed", "UNDER_REVIEW", now))
	_, closedBody, err := ReconcileDispute(ctx, "closed")
	if err != nil {
		t.Fatalf("ReconcileDispute(closed): %v", err)
	}
	check(closedBody["result"] == "CONFLICT" && readStatus("closed") == string(types.StatusResolved),
		"terminal dispute cannot reopen automatically")

	// Invalid provider observations fail closed and are still recorded once.
	invalid := []struct{ id, body string }{
		{"wrong-id", detail("different", "UNDER_REVIEW", now)},
		{"missing-time", `{"dispute_id":"PP-missing-time","status":"RESOLVED"}`},
		{"bad-status", detail("bad-status", "UNKNOWN", now)},
		{"bad-amount", `{"dispute_id":"PP-bad-amount","status":"UNDER_REVIEW","update_time":"` + now +
			`","dispute_amount":{"value":"99.00","currency_code":"USD"}}`},
		{"bad-date", `{"dispute_id":"PP-bad-date","status":"UNDER_REVIEW","update_time":"` + now +
			`","dispute_amount":{"value":"10.00","currency_code":"USD"},"seller_response_due_date":"yesterday"}`},
		{"bad-outcome", `{"dispute_id":"PP-bad-outcome","status":"UNDER_REVIEW","update_time":"` + now +
			`","dispute_amount":{"value":"10.00","currency_code":"USD"},"dispute_outcome":{}}`},
	}
	for _, tc := range invalid {
		fixture(tc.id, "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
		respond(tc.body)
		status, _, err := ReconcileDispute(ctx, tc.id)
		check(err == nil && status == http.StatusBadGateway &&
			readStatus(tc.id) == string(types.StatusRequiredAction) && countRec(tc.id) == 1,
			"invalid provider observation fails closed: "+tc.id)
	}

	// Provider failures are recorded without success or leaked details, and the
	// lease is always released so the attempt can be retried.
	failures := []struct {
		id      string
		handler func(method, url string, body []byte) (*http.Response, error)
	}{
		{"timeout", func(method, url string, body []byte) (*http.Response, error) {
			return nil, errors.New("private provider failure")
		}},
		{"provider-404", func(method, url string, body []byte) (*http.Response, error) {
			return jsonResponse(http.StatusNotFound, "sensitive details"), nil
		}},
		{"invalid-json", func(method, url string, body []byte) (*http.Response, error) {
			return jsonResponse(http.StatusOK, "{"), nil
		}},
		{"oversized", func(method, url string, body []byte) (*http.Response, error) {
			return jsonResponse(http.StatusOK, strings.Repeat("x", 1024*1024+1)), nil
		}},
	}
	for _, tc := range failures {
		fixture(tc.id, "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
		transport.setHandler(tc.handler)
		status, body, err := ReconcileDispute(ctx, tc.id)
		encoded, _ := json.Marshal(body)
		check(err == nil && status == http.StatusBadGateway && body["result"] == "ERROR",
			"provider failure recorded without success: "+tc.id)
		check(!strings.Contains(string(encoded), "sensitive") && !strings.Contains(string(encoded), "private provider"),
			"provider failure does not leak details: "+tc.id)
		if _, exists := leaseToken(tc.id); exists {
			t.Errorf("FAIL failure releases lease: %s", tc.id)
		}
	}

	// Concurrent callers perform a single provider lookup.
	fixture("concurrent", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	entered := make(chan struct{})
	release := make(chan struct{})
	var enteredOnce sync.Once
	transport.setHandler(func(method, url string, body []byte) (*http.Response, error) {
		enteredOnce.Do(func() { close(entered) })
		<-release
		return jsonResponse(http.StatusOK, detail("concurrent", "UNDER_REVIEW", now)), nil
	})
	firstCh := make(chan callResult, 1)
	go func() {
		status, body, err := ReconcileDispute(ctx, "concurrent")
		firstCh <- callResult{status: status, body: body, err: err}
	}()
	<-entered
	beforeConcurrent := getCalls()
	if _, _, err := ReconcileDispute(ctx, "concurrent"); httpStatus(err) != http.StatusConflict || getCalls() != beforeConcurrent {
		t.Errorf("FAIL concurrent callers perform one provider lookup: %v", err)
	}
	execSQL(t, ctx, db, "UPDATE disputes SET status='RESOLVED',updated_at=? WHERE id='concurrent'", now)
	close(release)
	concurrentRes := <-firstCh
	if concurrentRes.err != nil {
		t.Fatalf("ReconcileDispute(concurrent): %v", concurrentRes.err)
	}
	check(concurrentRes.body["result"] == "SUPERSEDED" && readStatus("concurrent") == string(types.StatusResolved),
		"webhook change during lookup wins over stale observation")

	// A late acknowledgement is preserved.
	fixture("late-ack", "SUBMITTING", old, string(config.ProvenancePayPalSandbox))
	ackEntered := make(chan struct{})
	ackRelease := make(chan struct{})
	var ackOnce sync.Once
	transport.setHandler(func(method, url string, body []byte) (*http.Response, error) {
		ackOnce.Do(func() { close(ackEntered) })
		<-ackRelease
		return jsonResponse(http.StatusOK, detail("late-ack", "UNDER_REVIEW", now)), nil
	})
	ackCh := make(chan callResult, 1)
	go func() {
		status, body, err := ReconcileDispute(ctx, "late-ack")
		ackCh <- callResult{status: status, body: body, err: err}
	}()
	<-ackEntered
	execSQL(t, ctx, db, "UPDATE approval_operations SET state='SUCCEEDED',executed_at=? WHERE dispute_id='late-ack'", now)
	close(ackRelease)
	ackRes := <-ackCh
	if ackRes.err != nil {
		t.Fatalf("ReconcileDispute(late-ack): %v", ackRes.err)
	}
	check(ackRes.body["result"] == "SUPERSEDED" && opState("late-ack") == "SUCCEEDED",
		"late acknowledgement is preserved")

	// An expired lease from a crashed worker can be recovered.
	fixture("crash-lease", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	execSQL(t, ctx, db, "INSERT INTO reconciliation_leases VALUES(?,?,?)", "crash-lease", "dead-process", config.NowMillis()-1)
	respond(detail("crash-lease", "UNDER_REVIEW", now))
	status, _, err = ReconcileDispute(ctx, "crash-lease")
	check(err == nil && status == http.StatusOK, "expired lease from crashed worker can be recovered")

	// A superseded worker cannot apply its response or release another lease.
	fixture("replaced-lease", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	leaseEntered := make(chan struct{})
	leaseRelease := make(chan struct{})
	var leaseOnce sync.Once
	transport.setHandler(func(method, url string, body []byte) (*http.Response, error) {
		leaseOnce.Do(func() { close(leaseEntered) })
		<-leaseRelease
		return jsonResponse(http.StatusOK, detail("replaced-lease", "UNDER_REVIEW", now)), nil
	})
	oldWorkerCh := make(chan callResult, 1)
	go func() {
		status, body, err := ReconcileDispute(ctx, "replaced-lease")
		oldWorkerCh <- callResult{status: status, body: body, err: err}
	}()
	<-leaseEntered
	execSQL(t, ctx, db, "UPDATE reconciliation_leases SET token='new-worker',expires_at=? WHERE dispute_id='replaced-lease'", config.NowMillis()+90000)
	close(leaseRelease)
	oldWorker := <-oldWorkerCh
	check(httpStatus(oldWorker.err) == http.StatusConflict && readStatus("replaced-lease") == string(types.StatusRequiredAction),
		"superseded worker cannot apply its response")
	if token, exists := leaseToken("replaced-lease"); !exists || token != "new-worker" {
		t.Errorf("FAIL old worker cannot release another worker lease: %q %v", token, exists)
	}

	// Waiting for evidence is not proof the earlier request failed.
	fixture("waiting", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	respond(detail("waiting", "WAITING_FOR_SELLER_RESPONSE", now))
	_, waitingBody, err := ReconcileDispute(ctx, "waiting")
	if err != nil {
		t.Fatalf("ReconcileDispute(waiting): %v", err)
	}
	check(waitingBody["result"] == "UNCHANGED" && waitingBody["retry_allowed"] == false && opState("waiting") == "UNCERTAIN",
		"provider waiting for evidence is not proof the earlier request failed")

	// Failed observation persistence rolls back the whole unit of work and emits
	// no notification; a retry then succeeds and notifies after commit.
	events, cancel := realtime.Default().Subscribe(realtime.Channel(config.ModeSandbox, merchantID))
	t.Cleanup(cancel)
	var notes []realtime.Event
	drain := func() {
		for {
			select {
			case ev := <-events:
				notes = append(notes, ev)
			default:
				return
			}
		}
	}
	drain()

	fixture("rollback", "UNCERTAIN", old, string(config.ProvenancePayPalSandbox))
	execSQL(t, ctx, db, `CREATE TRIGGER fail_reconciliation BEFORE INSERT ON dispute_reconciliations
		WHEN NEW.dispute_id='rollback' BEGIN SELECT RAISE(ABORT,'injected failure'); END;`)
	respond(detail("rollback", "UNDER_REVIEW", now))
	if _, _, err := ReconcileDispute(ctx, "rollback"); err == nil {
		t.Error("FAIL failed observation persistence returns an error")
	}
	check(readStatus("rollback") == string(types.StatusRequiredAction), "failed observation persistence rolls back lifecycle")
	check(!versionExists("PP-rollback"), "failed observation persistence rolls back provider version")
	drain()
	check(len(notes) == 0, "rollback emits no reconciliation notification")

	execSQL(t, ctx, db, "DROP TRIGGER fail_reconciliation")
	status, _, err = ReconcileDispute(ctx, "rollback")
	check(err == nil && status == http.StatusOK, "database failure can be retried safely")
	drain()
	check(len(notes) == 1 && notes[0].Type == "DISPUTE_RECONCILED", "successful state synchronization emits notification after commit")

	// Reconciliation only ever reads provider state from the fixed sandbox origin.
	sawPaymentAction, sawForeignURL := false, false
	for _, r := range transport.snapshot() {
		if strings.HasSuffix(r.url, "/oauth2/token") {
			continue
		}
		if r.method != http.MethodGet {
			sawPaymentAction = true
		}
		if !strings.HasPrefix(r.url, "https://api-m.sandbox.paypal.com/v1/customer/disputes/") {
			sawForeignURL = true
		}
	}
	check(!sawPaymentAction, "reconciliation transport never calls a payment action")
	check(!sawForeignURL, "provider reads use fixed sandbox origin and dispute endpoint")

	// Demo mode cannot query provider state.
	demoCtx, err := scope.With(context.Background(), merchantID, config.ModeDemo, testAccount(merchantID))
	if err != nil {
		t.Fatalf("demo scope: %v", err)
	}
	if _, err := paypal.Default.GetDisputeDetails(demoCtx, "missing"); err == nil {
		t.Error("FAIL demo cannot query provider state")
	}
	check(true, "demo cannot query provider state")
}

func TestAdditionalDisputeActions(t *testing.T) {
	configureEnv(t, config.ModeSandbox, merchantID)
	transport := installMockTransport(t)
	transport.setHandler(func(method, url string, body []byte) (*http.Response, error) {
		return jsonResponse(http.StatusOK, `{"status":"UNDER_REVIEW"}`), nil
	})
	ctx, err := scope.With(context.Background(), merchantID, config.ModeSandbox, testAccount(merchantID))
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("store.Merchant: %v", err)
	}
	const now = "2026-10-14T10:00:00.000Z"
	deadline := config.FormatISO(time.Now().Add(48 * time.Hour))

	execSQL(t, ctx, db, `INSERT INTO disputes (id,paypal_dispute_id,transaction_id,reason,amount_cents,status,response_deadline,created_at,updated_at,provenance)
		VALUES('dsp_actions','PP-ACT-1','TX-ACT-1','MERCHANDISE_OR_SERVICE_NOT_RECEIVED',5000,'REQUIRED_ACTION',?,?,?,'PAYPAL_SANDBOX')`,
		deadline, now, now)

	// 1. MAKE_OFFER
	offerReview, err := ReviewAction(ctx, "dsp_actions", "MAKE_OFFER")
	if err != nil {
		t.Fatalf("ReviewAction(MAKE_OFFER): %v", err)
	}
	digestOffer := offerReview["snapshot_digest"].(string)
	if digestOffer == "" {
		t.Errorf("expected non-empty digest for MAKE_OFFER")
	}
	status, res, err := ExecuteApproval(ctx, "dsp_actions", "MAKE_OFFER", digestOffer)
	if err != nil {
		t.Fatalf("ExecuteApproval(MAKE_OFFER): %v", err)
	}
	if status != http.StatusOK || res["state"] != "SUCCEEDED" {
		t.Errorf("expected SUCCEEDED for MAKE_OFFER, got %v", res)
	}

	// Reset dispute for ESCALATE
	execSQL(t, ctx, db, "DELETE FROM approval_operations WHERE dispute_id='dsp_actions'")
	execSQL(t, ctx, db, "DELETE FROM approvals WHERE dispute_id='dsp_actions'")
	execSQL(t, ctx, db, "UPDATE disputes SET status='REQUIRED_ACTION' WHERE id='dsp_actions'")

	// 2. ESCALATE
	escReview, err := ReviewAction(ctx, "dsp_actions", "ESCALATE")
	if err != nil {
		t.Fatalf("ReviewAction(ESCALATE): %v", err)
	}
	status, res, err = ExecuteApproval(ctx, "dsp_actions", "ESCALATE", escReview["snapshot_digest"].(string))
	if err != nil {
		t.Fatalf("ExecuteApproval(ESCALATE): %v", err)
	}
	if status != http.StatusOK || res["state"] != "SUCCEEDED" {
		t.Errorf("expected SUCCEEDED for ESCALATE, got %v", res)
	}

	// Reset dispute for ACKNOWLEDGE_RETURN_ITEM
	execSQL(t, ctx, db, "DELETE FROM approval_operations WHERE dispute_id='dsp_actions'")
	execSQL(t, ctx, db, "DELETE FROM approvals WHERE dispute_id='dsp_actions'")
	execSQL(t, ctx, db, "UPDATE disputes SET status='REQUIRED_ACTION' WHERE id='dsp_actions'")

	// 3. ACKNOWLEDGE_RETURN_ITEM
	retReview, err := ReviewAction(ctx, "dsp_actions", "ACKNOWLEDGE_RETURN_ITEM")
	if err != nil {
		t.Fatalf("ReviewAction(ACKNOWLEDGE_RETURN_ITEM): %v", err)
	}
	status, res, err = ExecuteApproval(ctx, "dsp_actions", "ACKNOWLEDGE_RETURN_ITEM", retReview["snapshot_digest"].(string))
	if err != nil {
		t.Fatalf("ExecuteApproval(ACKNOWLEDGE_RETURN_ITEM): %v", err)
	}
	if status != http.StatusOK || res["state"] != "SUCCEEDED" {
		t.Errorf("expected SUCCEEDED for ACKNOWLEDGE_RETURN_ITEM, got %v", res)
	}
}
