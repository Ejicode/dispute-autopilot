package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/paypal"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

// TestWebhookDisabledInDemoEvenWithCredentials ports "public webhook is disabled
// in demo even with credentials": demo mode rejects provider callbacks (503)
// before any configuration, signature or provider access is consulted.
func TestWebhookDisabledInDemoEvenWithCredentials(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("APP_MODE", "demo")
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("PAYPAL_CLIENT_ID", "test-id")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_WEBHOOK_ID", "test-webhook")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	paypal.Default = paypal.NewClient()
	t.Cleanup(func() { paypal.Default = paypal.NewClient() })
	store.Close()
	t.Cleanup(store.Close)

	handler := New("")
	req := httptest.NewRequest(http.MethodPost, "/api/webhooks/paypal",
		strings.NewReader(`{"id":"mode-event","event_type":"PAYMENT.CAPTURE.COMPLETED"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("demo webhook status = %d, want 503", rec.Code)
	}
}
