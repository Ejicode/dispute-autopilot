package paypal

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

const (
	testMerchant  = "usr_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	otherMerchant = "usr_ffffffffffffffffffffffffffffffff"
)

type recordingTransport struct {
	mu       sync.Mutex
	calls    []string
	response func(*http.Request) (*http.Response, error)
}

func (rt *recordingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.mu.Lock()
	rt.calls = append(rt.calls, req.URL.String())
	rt.mu.Unlock()
	if rt.response != nil {
		return rt.response(req)
	}
	return jsonResponse(req, http.StatusOK, `{}`), nil
}

func (rt *recordingTransport) urls() []string {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return append([]string(nil), rt.calls...)
}

func jsonResponse(req *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}

func installRecordingClient(t *testing.T) *recordingTransport {
	t.Helper()
	rt := &recordingTransport{}
	previous := http.DefaultClient
	http.DefaultClient = &http.Client{Transport: rt}
	t.Cleanup(func() { http.DefaultClient = previous })
	return rt
}

func resetPayPalStore(t *testing.T) {
	t.Helper()
	t.Setenv("DATA_DIR", t.TempDir())
	store.Close()
	t.Cleanup(store.Close)
	t.Cleanup(func() { Default = NewClient() })
}

func paypalContext(t *testing.T, merchant string, mode config.Mode) context.Context {
	t.Helper()
	ctx, err := scope.With(context.Background(), merchant, mode, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	return ctx
}

func insertClientDispute(t *testing.T, ctx context.Context, db *store.Store, id, paypalID, provenance string) {
	t.Helper()
	const now = "2026-10-14T10:00:00.000Z"
	if _, err := db.Exec(ctx, `INSERT INTO disputes
		(id,paypal_dispute_id,transaction_id,reason,amount_cents,status,response_deadline,created_at,updated_at,provenance)
		VALUES(?,?,?,'OTHER',1000,'REQUIRED_ACTION',?,?,?,?)`,
		id, paypalID, "TX-"+id, now, now, now, provenance); err != nil {
		t.Fatalf("insert dispute %s: %v", id, err)
	}
}

func acceptSnapshot(environment, disputeID, paypalID string, evidenceIDs ...string) types.ExactActionSnapshot {
	return types.ExactActionSnapshot{
		Environment:     environment,
		ActionType:      string(types.ActionAcceptClaim),
		DisputeID:       disputeID,
		PayPalDisputeID: paypalID,
		AmountCents:     1000,
		Currency:        "USD",
		EvidenceIDs:     evidenceIDs,
		Notes:           "Seller accepted buyer claim.",
		ProviderPayload: map[string]any{"note": "Seller accepted buyer claim."},
	}
}

func httpStatus(t *testing.T, err error) int {
	t.Helper()
	var he *httpx.HTTPError
	if !errors.As(err, &he) {
		t.Fatalf("expected *httpx.HTTPError, got %T (%v)", err, err)
	}
	return he.Status
}

// TestDemoClientNeverCallsProvider ports the test-environments.ts assertions
// that demo credentials never reach PayPal, never complete a refund, and cannot
// mint an access token.
func TestDemoClientNeverCallsProvider(t *testing.T) {
	resetPayPalStore(t)
	t.Setenv("APP_MODE", "demo")
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("PAYPAL_CLIENT_ID", "test-id")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", "")
	Default = NewClient()

	ctx := paypalContext(t, "demo", config.ModeDemo)
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("store.Merchant: %v", err)
	}
	insertClientDispute(t, ctx, db, "demo", "PP-demo", string(config.ProvenanceDemo))

	transport := installRecordingClient(t)
	client := NewClient()
	result, err := client.AcceptClaim(ctx, "demo", acceptSnapshot("demo", "demo", "PP-demo"), "demo-operation")
	if err != nil {
		t.Fatalf("demo AcceptClaim: %v", err)
	}
	if !result.Success {
		t.Fatalf("demo AcceptClaim should succeed as a simulation")
	}
	payload, ok := result.Result.(map[string]any)
	if !ok {
		t.Fatalf("unexpected result type %T", result.Result)
	}
	if payload["simulation"] != true {
		t.Fatalf("demo result is not marked as a simulation: %#v", payload)
	}
	if _, present := payload["refund_completed"]; present {
		t.Fatalf("demo simulation must not report a completed refund")
	}
	if calls := transport.urls(); len(calls) != 0 {
		t.Fatalf("demo credentials caused provider calls: %v", calls)
	}

	if _, err := client.GetAccessToken(ctx); err == nil {
		t.Fatalf("demo must not acquire provider tokens")
	} else if status := httpStatus(t, err); status != http.StatusServiceUnavailable {
		t.Fatalf("demo token status = %d, want 503", status)
	}

	var provenance string
	if err := db.QueryRow(ctx, "SELECT provenance FROM disputes WHERE id='demo'").Scan(&provenance); err != nil {
		t.Fatalf("read provenance: %v", err)
	}
	if provenance != string(config.ProvenanceDemo) {
		t.Fatalf("demo provenance = %q, want DEMO", provenance)
	}
}

// TestOperationalClientGuards ports the sandbox/live provider guard checks:
// missing credentials, wrong environment, and cross-merchant ownership all fail
// closed before any network access.
func TestOperationalClientGuards(t *testing.T) {
	resetPayPalStore(t)
	t.Setenv("PAYPAL_CLIENT_ID", "test-id")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")

	t.Run("missing credentials cannot simulate success", func(t *testing.T) {
		t.Setenv("APP_MODE", "sandbox")
		t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
		t.Setenv("PAYPAL_CLIENT_ID", "")
		t.Setenv("PAYPAL_CLIENT_SECRET", "")
		t.Setenv("PAYPAL_MERCHANT_USER_ID", testMerchant)
		transport := installRecordingClient(t)

		ctx := paypalContext(t, testMerchant, config.ModeSandbox)
		if _, err := NewClient().AcceptClaim(ctx, "missing", acceptSnapshot("sandbox", "missing", "PP-missing"), "op"); err == nil {
			t.Fatalf("sandbox transport should require credentials")
		} else if status := httpStatus(t, err); status != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503", status)
		}
		if calls := transport.urls(); len(calls) != 0 {
			t.Fatalf("missing credentials should not reach the provider: %v", calls)
		}
	})

	t.Run("credentials cannot cross merchant ownership", func(t *testing.T) {
		t.Setenv("APP_MODE", "sandbox")
		t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
		t.Setenv("PAYPAL_MERCHANT_USER_ID", otherMerchant)
		transport := installRecordingClient(t)

		ctx := paypalContext(t, testMerchant, config.ModeSandbox)
		if _, err := NewClient().AcceptClaim(ctx, "x", acceptSnapshot("sandbox", "x", "PP-x"), "op"); err == nil {
			t.Fatalf("cross-merchant credentials should have been rejected")
		} else if status := httpStatus(t, err); status != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", status)
		}
		if calls := transport.urls(); len(calls) != 0 {
			t.Fatalf("cross-merchant credentials reached the provider: %v", calls)
		}
	})

	t.Run("environment mismatch fails before network", func(t *testing.T) {
		t.Setenv("APP_MODE", "live")
		t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
		t.Setenv("PAYPAL_MERCHANT_USER_ID", testMerchant)
		transport := installRecordingClient(t)

		ctx := paypalContext(t, testMerchant, config.ModeLive)
		if _, err := NewClient().AcceptClaim(ctx, "x", acceptSnapshot("live", "x", "PP-x"), "op"); err == nil {
			t.Fatalf("sandbox-configured client must be rejected in live mode")
		} else if status := httpStatus(t, err); status != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want 503", status)
		}
		if calls := transport.urls(); len(calls) != 0 {
			t.Fatalf("environment mismatch reached the provider: %v", calls)
		}
	})
}

// TestClientEndpointSelection ports the "sandbox/live adapter uses only matching
// endpoints" assertions: the base URL follows PAYPAL_ENVIRONMENT and defaults to
// sandbox.
func TestClientEndpointSelection(t *testing.T) {
	const sandboxBase = "https://api-m.sandbox.paypal.com"
	const liveBase = "https://api-m.paypal.com"

	t.Run("defaults to sandbox", func(t *testing.T) {
		t.Setenv("PAYPAL_ENVIRONMENT", "")
		client := NewClient()
		if client.environment != "sandbox" || client.baseURL != sandboxBase {
			t.Fatalf("default client = %q/%q", client.environment, client.baseURL)
		}
	})
	t.Run("sandbox", func(t *testing.T) {
		t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
		client := NewClient()
		if client.environment != "sandbox" || client.baseURL != sandboxBase {
			t.Fatalf("sandbox client = %q/%q", client.environment, client.baseURL)
		}
	})
	t.Run("live", func(t *testing.T) {
		t.Setenv("PAYPAL_ENVIRONMENT", "live")
		client := NewClient()
		if client.environment != "live" || client.baseURL != liveBase {
			t.Fatalf("live client = %q/%q", client.environment, client.baseURL)
		}
	})
}

// TestSandboxTransportFlow drives a successful operational acceptance against a
// stub provider and asserts that only the configured (sandbox) endpoint is used
// and the response is returned verbatim.
func TestSandboxTransportFlow(t *testing.T) {
	resetPayPalStore(t)
	t.Setenv("APP_MODE", "sandbox")
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("PAYPAL_CLIENT_ID", "test-id")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", testMerchant)

	var (
		mu     sync.Mutex
		paths  []string
		server *httptest.Server
	)
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/token") {
			_, _ = w.Write([]byte(`{"access_token":"token","expires_in":3600}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"UNDER_REVIEW"}`))
	}))
	t.Cleanup(server.Close)

	ctx := paypalContext(t, testMerchant, config.ModeSandbox)
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("store.Merchant: %v", err)
	}
	insertClientDispute(t, ctx, db, "sandbox", "PP-sandbox", string(config.ProvenancePayPalSandbox))

	client := &Client{baseURL: server.URL, environment: "sandbox", clientID: "test-id", clientSecret: "test-secret"}
	result, err := client.AcceptClaim(ctx, "sandbox", acceptSnapshot("sandbox", "sandbox", "PP-sandbox"), "sandbox-op")
	if err != nil {
		t.Fatalf("sandbox AcceptClaim: %v", err)
	}
	if !result.Success {
		t.Fatalf("sandbox AcceptClaim should succeed")
	}
	payload, ok := result.Result.(map[string]any)
	if !ok || payload["status"] != "UNDER_REVIEW" {
		t.Fatalf("unexpected transport result: %#v", result.Result)
	}
	mu.Lock()
	got := append([]string(nil), paths...)
	mu.Unlock()
	want := []string{"/v1/oauth2/token", "/v1/customer/disputes/PP-sandbox/accept-claim"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("provider paths = %v, want %v", got, want)
	}
}

// TestClientRejectsWrongRecordProvenance ports "transport rejects incorrect
// provenance" and "provider transport rejects demo evidence in a reviewed
// action" without touching the network.
func TestClientRejectsWrongRecordProvenance(t *testing.T) {
	resetPayPalStore(t)
	t.Setenv("APP_MODE", "sandbox")
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("PAYPAL_CLIENT_ID", "test-id")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", testMerchant)
	transport := installRecordingClient(t)

	ctx := paypalContext(t, testMerchant, config.ModeSandbox)
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("store.Merchant: %v", err)
	}
	insertClientDispute(t, ctx, db, "unknown", "PP-unknown", string(config.ProvenanceUnknown))
	insertClientDispute(t, ctx, db, "foreign", "PP-foreign", string(config.ProvenanceDemo))
	insertClientDispute(t, ctx, db, "sandbox", "PP-sandbox", string(config.ProvenancePayPalSandbox))

	client := NewClient()
	for _, id := range []string{"unknown", "foreign"} {
		if _, err := client.AcceptClaim(ctx, id, acceptSnapshot("sandbox", id, "PP-"+id), "blocked"); err == nil {
			t.Fatalf("record %s with mismatched provenance should be rejected", id)
		} else if status := httpStatus(t, err); status != http.StatusUnprocessableEntity {
			t.Fatalf("%s status = %d, want 422", id, status)
		}
	}

	// A reviewed snapshot from another environment is rejected.
	if _, err := client.AcceptClaim(ctx, "sandbox", acceptSnapshot("demo", "sandbox", "PP-sandbox"), "blocked"); err == nil {
		t.Fatalf("cross-environment snapshot should be rejected")
	}

	// Demo evidence attached to an operational action is rejected.
	if _, err := db.Exec(ctx, `INSERT INTO evidence_items
		(id,dispute_id,evidence_type,source,title,content,sha256_hash,captured_at,provenance)
		VALUES('demo-evidence','sandbox','TRACKING_HISTORY','CARRIER_SIMULATOR','Demo','{}','unused','2026-10-14T10:00:00.000Z','DEMO')`); err != nil {
		t.Fatalf("insert demo evidence: %v", err)
	}
	if _, err := client.AcceptClaim(ctx, "sandbox", acceptSnapshot("sandbox", "sandbox", "PP-sandbox", "demo-evidence"), "blocked"); err == nil {
		t.Fatalf("demo evidence should be rejected in an operational action")
	}

	if calls := transport.urls(); len(calls) != 0 {
		t.Fatalf("provenance rejections reached the provider: %v", calls)
	}
}
