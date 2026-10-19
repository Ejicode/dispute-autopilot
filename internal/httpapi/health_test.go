package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/store"
)

// TestHealthReadiness ports the readiness health checks: the endpoint probes the
// database without authentication and fails readiness when the mode is invalid.
func TestHealthReadiness(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("APP_MODE", "demo")
	store.Close()
	t.Cleanup(store.Close)

	handler := New("")

	call := func() *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
		return rec
	}

	ok := call()
	if ok.Code != http.StatusOK {
		t.Fatalf("health status = %d, want 200", ok.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(ok.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode health body: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("health body = %v", body)
	}
	if cache := ok.Header().Get("Cache-Control"); cache != "no-store" {
		t.Fatalf("health Cache-Control = %q, want no-store", cache)
	}

	t.Setenv("APP_MODE", "invalid")
	unavailable := call()
	if unavailable.Code != http.StatusServiceUnavailable {
		t.Fatalf("invalid mode health status = %d, want 503", unavailable.Code)
	}
}
