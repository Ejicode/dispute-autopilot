package httpapi

import (
	"net/http"
	"os"

	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/paypal"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
)

// paypalWebhook receives provider events. It has no browser session: the owner
// is selected exclusively by server configuration.
func (a *API) paypalWebhook(w http.ResponseWriter, r *http.Request) {
	if err := a.handleWebhook(w, r); err != nil {
		httpx.Error(w, err)
	}
}

func (a *API) handleWebhook(w http.ResponseWriter, r *http.Request) error {
	mode, err := config.ApplicationMode()
	if err != nil {
		return err
	}
	if mode == config.ModeDemo {
		return writeWebhookResponse(w, http.StatusServiceUnavailable, map[string]any{
			"error": "PayPal webhooks are disabled in demo mode.",
		})
	}
	ownerID := os.Getenv("PAYPAL_MERCHANT_USER_ID")
	if !paypal.Default.IsConfigured() || os.Getenv("PAYPAL_WEBHOOK_ID") == "" || ownerID == "" {
		return writeWebhookResponse(w, http.StatusServiceUnavailable, map[string]any{
			"error": "PayPal webhook integration is not configured.",
		})
	}
	owner, err := auth.AccountByID(r.Context(), ownerID)
	if err != nil {
		return err
	}
	if owner == nil {
		return writeWebhookResponse(w, http.StatusServiceUnavailable, map[string]any{
			"error": "PayPal merchant is not configured.",
		})
	}
	body, err := auth.ReadAuthBody(r, 256*1024)
	if err != nil {
		return err
	}
	ctx, err := scope.With(r.Context(), owner.ID, mode, owner)
	if err != nil {
		return err
	}
	if err := paypal.Default.AssertMerchantAccess(ctx); err != nil {
		return err
	}
	headers := paypal.WebhookHeaders{
		AuthAlgo:         r.Header.Get("paypal-auth-algo"),
		CertURL:          r.Header.Get("paypal-cert-url"),
		TransmissionID:   r.Header.Get("paypal-transmission-id"),
		TransmissionSig:  r.Header.Get("paypal-transmission-sig"),
		TransmissionTime: r.Header.Get("paypal-transmission-time"),
	}
	result := paypal.ProcessPayPalWebhook(ctx, headers, body)

	payload := map[string]any{"status": result.Status, "message": result.Message}
	if result.DisputeID != "" {
		payload["disputeId"] = result.DisputeID
	}
	if result.StatusCode == http.StatusServiceUnavailable {
		w.Header().Set("Retry-After", "30")
	}
	return writeWebhookResponse(w, result.StatusCode, payload)
}

func writeWebhookResponse(w http.ResponseWriter, status int, payload any) error {
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, status, payload)
	return nil
}
