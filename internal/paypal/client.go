package paypal

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
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

func (c *Client) syncEnv() {
	if c.clientID == "" {
		c.clientID = os.Getenv("PAYPAL_CLIENT_ID")
	}
	if c.clientSecret == "" {
		c.clientSecret = os.Getenv("PAYPAL_CLIENT_SECRET")
	}
	if c.environment == "" {
		c.environment = os.Getenv("PAYPAL_ENVIRONMENT")
		if c.environment == "" {
			c.environment = "sandbox"
		}
	}
	if c.baseURL == "" {
		if c.environment == "live" {
			c.baseURL = "https://api-m.paypal.com"
		} else {
			c.baseURL = "https://api-m.sandbox.paypal.com"
		}
	}
}

// IsConfigured reports whether credentials are present.
func (c *Client) IsConfigured() bool {
	c.syncEnv()
	return c.clientID != "" && c.clientSecret != ""
}

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

// EvidenceDocument represents an optional binary document attachment (PDF, image)
// uploaded as part of a PayPal dispute evidence submission.
type EvidenceDocument struct {
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Data        []byte `json:"-"`
}

func copyPayload(m map[string]any) map[string]any {
	b, err := json.Marshal(m)
	if err != nil {
		return m
	}
	var res map[string]any
	if err := json.Unmarshal(b, &res); err != nil {
		return m
	}
	return res
}

// ProvideEvidence submits reviewed evidence to the Disputes API without attachments.
func (c *Client) ProvideEvidence(ctx context.Context, disputeID string, action types.ExactActionSnapshot, idempotencyKey string) (ProviderCall, error) {
	return c.ProvideEvidenceWithDocuments(ctx, disputeID, action, idempotencyKey, nil)
}

// ProvideEvidenceWithDocuments submits reviewed evidence to the Disputes API,
// attaching binary documents via multipart/form-data when present.
func (c *Client) ProvideEvidenceWithDocuments(ctx context.Context, disputeID string, action types.ExactActionSnapshot, idempotencyKey string, documents []EvidenceDocument) (ProviderCall, error) {
	if action.ActionType != string(types.ActionProvideEvidence) || action.ProviderPayload == nil {
		return ProviderCall{}, fmt.Errorf("A reviewed evidence request is required.")
	}
	if err := c.assertAction(ctx, disputeID, action); err != nil {
		return ProviderCall{}, err
	}

	sc, _ := scope.From(ctx)
	if sc.Mode == config.ModeDemo {
		auditPayload := map[string]any{
			"dispute_id":      disputeID,
			"idempotency_key": idempotencyKey,
			"payload":         action.ProviderPayload,
			"status":          "SUCCESS",
		}
		if len(documents) > 0 {
			docNames := make([]string, len(documents))
			for i, d := range documents {
				docNames[i] = d.Name
			}
			auditPayload["documents"] = docNames
		}
		if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_PROVIDE_EVIDENCE_MOCK", auditPayload, &disputeID); err != nil {
			return ProviderCall{}, err
		}
		result := map[string]any{
			"dispute_id":      disputeID,
			"status":          "UNDER_REVIEW",
			"acknowledged_at": config.NowISO(),
			"idempotency_key": idempotencyKey,
			"simulation":      true,
		}
		if len(documents) > 0 {
			result["documents_count"] = len(documents)
		}
		return ProviderCall{Success: true, Result: result}, nil
	}

	token, err := c.GetAccessToken(ctx)
	if err != nil {
		return ProviderCall{}, err
	}
	endpoint := c.baseURL + "/v1/customer/disputes/" + url.PathEscape(action.PayPalDisputeID) + "/provide-evidence"

	var req *http.Request
	if len(documents) == 0 {
		requestBody, err := json.Marshal(action.ProviderPayload)
		if err != nil {
			return ProviderCall{}, err
		}
		req, err = http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(requestBody))
		if err != nil {
			return ProviderCall{}, err
		}
		req.Header.Set("Content-Type", "application/json")
	} else {
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)

		// Input JSON part
		inputHeader := make(textproto.MIMEHeader)
		inputHeader.Set("Content-Disposition", `form-data; name="input"`)
		inputHeader.Set("Content-Type", "application/json")
		inputPart, err := writer.CreatePart(inputHeader)
		if err != nil {
			return ProviderCall{}, err
		}

		payloadCopy := copyPayload(action.ProviderPayload)
		if evidences, ok := payloadCopy["evidences"].([]any); ok && len(evidences) > 0 {
			if firstEv, ok := evidences[0].(map[string]any); ok {
				if _, hasDocs := firstEv["documents"]; !hasDocs {
					docList := make([]map[string]any, 0, len(documents))
					for _, doc := range documents {
						docList = append(docList, map[string]any{"name": doc.Name})
					}
					firstEv["documents"] = docList
				}
			}
		}
		inputJSON, err := json.Marshal(payloadCopy)
		if err != nil {
			return ProviderCall{}, err
		}
		if _, err := inputPart.Write(inputJSON); err != nil {
			return ProviderCall{}, err
		}

		// Document file parts: file1, file2, etc.
		for i, doc := range documents {
			fieldName := fmt.Sprintf("file%d", i+1)
			fileHeader := make(textproto.MIMEHeader)
			fileHeader.Set("Content-Disposition", fmt.Sprintf(`form-data; name=%q; filename=%q`, fieldName, doc.Name))
			ct := doc.ContentType
			if ct == "" {
				ct = "application/pdf"
			}
			fileHeader.Set("Content-Type", ct)
			part, err := writer.CreatePart(fileHeader)
			if err != nil {
				return ProviderCall{}, err
			}
			if _, err := part.Write(doc.Data); err != nil {
				return ProviderCall{}, err
			}
		}
		if err := writer.Close(); err != nil {
			return ProviderCall{}, err
		}

		req, err = http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
		if err != nil {
			return ProviderCall{}, err
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("PayPal-Request-Id", idempotencyKey)

	res, err := doJSON(req, 45000)
	if err != nil {
		return ProviderCall{}, err
	}
	result := decodeLoose(res.body, res.text)
	auditPayload := map[string]any{
		"dispute_id":      disputeID,
		"http_status":     res.status,
		"idempotency_key": idempotencyKey,
		"response":        result,
	}
	if len(documents) > 0 {
		auditPayload["documents_count"] = len(documents)
	}
	if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_PROVIDE_EVIDENCE", auditPayload, &disputeID); err != nil {
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
	endpoint := c.baseURL + "/v1/customer/disputes/" + url.PathEscape(action.PayPalDisputeID) + "/accept-claim"
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

func (c *Client) executeDisputeAction(ctx context.Context, disputeID string, action types.ExactActionSnapshot, idempotencyKey, subPath, auditTag string) (ProviderCall, error) {
	if action.ProviderPayload == nil {
		return ProviderCall{}, fmt.Errorf("A reviewed %s request is required.", subPath)
	}
	if err := c.assertAction(ctx, disputeID, action); err != nil {
		return ProviderCall{}, err
	}

	sc, _ := scope.From(ctx)
	if sc.Mode == config.ModeDemo {
		if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_"+auditTag+"_MOCK", map[string]any{
			"dispute_id":      disputeID,
			"idempotency_key": idempotencyKey,
			"notes":           action.Notes,
			"payload":         action.ProviderPayload,
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
	endpoint := c.baseURL + "/v1/customer/disputes/" + url.PathEscape(action.PayPalDisputeID) + "/" + subPath
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
	if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_"+auditTag, map[string]any{
		"dispute_id":      disputeID,
		"http_status":     res.status,
		"idempotency_key": idempotencyKey,
		"response":        result,
	}, &disputeID); err != nil {
		return ProviderCall{}, err
	}
	if res.status < 200 || res.status >= 300 {
		return ProviderCall{}, fmt.Errorf("PayPal API %s failed (%d): %s", subPath, res.status, res.text)
	}
	return ProviderCall{Success: true, Result: result}, nil
}

// AppealDispute appeals a dispute decision with new evidence or notes.
func (c *Client) AppealDispute(ctx context.Context, disputeID string, action types.ExactActionSnapshot, idempotencyKey string) (ProviderCall, error) {
	if action.ActionType != string(types.ActionAppeal) {
		return ProviderCall{}, fmt.Errorf("A reviewed appeal request is required.")
	}
	return c.executeDisputeAction(ctx, disputeID, action, idempotencyKey, "appeal", "APPEAL")
}

// MakeOffer proposes a settlement or partial refund offer to the buyer.
func (c *Client) MakeOffer(ctx context.Context, disputeID string, action types.ExactActionSnapshot, idempotencyKey string) (ProviderCall, error) {
	if action.ActionType != string(types.ActionMakeOffer) {
		return ProviderCall{}, fmt.Errorf("A reviewed make-offer request is required.")
	}
	return c.executeDisputeAction(ctx, disputeID, action, idempotencyKey, "make-offer", "MAKE_OFFER")
}

// EscalateDispute escalates an inquiry to a full PayPal dispute claim.
func (c *Client) EscalateDispute(ctx context.Context, disputeID string, action types.ExactActionSnapshot, idempotencyKey string) (ProviderCall, error) {
	if action.ActionType != string(types.ActionEscalate) {
		return ProviderCall{}, fmt.Errorf("A reviewed escalate request is required.")
	}
	return c.executeDisputeAction(ctx, disputeID, action, idempotencyKey, "escalate", "ESCALATE")
}

// AcknowledgeReturnItem acknowledges receipt of returned merchandise.
func (c *Client) AcknowledgeReturnItem(ctx context.Context, disputeID string, action types.ExactActionSnapshot, idempotencyKey string) (ProviderCall, error) {
	if action.ActionType != string(types.ActionAcknowledgeReturn) {
		return ProviderCall{}, fmt.Errorf("A reviewed return acknowledgement is required.")
	}
	return c.executeDisputeAction(ctx, disputeID, action, idempotencyKey, "acknowledge-return-item", "ACKNOWLEDGE_RETURN_ITEM")
}

// TrackerInfo describes carrier shipment tracking pushed to PayPal's Shipping Trackers API.
type TrackerInfo struct {
	TransactionID  string `json:"transaction_id"`
	TrackingNumber string `json:"tracking_number"`
	Status         string `json:"status"`  // SHIPPED, IN_TRANSIT, DELIVERED, RETURNED, CANCELLED
	Carrier        string `json:"carrier"` // USPS, FEDEX, UPS, DHL, etc.
	NotifyBuyer    bool   `json:"notify_buyer"`
}

// MapCarrierStatusToPayPal translates internal carrier milestone names to PayPal Tracker statuses.
func MapCarrierStatusToPayPal(status string) string {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "LABEL_CREATED", "PICKED_UP", "SHIPPED":
		return "SHIPPED"
	case "IN_TRANSIT", "OUT_FOR_DELIVERY":
		return "IN_TRANSIT"
	case "DELIVERED":
		return "DELIVERED"
	case "RETURNED":
		return "RETURNED"
	case "CANCELLED":
		return "CANCELLED"
	default:
		return "SHIPPED"
	}
}

// NormalizeCarrierForPayPal validates and canonicalizes carrier names for PayPal.
func NormalizeCarrierForPayPal(carrier string) string {
	c := strings.ToUpper(strings.TrimSpace(carrier))
	switch c {
	case "USPS", "FEDEX", "UPS", "DHL", "ONTRACT":
		return c
	default:
		return "USPS"
	}
}

// SendTracker pushes proactive carrier tracking information to PayPal's Shipping Trackers API
// (POST /v1/shipping/trackers-batch).
func (c *Client) SendTracker(ctx context.Context, tracker TrackerInfo) (ProviderCall, error) {
	if tracker.TransactionID == "" || tracker.TrackingNumber == "" {
		return ProviderCall{}, fmt.Errorf("transaction_id and tracking_number are required")
	}

	sc, _ := scope.From(ctx)
	carrierName := NormalizeCarrierForPayPal(tracker.Carrier)
	trackerStatus := MapCarrierStatusToPayPal(tracker.Status)

	if sc.Mode == config.ModeDemo || !c.IsConfigured() {
		if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_SEND_TRACKER_MOCK", map[string]any{
			"transaction_id":  tracker.TransactionID,
			"tracking_number": tracker.TrackingNumber,
			"carrier":         carrierName,
			"status":          trackerStatus,
			"simulation":      true,
		}, nil); err != nil {
			return ProviderCall{}, err
		}
		return ProviderCall{
			Success: true,
			Result: map[string]any{
				"transaction_id":  tracker.TransactionID,
				"tracking_number": tracker.TrackingNumber,
				"status":          trackerStatus,
				"carrier":         carrierName,
				"acknowledged_at": config.NowISO(),
				"simulation":      true,
			},
		}, nil
	}

	token, err := c.GetAccessToken(ctx)
	if err != nil {
		return ProviderCall{}, err
	}

	payload := map[string]any{
		"trackers": []any{
			map[string]any{
				"transaction_id":  tracker.TransactionID,
				"tracking_number": tracker.TrackingNumber,
				"status":          trackerStatus,
				"carrier":         carrierName,
				"notify_buyer":    tracker.NotifyBuyer,
			},
		},
	}
	requestBody, err := json.Marshal(payload)
	if err != nil {
		return ProviderCall{}, err
	}

	endpoint := c.baseURL + "/v1/shipping/trackers-batch"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(requestBody))
	if err != nil {
		return ProviderCall{}, err
	}

	idemp := store.RandomID("trk_", 10)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("PayPal-Request-Id", idemp)

	res, err := doJSON(req, 20000)
	if err != nil {
		return ProviderCall{}, err
	}
	result := decodeLoose(res.body, res.text)
	if _, err := store.Audit(ctx, "paypal", "PAYPAL_API_SEND_TRACKER", map[string]any{
		"transaction_id":  tracker.TransactionID,
		"tracking_number": tracker.TrackingNumber,
		"status":          trackerStatus,
		"carrier":         carrierName,
		"http_status":     res.status,
		"idempotency_key": idemp,
		"response":        result,
	}, nil); err != nil {
		return ProviderCall{}, err
	}

	if res.status < 200 || res.status >= 300 {
		return ProviderCall{}, fmt.Errorf("PayPal Shipping Trackers API failed (%d): %s", res.status, res.text)
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/customer/disputes/"+url.PathEscape(dispute.PayPalDisputeID), nil)
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

// PayPalAddress represents a shipping address structure compatible with PayPal Orders v2.
type PayPalAddress struct {
	AddressLine1 string `json:"address_line_1,omitempty"`
	AddressLine2 string `json:"address_line_2,omitempty"`
	AdminArea2   string `json:"admin_area_2,omitempty"` // City / locality
	AdminArea1   string `json:"admin_area_1,omitempty"` // State / province / region
	PostalCode   string `json:"postal_code,omitempty"`
	CountryCode  string `json:"country_code,omitempty"`
}

// PayPalOrder represents a PayPal Orders v2 resource for order validation.
type PayPalOrder struct {
	ID            string `json:"id"`
	Status        string `json:"status"`
	Intent        string `json:"intent,omitempty"`
	PurchaseUnits []struct {
		ReferenceID string `json:"reference_id,omitempty"`
		Amount      struct {
			CurrencyCode string `json:"currency_code"`
			Value        string `json:"value"`
		} `json:"amount,omitempty"`
		Shipping struct {
			Name struct {
				FullName string `json:"full_name,omitempty"`
			} `json:"name,omitempty"`
			Address PayPalAddress `json:"address,omitempty"`
		} `json:"shipping,omitempty"`
	} `json:"purchase_units,omitempty"`
}

// SellerProtectionVerification captures the result of cross-checking a delivery
// destination against the PayPal transaction address under the PayPal Seller Protection proof-of-delivery rule.
type SellerProtectionVerification struct {
	Eligible        bool     `json:"eligible"`
	PolicySection   string   `json:"policy_section"` // e.g. "Proof of delivery"
	Status          string   `json:"status"`         // "VERIFIED_MATCH", "MISMATCH", "UNVERIFIED"
	Reason          string   `json:"reason"`
	PayPalAddress   string   `json:"paypal_address"`
	DeliveryAddress string   `json:"delivery_address"`
	MismatchFields  []string `json:"mismatch_fields,omitempty"`
}

// FormatAddress converts a PayPalAddress into a normalized readable address string.
func FormatAddress(addr PayPalAddress) string {
	parts := make([]string, 0, 5)
	if addr.AddressLine1 != "" {
		parts = append(parts, addr.AddressLine1)
	}
	if addr.AddressLine2 != "" {
		parts = append(parts, addr.AddressLine2)
	}
	cityStateZip := ""
	if addr.AdminArea2 != "" {
		cityStateZip = addr.AdminArea2
	}
	if addr.AdminArea1 != "" {
		if cityStateZip != "" {
			cityStateZip += ", " + addr.AdminArea1
		} else {
			cityStateZip = addr.AdminArea1
		}
	}
	if addr.PostalCode != "" {
		if cityStateZip != "" {
			cityStateZip += " " + addr.PostalCode
		} else {
			cityStateZip = addr.PostalCode
		}
	}
	if cityStateZip != "" {
		parts = append(parts, cityStateZip)
	}
	if addr.CountryCode != "" {
		parts = append(parts, addr.CountryCode)
	}
	return strings.Join(parts, ", ")
}

// ParseAddressString parses a standard comma-separated address string into a PayPalAddress.
func ParseAddressString(raw string) PayPalAddress {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return PayPalAddress{}
	}
	chunks := strings.Split(raw, ",")
	for i := range chunks {
		chunks[i] = strings.TrimSpace(chunks[i])
	}
	var addr PayPalAddress
	switch len(chunks) {
	case 1:
		addr.AddressLine1 = chunks[0]
	case 2:
		addr.AddressLine1 = chunks[0]
		addr.AdminArea2 = chunks[1]
	case 3:
		addr.AddressLine1 = chunks[0]
		addr.AdminArea2 = chunks[1]
		parseStateZip(chunks[2], &addr)
	default:
		addr.AddressLine1 = chunks[0]
		addr.AdminArea2 = chunks[1]
		parseStateZip(chunks[2], &addr)
		last := chunks[len(chunks)-1]
		if len(last) == 2 && strings.ToUpper(last) == last {
			addr.CountryCode = last
		}
	}
	return addr
}

func parseStateZip(s string, addr *PayPalAddress) {
	fields := strings.Fields(s)
	if len(fields) >= 2 {
		addr.AdminArea1 = fields[0]
		addr.PostalCode = strings.Join(fields[1:], " ")
	} else if len(fields) == 1 {
		if len(fields[0]) == 2 && strings.ToUpper(fields[0]) == fields[0] {
			addr.AdminArea1 = fields[0]
		} else {
			addr.PostalCode = fields[0]
		}
	}
}

func cleanWord(w string) string {
	w = strings.ToLower(strings.TrimSpace(w))
	w = strings.Trim(w, ".,#")
	switch w {
	case "st":
		return "street"
	case "ave", "av":
		return "avenue"
	case "rd":
		return "road"
	case "dr":
		return "drive"
	case "blvd":
		return "boulevard"
	case "ln":
		return "lane"
	case "ct":
		return "court"
	case "cir":
		return "circle"
	case "pkwy":
		return "parkway"
	case "apt":
		return "apartment"
	case "ste":
		return "suite"
	case "fl":
		return "floor"
	}
	return w
}

func normalizeComponent(s string) string {
	words := strings.Fields(s)
	var cleaned []string
	for _, w := range words {
		cw := cleanWord(w)
		if cw != "" {
			cleaned = append(cleaned, cw)
		}
	}
	return strings.Join(cleaned, " ")
}

func cleanZip(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 5 && strings.Contains(s, "-") {
		return strings.Split(s, "-")[0]
	}
	return s
}

// VerifySellerProtectionAddress checks whether the delivery address on proof of delivery
// matches the transaction shipping address in PayPal under the Seller Protection proof-of-delivery rule.
func VerifySellerProtectionAddress(paypalAddr, deliveryAddr PayPalAddress) SellerProtectionVerification {
	ppFormatted := FormatAddress(paypalAddr)
	delFormatted := FormatAddress(deliveryAddr)

	if ppFormatted == "" || delFormatted == "" {
		return SellerProtectionVerification{
			Eligible:        false,
			PolicySection:   "Proof of delivery",
			Status:          "UNVERIFIED",
			Reason:          "Carrier proof of delivery or PayPal transaction address record is missing or pending capture.",
			PayPalAddress:   ppFormatted,
			DeliveryAddress: delFormatted,
		}
	}

	var mismatches []string

	// Check street address line 1
	if normalizeComponent(paypalAddr.AddressLine1) != normalizeComponent(deliveryAddr.AddressLine1) {
		mismatches = append(mismatches, "Street Address")
	}

	// Check City (AdminArea2) if both present
	if paypalAddr.AdminArea2 != "" && deliveryAddr.AdminArea2 != "" {
		if normalizeComponent(paypalAddr.AdminArea2) != normalizeComponent(deliveryAddr.AdminArea2) {
			mismatches = append(mismatches, "City")
		}
	}

	// Check State (AdminArea1) if both present
	if paypalAddr.AdminArea1 != "" && deliveryAddr.AdminArea1 != "" {
		if normalizeComponent(paypalAddr.AdminArea1) != normalizeComponent(deliveryAddr.AdminArea1) {
			mismatches = append(mismatches, "State/Region")
		}
	}

	// Check Postal Code if both present
	if paypalAddr.PostalCode != "" && deliveryAddr.PostalCode != "" {
		if cleanZip(paypalAddr.PostalCode) != cleanZip(deliveryAddr.PostalCode) {
			mismatches = append(mismatches, "Postal Code")
		}
	}

	if len(mismatches) == 0 {
		return SellerProtectionVerification{
			Eligible:        true,
			PolicySection:   "Proof of delivery",
			Status:          "VERIFIED_MATCH",
			Reason:          "Proof of delivery destination matches the PayPal transaction shipping address exactly. The Seller Protection proof-of-delivery requirement is met.",
			PayPalAddress:   ppFormatted,
			DeliveryAddress: delFormatted,
		}
	}

	return SellerProtectionVerification{
		Eligible:        false,
		PolicySection:   "Proof of delivery",
		Status:          "MISMATCH",
		Reason:          fmt.Sprintf("Proof of delivery destination differs from PayPal transaction details (%s). Under the PayPal Seller Protection proof-of-delivery rule, rerouted or altered deliveries void protection.", strings.Join(mismatches, ", ")),
		PayPalAddress:   ppFormatted,
		DeliveryAddress: delFormatted,
		MismatchFields:  mismatches,
	}
}

// GetOrder retrieves a PayPal Checkout order by ID from PayPal REST API, or synthesizes
// the order from the demo database when in demo mode or offline.
func (c *Client) GetOrder(ctx context.Context, orderID string) (*PayPalOrder, error) {
	if orderID == "" {
		return nil, httpx.Errorf(http.StatusBadRequest, "Order ID is required.")
	}
	sc, _ := scope.From(ctx)
	if sc.Mode == config.ModeDemo || !c.IsConfigured() {
		// Look up order in demo_orders table
		db, err := store.Merchant(ctx)
		if err == nil {
			var orderNum, buyerName, shipAddr, curr string
			var totalCents int64
			err := db.QueryRow(ctx, "SELECT order_number, buyer_name, shipping_address, total_cents, currency FROM demo_orders WHERE id = ? OR paypal_order_id = ? OR order_number = ?", orderID, orderID, orderID).
				Scan(&orderNum, &buyerName, &shipAddr, &totalCents, &curr)
			if err == nil {
				parsedAddr := ParseAddressString(shipAddr)
				order := &PayPalOrder{
					ID:     orderID,
					Status: "COMPLETED",
					Intent: "CAPTURE",
				}
				order.PurchaseUnits = append(order.PurchaseUnits, struct {
					ReferenceID string `json:"reference_id,omitempty"`
					Amount      struct {
						CurrencyCode string `json:"currency_code"`
						Value        string `json:"value"`
					} `json:"amount,omitempty"`
					Shipping struct {
						Name struct {
							FullName string `json:"full_name,omitempty"`
						} `json:"name,omitempty"`
						Address PayPalAddress `json:"address,omitempty"`
					} `json:"shipping,omitempty"`
				}{
					ReferenceID: orderNum,
					Amount: struct {
						CurrencyCode string `json:"currency_code"`
						Value        string `json:"value"`
					}{
						CurrencyCode: curr,
						Value:        fmt.Sprintf("%.2f", float64(totalCents)/100.0),
					},
					Shipping: struct {
						Name struct {
							FullName string `json:"full_name,omitempty"`
						} `json:"name,omitempty"`
						Address PayPalAddress `json:"address,omitempty"`
					}{
						Name: struct {
							FullName string `json:"full_name,omitempty"`
						}{FullName: buyerName},
						Address: parsedAddr,
					},
				})
				return order, nil
			}
		}
		// Fallback for demo orders not found
		return &PayPalOrder{
			ID:     orderID,
			Status: "COMPLETED",
			Intent: "CAPTURE",
		}, nil
	}

	token, err := c.GetAccessToken(ctx)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v2/checkout/orders/"+url.PathEscape(orderID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := doJSON(req, 15000)
	if err != nil {
		return nil, err
	}
	if res.status < 200 || res.status >= 300 {
		return nil, httpx.Errorf(http.StatusBadGateway, "PayPal order lookup returned status %d", res.status)
	}
	var order PayPalOrder
	if err := json.Unmarshal(res.body, &order); err != nil {
		return nil, err
	}
	return &order, nil
}

// TestConnection performs a live OAuth2 handshake with PayPal to verify credentials and returns connectivity telemetry.
func (c *Client) TestConnection(ctx context.Context) (map[string]any, error) {
	if !c.IsConfigured() {
		return map[string]any{
			"configured": false,
			"connected":  false,
			"error":      "PayPal credentials (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET) not configured.",
		}, nil
	}

	start := time.Now()
	basic := base64.StdEncoding.EncodeToString([]byte(c.clientID + ":" + c.clientSecret))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/oauth2/token",
		strings.NewReader("grant_type=client_credentials"))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Basic "+basic)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := doJSON(req, 15000)
	if err != nil {
		return map[string]any{
			"configured": true,
			"connected":  false,
			"error":      err.Error(),
		}, nil
	}
	if res.status != http.StatusOK {
		return map[string]any{
			"configured":  true,
			"connected":   false,
			"status_code": res.status,
			"error":       fmt.Sprintf("PayPal OAuth rejected (%d): %s", res.status, res.text),
		}, nil
	}

	var data struct {
		Scope     string `json:"scope"`
		AppID     string `json:"app_id"`
		ExpiresIn int64  `json:"expires_in"`
	}
	_ = json.Unmarshal(res.body, &data)

	clientIDMasked := ""
	if len(c.clientID) > 12 {
		clientIDMasked = c.clientID[:8] + "..." + c.clientID[len(c.clientID)-4:]
	} else {
		clientIDMasked = c.clientID
	}

	var rawScopes []string
	if data.Scope != "" {
		rawScopes = strings.Split(data.Scope, " ")
	}

	return map[string]any{
		"configured":       true,
		"connected":        true,
		"environment":      c.environment,
		"base_url":         c.baseURL,
		"client_id_masked": clientIDMasked,
		"app_id":           data.AppID,
		"scopes":           rawScopes,
		"scope_count":      len(rawScopes),
		"latency_ms":       time.Since(start).Milliseconds(),
		"verified_at":      time.Now().UTC().Format(time.RFC3339),
	}, nil
}
