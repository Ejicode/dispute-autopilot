package paypal

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// Client is the audited PayPal REST transport. Credentials come only from the
// server environment; the browser can never select them.
type Client struct {
	baseURL      string
	environment  string
	clientID     string
	clientSecret string

	mu              sync.Mutex
	cachedToken     string
	cachedExpiresAt int64
}

// NewClient reads PayPal configuration from the environment.
func NewClient() *Client {
	env := os.Getenv("PAYPAL_ENVIRONMENT")
	if env == "" {
		env = "sandbox"
	}
	base := "https://api-m.sandbox.paypal.com"
	if env == "live" {
		base = "https://api-m.paypal.com"
	}
	return &Client{
		baseURL:      base,
		environment:  env,
		clientID:     os.Getenv("PAYPAL_CLIENT_ID"),
		clientSecret: os.Getenv("PAYPAL_CLIENT_SECRET"),
	}
}

// Default is the process-wide client.
var Default = NewClient()

// IsConfigured reports whether credentials are present.
func (c *Client) IsConfigured() bool { return c.clientID != "" && c.clientSecret != "" }

// AssertMerchantAccess rejects cross-environment or cross-merchant use.
func (c *Client) AssertMerchantAccess(ctx context.Context) error {
	sc, err := scope.From(ctx)
	if err != nil {
		return err
	}
	if sc.Mode == config.ModeDemo {
		return nil // Demo ignores credentials and never uses the transport.
	}
	if !c.IsConfigured() {
		return httpx.Errorf(http.StatusServiceUnavailable, "PayPal credentials are required in operational modes.")
	}
	if c.environment != string(sc.Mode) {
		return httpx.Errorf(http.StatusServiceUnavailable, "PAYPAL_ENVIRONMENT must match APP_MODE.")
	}
	if sc.MerchantID != os.Getenv("PAYPAL_MERCHANT_USER_ID") {
		return httpx.Errorf(http.StatusForbidden, "PayPal is not connected to this merchant workspace.")
	}
	return nil
}

func (c *Client) assertAction(ctx context.Context, disputeID string, action types.ExactActionSnapshot) error {
	if err := c.AssertMerchantAccess(ctx); err != nil {
		return err
	}
	sc, _ := scope.From(ctx)
	if action.Environment != string(sc.Mode) {
		return httpx.Errorf(http.StatusUnprocessableEntity, "Reviewed action belongs to a different environment.")
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return err
	}
	var id, paypalDisputeID, provenance string
	var orderID types.NullableString
	err = db.QueryRow(ctx, "SELECT id, paypal_dispute_id, order_id, provenance FROM disputes WHERE id = ?", disputeID).
		Scan(&id, &paypalDisputeID, &orderID, &provenance)
	if err != nil || action.DisputeID != disputeID || action.PayPalDisputeID != paypalDisputeID {
		return httpx.Errorf(http.StatusUnprocessableEntity, "Reviewed dispute identity does not match.")
	}
	if err := runtime.RequireMatchingProvenance(ctx, provenance); err != nil {
		return err
	}
	for _, evidenceID := range action.EvidenceIDs {
		var evidenceProvenance string
		var evidenceDispute, evidenceOrder types.NullableString
		err := db.QueryRow(ctx, "SELECT provenance, dispute_id, order_id FROM evidence_items WHERE id = ?", evidenceID).
			Scan(&evidenceProvenance, &evidenceDispute, &evidenceOrder)
		if err != nil || (evidenceDispute.Str() != id && (orderID.Str() == "" || evidenceOrder.Str() != orderID.Str())) {
			return httpx.Errorf(http.StatusUnprocessableEntity, "Reviewed evidence is unavailable.")
		}
		if err := runtime.RequireMatchingProvenance(ctx, evidenceProvenance); err != nil {
			return err
		}
	}
	return nil
}

// GetAccessToken returns a cached OAuth 2.0 token.
func (c *Client) GetAccessToken(ctx context.Context) (string, error) {
	if err := c.AssertMerchantAccess(ctx); err != nil {
		return "", err
	}
	sc, _ := scope.From(ctx)
	if sc.Mode == config.ModeDemo {
		return "", httpx.Errorf(http.StatusServiceUnavailable, "Demo mode does not request PayPal access tokens.")
	}

	c.mu.Lock()
	if c.cachedToken != "" && c.cachedExpiresAt > time.Now().UnixMilli()+60000 {
		token := c.cachedToken
		c.mu.Unlock()
		return token, nil
	}
	c.mu.Unlock()

	basic := base64.StdEncoding.EncodeToString([]byte(c.clientID + ":" + c.clientSecret))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/oauth2/token",
		strings.NewReader("grant_type=client_credentials"))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Basic "+basic)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := doJSON(req, 15000)
	if err != nil {
		return "", err
	}
	if res.status != http.StatusOK {
		return "", fmt.Errorf("PayPal OAuth failed (%d): %s", res.status, res.text)
	}
	var data struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(res.body, &data); err != nil {
		return "", err
	}
	if data.ExpiresIn == 0 {
		data.ExpiresIn = 3600
	}
	c.mu.Lock()
	c.cachedToken = data.AccessToken
	c.cachedExpiresAt = time.Now().UnixMilli() + data.ExpiresIn*1000
	c.mu.Unlock()
	return data.AccessToken, nil
}

// ProviderCall wraps a provider response, matching the original
// `{success, result}` contract the approval layer persists.
type ProviderCall struct {
	Success bool `json:"success"`
	Result  any  `json:"result"`
}

// ProvideEvidence submits reviewed evidence to the Disputes API.
func (c *Client) ProvideEvidence(ctx context.Context, disputeID string, action types.ExactActionSnapshot, idempotencyKey string) (ProviderCall, error) {
	if action.ActionType != string(types.ActionProvideEvidence) || action.ProviderPayload == nil {
		return ProviderCall{}, fmt.Errorf("A reviewed evidence request is required.")
	}
	if err := c.assertAction(ctx, disputeID, action); err != nil {
		return ProviderCall{}, err
	}

	sc, _ := scope.From(ctx)
	if sc.Mode == config.ModeDemo {
		if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_PROVIDE_EVIDENCE_MOCK", map[string]any{
			"dispute_id":      disputeID,
			"idempotency_key": idempotencyKey,
			"payload":         action.ProviderPayload,
			"status":          "SUCCESS",
		}, &disputeID); err != nil {
			return ProviderCall{}, err
		}
		return ProviderCall{Success: true, Result: map[string]any{
			"dispute_id":      disputeID,
			"status":          "UNDER_REVIEW",
			"acknowledged_at": config.NowISO(),
			"idempotency_key": idempotencyKey,
			"simulation":      true,
		}}, nil
	}

	token, err := c.GetAccessToken(ctx)
	if err != nil {
		return ProviderCall{}, err
	}
	requestBody, err := json.Marshal(action.ProviderPayload)
	if err != nil {
		return ProviderCall{}, err
	}
	endpoint := c.baseURL + "/v1/customer/disputes/" + action.PayPalDisputeID + "/provide-evidence"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(requestBody))
	if err != nil {
		return ProviderCall{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("PayPal-Request-Id", idempotencyKey)

	res, err := doJSON(req, 30000)
	if err != nil {
		return ProviderCall{}, err
	}
	result := decodeLoose(res.body, res.text)
	if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_PROVIDE_EVIDENCE", map[string]any{
		"dispute_id":      disputeID,
		"http_status":     res.status,
		"idempotency_key": idempotencyKey,
		"response":        result,
	}, &disputeID); err != nil {
		return ProviderCall{}, err
	}
	if res.status < 200 || res.status >= 300 {
		return ProviderCall{}, fmt.Errorf("PayPal API provide-evidence failed (%d): %s", res.status, res.text)
	}
	return ProviderCall{Success: true, Result: result}, nil
}

// AcceptClaim accepts the buyer claim and refunds.
func (c *Client) AcceptClaim(ctx context.Context, disputeID string, action types.ExactActionSnapshot, idempotencyKey string) (ProviderCall, error) {
	if action.ActionType != string(types.ActionAcceptClaim) || action.ProviderPayload == nil {
		return ProviderCall{}, fmt.Errorf("A reviewed acceptance request is required.")
	}
	if err := c.assertAction(ctx, disputeID, action); err != nil {
		return ProviderCall{}, err
	}

	sc, _ := scope.From(ctx)
	if sc.Mode == config.ModeDemo {
		if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_ACCEPT_CLAIM_MOCK", map[string]any{
			"dispute_id":      disputeID,
			"idempotency_key": idempotencyKey,
			"notes":           action.Notes,
		}, &disputeID); err != nil {
			return ProviderCall{}, err
		}
		return ProviderCall{Success: true, Result: map[string]any{
			"dispute_id": disputeID,
			"status":     "UNDER_REVIEW",
			"simulation": true,
		}}, nil
	}

	token, err := c.GetAccessToken(ctx)
	if err != nil {
		return ProviderCall{}, err
	}
	requestBody, err := json.Marshal(action.ProviderPayload)
	if err != nil {
		return ProviderCall{}, err
	}
	endpoint := c.baseURL + "/v1/customer/disputes/" + action.PayPalDisputeID + "/accept-claim"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(requestBody))
	if err != nil {
		return ProviderCall{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("PayPal-Request-Id", idempotencyKey)

	res, err := doJSON(req, 30000)
	if err != nil {
		return ProviderCall{}, err
	}
	result := decodeLoose(res.body, res.text)
	if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_ACCEPT_CLAIM", map[string]any{
		"dispute_id":      disputeID,
		"http_status":     res.status,
		"idempotency_key": idempotencyKey,
		"response":        result,
	}, &disputeID); err != nil {
		return ProviderCall{}, err
	}
	if res.status < 200 || res.status >= 300 {
		return ProviderCall{}, fmt.Errorf("PayPal API accept-claim failed (%d): %s", res.status, res.text)
	}
	return ProviderCall{Success: true, Result: result}, nil
}

// GetDisputeDetails reads current provider state without following redirects or
// retaining provider messages and attachments.
func (c *Client) GetDisputeDetails(ctx context.Context, disputeID string) (any, error) {
	if err := c.AssertMerchantAccess(ctx); err != nil {
		return nil, err
	}
	sc, _ := scope.From(ctx)
	if sc.Mode == config.ModeDemo {
		return nil, httpx.Errorf(http.StatusConflict, "Provider reconciliation is unavailable in demo mode.")
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}
	dispute, err := fetchDispute(ctx, db, disputeID)
	if err != nil {
		return nil, httpx.Errorf(http.StatusNotFound, "Dispute not found.")
	}
	if err := runtime.RequireMatchingProvenance(ctx, dispute.Provenance); err != nil {
		return nil, err
	}
	if !identifierPattern.MatchString(dispute.PayPalDisputeID) {
		return nil, httpx.Errorf(http.StatusUnprocessableEntity, "Invalid provider dispute identity.")
	}

	token, err := c.GetAccessToken(ctx)
	if err != nil {
		return nil, err
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/customer/disputes/"+dispute.PayPalDisputeID, nil)
	if err != nil {
		return nil, httpx.Errorf(http.StatusBadGateway, "Unable to retrieve PayPal dispute details. No action was retried.")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return nil, httpx.Errorf(http.StatusBadGateway, "Unable to retrieve PayPal dispute details. No action was retried.")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, httpx.Errorf(http.StatusBadGateway, "Unable to retrieve PayPal dispute details. No action was retried.")
	}
	limited := io.LimitReader(res.Body, 1024*1024+1)
	body, err := io.ReadAll(limited)
	if err != nil || len(body) > 1024*1024 {
		return nil, httpx.Errorf(http.StatusBadGateway, "Unable to retrieve PayPal dispute details. No action was retried.")
	}
	var parsed any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, httpx.Errorf(http.StatusBadGateway, "Unable to retrieve PayPal dispute details. No action was retried.")
	}
	return parsed, nil
}

// VerifyParams carries the signature verification inputs.
type VerifyParams struct {
	AuthAlgo         string
	CertURL          string
	TransmissionID   string
	TransmissionSig  string
	TransmissionTime string
	WebhookID        string
	WebhookEvent     any
}

// VerifyWebhookSignature asks PayPal to verify a webhook signature.
func (c *Client) VerifyWebhookSignature(ctx context.Context, params VerifyParams) (bool, error) {
	sc, _ := scope.From(ctx)
	if sc.Mode == config.ModeDemo || !c.IsConfigured() {
		return false, nil
	}
	if params.WebhookID == "" {
		return false, nil
	}
	token, err := c.GetAccessToken(ctx)
	if err != nil {
		return false, err
	}
	payload, err := json.Marshal(map[string]any{
		"auth_algo":         params.AuthAlgo,
		"cert_url":          params.CertURL,
		"transmission_id":   params.TransmissionID,
		"transmission_sig":  params.TransmissionSig,
		"transmission_time": params.TransmissionTime,
		"webhook_id":        params.WebhookID,
		"webhook_event":     params.WebhookEvent,
	})
	if err != nil {
		return false, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/notifications/verify-webhook-signature", bytes.NewReader(payload))
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	res, err := doJSON(req, 15000)
	if err != nil {
		return false, err
	}
	if res.status < 200 || res.status >= 300 {
		return false, fmt.Errorf("PayPal webhook verification unavailable (%d).", res.status)
	}
	var data struct {
		VerificationStatus string `json:"verification_status"`
	}
	if err := json.Unmarshal(res.body, &data); err != nil {
		return false, err
	}
	return data.VerificationStatus == "SUCCESS", nil
}

type httpResult struct {
	status int
	body   []byte
	text   string
}

func doJSON(req *http.Request, timeoutMs int) (httpResult, error) {
	ctx, cancel := context.WithTimeout(req.Context(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	req = req.WithContext(ctx)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return httpResult{}, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 4*1024*1024))
	if err != nil {
		return httpResult{}, err
	}
	return httpResult{status: res.StatusCode, body: body, text: string(body)}, nil
}

func decodeLoose(body []byte, text string) map[string]any {
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return map[string]any{"raw": text}
	}
	return parsed
}

func fetchDispute(ctx context.Context, db *store.Store, disputeID string) (types.Dispute, error) {
	return store.ScanDispute(db.QueryRow(ctx, "SELECT "+store.DisputeColumns+" FROM disputes WHERE id = ?", disputeID))
}
