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

// TestDisputeIDStaysInOnePathSegment ensures a stored PayPal dispute ID cannot
// redirect a provider call to another PayPal endpoint.
func TestDisputeIDStaysInOnePathSegment(t *testing.T) {
	resetPayPalStore(t)
	t.Setenv("APP_MODE", "sandbox")
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("PAYPAL_CLIENT_ID", "test-id")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", testMerchant)

	var (
		mu   sync.Mutex
		uris []string
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		uris = append(uris, r.RequestURI)
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
	const hostile = "PP-../../v1/payments/refunds"
	insertClientDispute(t, ctx, db, "hostile", hostile, string(config.ProvenancePayPalSandbox))

	client := &Client{baseURL: server.URL, environment: "sandbox", clientID: "test-id", clientSecret: "test-secret"}
	if _, err := client.AcceptClaim(ctx, "hostile", acceptSnapshot("sandbox", "hostile", hostile), "hostile-op"); err != nil {
		t.Fatalf("AcceptClaim: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	want := "/v1/customer/disputes/PP-..%2F..%2Fv1%2Fpayments%2Frefunds/accept-claim"
	if len(uris) != 2 || uris[1] != want {
		t.Fatalf("provider request URIs = %v, want second to be %s", uris, want)
	}
}

func TestProvideEvidenceWithDocumentsMultipart(t *testing.T) {
	resetPayPalStore(t)
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("PAYPAL_CLIENT_ID", "test-id")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", testMerchant)

	var (
		capturedContentType string
		capturedInputJSON   string
		capturedFileBytes   []byte
		capturedFileName    string
		capturedIdempKey    string
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/token") {
			_, _ = w.Write([]byte(`{"access_token":"token-123","expires_in":3600}`))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/provide-evidence") {
			capturedContentType = r.Header.Get("Content-Type")
			capturedIdempKey = r.Header.Get("PayPal-Request-Id")

			mr, err := r.MultipartReader()
			if err != nil {
				t.Errorf("MultipartReader error: %v", err)
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			for {
				part, err := mr.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Errorf("NextPart error: %v", err)
					break
				}
				if part.FormName() == "input" {
					b, _ := io.ReadAll(part)
					capturedInputJSON = string(b)
				} else if part.FormName() == "file1" {
					capturedFileName = part.FileName()
					b, _ := io.ReadAll(part)
					capturedFileBytes = b
				}
			}
			_, _ = w.Write([]byte(`{"status":"UNDER_REVIEW","dispute_id":"PP-D-123"}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)

	ctx := paypalContext(t, testMerchant, config.ModeSandbox)
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("store.Merchant: %v", err)
	}
	insertClientDispute(t, ctx, db, "dsp_doc_test", "PP-D-DOCS", string(config.ProvenancePayPalSandbox))

	client := &Client{baseURL: server.URL, environment: "sandbox", clientID: "test-id", clientSecret: "test-secret"}
	action := types.ExactActionSnapshot{
		Environment:     "sandbox",
		ActionType:      string(types.ActionProvideEvidence),
		DisputeID:       "dsp_doc_test",
		PayPalDisputeID: "PP-D-DOCS",
		AmountCents:     1000,
		Currency:        "USD",
		ProviderPayload: map[string]any{
			"evidences": []any{
				map[string]any{
					"evidence_type": "PROOF_OF_FULFILLMENT",
					"notes":         "Item delivered with carrier tracking and signature confirmation.",
				},
			},
		},
	}

	testDocBytes := []byte("%PDF-1.4 test delivery confirmation slip")
	docs := []EvidenceDocument{
		{
			Name:        "delivery_slip.pdf",
			ContentType: "application/pdf",
			Data:        testDocBytes,
		},
	}

	call, err := client.ProvideEvidenceWithDocuments(ctx, "dsp_doc_test", action, "doc-idemp-1", docs)
	if err != nil {
		t.Fatalf("ProvideEvidenceWithDocuments: %v", err)
	}
	if !call.Success {
		t.Fatalf("expected call.Success=true")
	}

	if !strings.HasPrefix(capturedContentType, "multipart/form-data; boundary=") {
		t.Errorf("expected Content-Type to start with multipart/form-data, got %q", capturedContentType)
	}
	if capturedIdempKey != "doc-idemp-1" {
		t.Errorf("expected PayPal-Request-Id=doc-idemp-1, got %q", capturedIdempKey)
	}
	if !strings.Contains(capturedInputJSON, `"name":"delivery_slip.pdf"`) {
		t.Errorf("expected input JSON to contain delivery_slip.pdf document, got: %s", capturedInputJSON)
	}
	if capturedFileName != "delivery_slip.pdf" {
		t.Errorf("expected file1 filename=delivery_slip.pdf, got %q", capturedFileName)
	}
	if string(capturedFileBytes) != string(testDocBytes) {
		t.Errorf("expected file bytes %q, got %q", string(testDocBytes), string(capturedFileBytes))
	}
}

func TestProvideEvidenceWithDocumentsDemo(t *testing.T) {
	resetPayPalStore(t)
	ctx := paypalContext(t, testMerchant, config.ModeDemo)
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("store.Merchant: %v", err)
	}
	insertClientDispute(t, ctx, db, "dsp_demo_docs", "PP-D-DEMO-DOCS", "DEMO")

	client := NewClient()
	action := types.ExactActionSnapshot{
		Environment:     "demo",
		ActionType:      string(types.ActionProvideEvidence),
		DisputeID:       "dsp_demo_docs",
		PayPalDisputeID: "PP-D-DEMO-DOCS",
		AmountCents:     1000,
		Currency:        "USD",
		ProviderPayload: map[string]any{"evidences": []any{}},
	}
	docs := []EvidenceDocument{
		{
			Name:        "receipt.pdf",
			ContentType: "application/pdf",
			Data:        []byte("demo PDF"),
		},
	}

	call, err := client.ProvideEvidenceWithDocuments(ctx, "dsp_demo_docs", action, "demo-doc-key", docs)
	if err != nil {
		t.Fatalf("ProvideEvidenceWithDocuments demo: %v", err)
	}
	if !call.Success {
		t.Fatalf("expected call.Success=true in demo mode")
	}
	resMap, ok := call.Result.(map[string]any)
	if !ok || resMap["documents_count"] != 1 {
		t.Errorf("expected documents_count=1 in demo result, got %v", call.Result)
	}
}

func TestSendTracker(t *testing.T) {
	resetPayPalStore(t)
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("PAYPAL_CLIENT_ID", "test-id")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", testMerchant)

	var (
		capturedURI     string
		capturedBody    string
		capturedIdemp   string
		capturedAuthHdr string
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/token") {
			_, _ = w.Write([]byte(`{"access_token":"token-tracker","expires_in":3600}`))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/shipping/trackers-batch") {
			capturedURI = r.RequestURI
			capturedAuthHdr = r.Header.Get("Authorization")
			capturedIdemp = r.Header.Get("PayPal-Request-Id")
			b, _ := io.ReadAll(r.Body)
			capturedBody = string(b)
			_, _ = w.Write([]byte(`{"tracker_identifiers":[{"transaction_id":"tx-999","tracking_number":"TRK-123-USPS"}],"errors":[]}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(server.Close)

	ctx := paypalContext(t, testMerchant, config.ModeSandbox)
	client := &Client{baseURL: server.URL, environment: "sandbox", clientID: "test-id", clientSecret: "test-secret"}

	call, err := client.SendTracker(ctx, TrackerInfo{
		TransactionID:  "tx-999",
		TrackingNumber: "TRK-123-USPS",
		Status:         "IN_TRANSIT",
		Carrier:        "USPS",
		NotifyBuyer:    false,
	})
	if err != nil {
		t.Fatalf("SendTracker: %v", err)
	}
	if !call.Success {
		t.Fatalf("expected call.Success=true")
	}

	if capturedURI != "/v1/shipping/trackers-batch" {
		t.Errorf("expected URI /v1/shipping/trackers-batch, got %q", capturedURI)
	}
	if capturedAuthHdr != "Bearer token-tracker" {
		t.Errorf("expected Bearer token-tracker, got %q", capturedAuthHdr)
	}
	if capturedIdemp == "" {
		t.Errorf("expected non-empty PayPal-Request-Id")
	}
	if !strings.Contains(capturedBody, `"tracking_number":"TRK-123-USPS"`) ||
		!strings.Contains(capturedBody, `"carrier":"USPS"`) ||
		!strings.Contains(capturedBody, `"status":"IN_TRANSIT"`) {
		t.Errorf("unexpected body: %s", capturedBody)
	}
}

func TestSendTrackerDemo(t *testing.T) {
	resetPayPalStore(t)
	ctx := paypalContext(t, testMerchant, config.ModeDemo)

	client := NewClient()
	call, err := client.SendTracker(ctx, TrackerInfo{
		TransactionID:  "tx-demo-123",
		TrackingNumber: "TRK-DEMO-USPS",
		Status:         "LABEL_CREATED",
		Carrier:        "USPS",
	})
	if err != nil {
		t.Fatalf("SendTracker demo: %v", err)
	}
	if !call.Success {
		t.Fatalf("expected call.Success=true in demo mode")
	}
	resMap, ok := call.Result.(map[string]any)
	if !ok || resMap["status"] != "SHIPPED" {
		t.Errorf("expected mapped status=SHIPPED, got %v", call.Result)
	}
}
