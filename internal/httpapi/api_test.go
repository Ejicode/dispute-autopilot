package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/demo"
	"github.com/Ejicode/dispute-autopilot/internal/paypal"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

type apiResponse struct {
	status int
	header http.Header
	body   []byte
}

func (r apiResponse) json(t *testing.T) map[string]any {
	t.Helper()
	var out map[string]any
	if len(r.body) == 0 {
		return out
	}
	if err := json.Unmarshal(r.body, &out); err != nil {
		t.Fatalf("decode response: %v (%s)", err, r.body)
	}
	return out
}

func (r apiResponse) cookie(t *testing.T, name string) *http.Cookie {
	t.Helper()
	res := &http.Response{Header: r.header}
	for _, c := range res.Cookies() {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("response missing cookie %q (headers: %v)", name, r.header)
	return nil
}

func obj(t *testing.T, v any) map[string]any {
	t.Helper()
	out, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("expected object, got %T", v)
	}
	return out
}

func list(t *testing.T, v any) []any {
	t.Helper()
	out, ok := v.([]any)
	if !ok {
		t.Fatalf("expected array, got %T", v)
	}
	return out
}

func str(t *testing.T, v any) string {
	t.Helper()
	out, ok := v.(string)
	if !ok {
		t.Fatalf("expected string, got %T", v)
	}
	return out
}

// TestHTTPApiEndToEnd is the ported scripts/test-auth.ts suite: it drives the
// real router over HTTP and asserts authentication, merchant isolation, the
// approval gate, webhook ownership and SSE separation.
func TestHTTPApiEndToEnd(t *testing.T) {
	const origin = "http://localhost:3000"
	t.Setenv("APP_MODE", "demo")
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	t.Setenv("APP_ORIGIN", origin)
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("PAYPAL_CLIENT_ID", "")
	t.Setenv("PAYPAL_CLIENT_SECRET", "")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", "")
	t.Setenv("PAYPAL_WEBHOOK_ID", "")
	t.Setenv("GEMINI_API_KEY", "")
	paypal.Default = paypal.NewClient()
	store.Close()
	t.Cleanup(store.Close)
	t.Cleanup(func() { paypal.Default = paypal.NewClient() })

	server := httptest.NewServer(New(""))
	t.Cleanup(server.Close)

	check := func(condition bool, label string) {
		t.Helper()
		if !condition {
			t.Errorf("FAIL %s", label)
		}
	}

	fetch := func(method, path, token, reqOrigin string, body any) (*apiResponse, error) {
		var reader io.Reader
		if body != nil {
			switch v := body.(type) {
			case string:
				reader = strings.NewReader(v)
			default:
				data, err := json.Marshal(v)
				if err != nil {
					return nil, err
				}
				reader = bytes.NewReader(data)
			}
		}
		req, err := http.NewRequest(method, server.URL+path, reader)
		if err != nil {
			return nil, err
		}
		if reqOrigin != "" {
			req.Header.Set("Origin", reqOrigin)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, err
		}
		return &apiResponse{status: resp.StatusCode, header: resp.Header, body: data}, nil
	}
	do := func(method, path, token, reqOrigin string, body any) apiResponse {
		t.Helper()
		resp, err := fetch(method, path, token, reqOrigin, body)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		return *resp
	}

	// --- Fail-closed foundations ---
	if _, err := store.Merchant(context.Background()); err == nil {
		t.Error("FAIL unscoped business database access fails closed")
	}

	anonymous := []struct{ method, path string }{
		{"GET", "/api/runtime"},
		{"GET", "/api/events/stream"},
		{"GET", "/api/disputes"}, {"POST", "/api/disputes"},
		{"GET", "/api/disputes/unknown"}, {"GET", "/api/disputes/unknown/approve"},
		{"POST", "/api/disputes/unknown/approve"}, {"POST", "/api/disputes/unknown/verify-draft"},
		{"POST", "/api/disputes/unknown/regenerate-draft"}, {"GET", "/api/disputes/unknown/packet"},
		{"GET", "/api/disputes/unknown/reconcile"}, {"POST", "/api/disputes/unknown/reconcile"},
		{"GET", "/api/storefront/checkout"}, {"POST", "/api/storefront/checkout"},
		{"POST", "/api/carrier/update"},
		{"GET", "/api/search"}, {"GET", "/api/analytics"},
		{"GET", "/api/trust-lab/run"}, {"POST", "/api/trust-lab/run"},
		{"GET", "/api/bench/run"}, {"POST", "/api/bench/run"},
		{"GET", "/api/ai-assistant"}, {"POST", "/api/ai-assistant"},
	}
	for _, route := range anonymous {
		var body any
		if route.method == "POST" {
			body = map[string]any{}
		}
		resp := do(route.method, route.path, "", origin, body)
		check(resp.status == 401, route.method+" "+route.path+" rejects anonymous callers")
	}

	check(do("GET", "/api/auth", "", "", nil).status == 401, "account enumeration requires a session")
	check(do("GET", "/api/auth", "forged", "", nil).status == 401, "forged session rejected")

	// --- Registration validation ---
	password := "a sufficiently long test passphrase"
	registration := map[string]any{
		"name": "Merchant A", "email": "a@example.test", "store_name": "Store A", "password": password,
	}
	check(do("POST", "/api/auth", "", origin, map[string]any{
		"name": "Merchant A", "email": "a@example.test", "store_name": "Store A", "password": "short",
	}).status == 400, "short password rejected")
	check(do("POST", "/api/auth", "", "https://attacker.example", registration).status == 403, "cross-origin registration rejected")
	check(do("POST", "/api/auth", "", "", registration).status == 403, "missing origin rejected")
	check(do("POST", "/api/auth", "", origin, "{").status == 400, "invalid JSON rejected")
	oversized := map[string]any{"name": strings.Repeat("x", 9000), "email": "a@example.test", "store_name": "Store A", "password": password}
	check(do("POST", "/api/auth", "", origin, oversized).status == 413, "oversized auth request rejected")

	registeredA := do("POST", "/api/auth", "", origin, registration)
	check(registeredA.status == 201, "merchant A registered")
	cookieA := registeredA.cookie(t, auth.SessionCookie)
	userA := obj(t, registeredA.json(t)["user"])
	userAID := str(t, userA["id"])
	check(registeredA.header.Get("Set-Cookie") != "" && strings.Contains(registeredA.header.Get("Set-Cookie"), "HttpOnly") &&
		strings.Contains(registeredA.header.Get("Set-Cookie"), "SameSite=Lax"), "session cookie has HttpOnly and SameSite")
	_, hasHash := userA["password_hash"]
	check(!hasHash, "registration does not disclose password hash")

	authDB, err := store.Auth()
	if err != nil {
		t.Fatalf("store.Auth: %v", err)
	}
	var storedHash string
	if err := authDB.QueryRow(context.Background(), "SELECT password_hash FROM accounts WHERE id=?", userAID).Scan(&storedHash); err != nil {
		t.Fatalf("query password hash: %v", err)
	}
	check(strings.HasPrefix(storedHash, "scrypt-v1:") && !strings.Contains(storedHash, password), "password stored as salted scrypt hash")

	tokenA := cookieA.Value
	var sessionRows int
	if err := authDB.QueryRow(context.Background(), "SELECT COUNT(*) FROM sessions WHERE token_hash=?", auth.TokenHash(tokenA)).Scan(&sessionRows); err != nil {
		t.Fatalf("query session: %v", err)
	}
	check(sessionRows == 1, "session token stored only as a digest")

	duplicate := map[string]any{"name": "Merchant A", "email": "A@EXAMPLE.TEST", "store_name": "Store A", "password": password}
	check(do("POST", "/api/auth", "", origin, duplicate).status == 409, "duplicate normalized email rejected")

	registrationB := map[string]any{"name": "Merchant B", "email": "b@example.test", "store_name": "Store B", "password": password}
	registeredB := do("POST", "/api/auth", "", origin, registrationB)
	check(registeredB.status == 201, "merchant B registered")
	tokenB := registeredB.cookie(t, auth.SessionCookie).Value
	userB := obj(t, registeredB.json(t)["user"])
	userBID := str(t, userB["id"])

	// --- Session identity is taken from the cookie, never the query ---
	current := do("GET", "/api/auth?user_id="+userBID, tokenA, "", nil).json(t)
	_, hasUsers := current["users"]
	check(obj(t, current["user"])["id"] == userAID && !hasUsers, "session endpoint returns only authenticated identity")

	wrong := do("POST", "/api/auth/login", "", origin, map[string]any{"email": "a@example.test", "password": "incorrect password"})
	unknown := do("POST", "/api/auth/login", "", origin, map[string]any{"email": "unknown@example.test", "password": "incorrect password"})
	check(wrong.status == 401 && unknown.status == 401 &&
		str(t, wrong.json(t)["error"]) == str(t, unknown.json(t)["error"]),
		"invalid and unknown credentials have the same response")

	oldToken := tokenA
	signedIn := do("POST", "/api/auth/login", oldToken, origin, map[string]any{"email": "A@EXAMPLE.TEST", "password": password})
	check(signedIn.status == 200, "correct credentials sign in with normalized email")
	check(do("GET", "/api/auth", oldToken, "", nil).status == 401, "sign-in rotates and revokes previous session")
	tokenA = signedIn.cookie(t, auth.SessionCookie).Value

	t.Setenv("NODE_ENV", "production")
	secureLogin := do("POST", "/api/auth/login", "", origin, map[string]any{"email": "a@example.test", "password": password})
	t.Setenv("NODE_ENV", "test")
	expiringToken := secureLogin.cookie(t, auth.SessionCookie).Value
	check(strings.Contains(secureLogin.header.Get("Set-Cookie"), "Secure"), "production session cookie is Secure")
	if _, err := authDB.Exec(context.Background(), "UPDATE sessions SET expires_at=0 WHERE token_hash=?", auth.TokenHash(expiringToken)); err != nil {
		t.Fatalf("expire session: %v", err)
	}
	check(do("GET", "/api/auth", expiringToken, "", nil).status == 401, "expired session rejected")

	// --- Storefront + merchant isolation ---
	orderInput := map[string]any{
		"buyer_name": "Private A Buyer", "buyer_email": "buyer-a@example.test", "shipping_address": "1 Test Street",
		"items": []any{map[string]any{"name": "Test", "sku": "DJI-M3P-CINE", "quantity": 1, "unit_price_cents": 10000}},
	}
	check(do("POST", "/api/storefront/checkout", tokenA, "https://attacker.example", orderInput).status == 403,
		"cross-origin business mutation rejected")
	orderA := obj(t, do("POST", "/api/storefront/checkout", tokenA, origin, orderInput).json(t)["order"])
	orderAID := str(t, orderA["id"])
	orderBInput := map[string]any{
		"buyer_name": "Private B Buyer", "buyer_email": "buyer-b@example.test", "shipping_address": "2 Other Street",
		"items": []any{map[string]any{"name": "Test", "sku": "DJI-M3P-CINE", "quantity": 1, "unit_price_cents": 10000}},
	}
	orderB := obj(t, do("POST", "/api/storefront/checkout", tokenB, origin, orderBInput).json(t)["order"])
	orderBID := str(t, orderB["id"])
	ordersB := list(t, do("GET", "/api/storefront/checkout", tokenB, "", nil).json(t)["orders"])
	check(len(ordersB) == 1 && obj(t, ordersB[0])["id"] == orderBID, "merchant B cannot list A orders")

	disputeA := obj(t, do("POST", "/api/disputes", tokenA, origin, map[string]any{"order_id": orderAID, "amount_cents": 10000}).json(t)["dispute"])
	disputeAID := str(t, disputeA["id"])
	check(disputeAID != "", "merchant A creates its own dispute")
	check(do("POST", "/api/disputes", tokenB, origin, map[string]any{"order_id": orderAID}).status == 404,
		"foreign order cannot be attached to a dispute")
	check(do("POST", "/api/carrier/update", tokenB, origin, map[string]any{"order_id": orderAID, "target_status": "DELIVERED"}).status == 404,
		"foreign order cannot be mutated")

	foreignRoutes := []struct {
		method, path string
		body         any
	}{
		{"GET", "/api/disputes/" + disputeAID, nil},
		{"GET", "/api/disputes/" + disputeAID + "/packet", nil},
		{"POST", "/api/disputes/" + disputeAID + "/verify-draft", map[string]any{}},
		{"POST", "/api/disputes/" + disputeAID + "/approve", map[string]any{}},
	}
	for _, route := range foreignRoutes {
		check(do(route.method, route.path, tokenB, origin, route.body).status == 404,
			route.method+" "+route.path+" conceals a foreign dispute")
	}

	listB := list(t, do("GET", "/api/disputes", tokenB, "", nil).json(t)["disputes"])
	check(len(listB) == 0, "merchant B cannot list A disputes")
	analyticsB := do("GET", "/api/analytics", tokenB, "", nil).json(t)
	kpisB := obj(t, analyticsB["kpis"])
	check(kpisB["totalDisputes"] == float64(0) && kpisB["orderCount"] == float64(1), "analytics contains only current merchant data")
	searchB := list(t, do("GET", "/api/search?q="+str(t, disputeA["paypal_dispute_id"]), tokenB, "", nil).json(t)["results"])
	check(len(searchB) == 0, "search cannot reveal another merchant dispute")

	// --- Approval gate binds the actor to the session ---
	review := do("GET", "/api/disputes/"+disputeAID+"/approve?action_type=ACCEPT_CLAIM", tokenA, "", nil).json(t)
	digest := str(t, review["snapshot_digest"])
	override := do("POST", "/api/disputes/"+disputeAID+"/approve", tokenA, origin,
		map[string]any{"action_type": "ACCEPT_CLAIM", "snapshot_digest": digest, "approver": userBID})
	check(override.status == 400, "client cannot override approval actor")
	approval := do("POST", "/api/disputes/"+disputeAID+"/approve", tokenA, origin,
		map[string]any{"action_type": "ACCEPT_CLAIM", "snapshot_digest": digest})
	check(approval.status == 200, "authenticated owner can execute a mocked action")

	scopeA, err := scope.With(context.Background(), userAID, config.ModeDemo, nil)
	if err != nil {
		t.Fatalf("scope A: %v", err)
	}
	dbA, err := store.Merchant(scopeA)
	if err != nil {
		t.Fatalf("merchant A db: %v", err)
	}
	var approver string
	if err := dbA.QueryRow(scopeA, "SELECT approver FROM approval_operations WHERE dispute_id=?", disputeAID).Scan(&approver); err != nil {
		t.Fatalf("query approver: %v", err)
	}
	check(approver == userAID, "audit approver comes from session, not request body")

	// --- Assistant history/writes are scoped to the session identity ---
	scopeB, err := scope.With(context.Background(), userBID, config.ModeDemo, nil)
	if err != nil {
		t.Fatalf("scope B: %v", err)
	}
	dbB, err := store.Merchant(scopeB)
	if err != nil {
		t.Fatalf("merchant B db: %v", err)
	}
	if _, err := dbB.Exec(scopeB, "INSERT INTO ai_chat_messages VALUES('private-b',?,'user','Private B conversation',?)",
		userBID, config.NowISO()); err != nil {
		t.Fatalf("insert private chat: %v", err)
	}
	chatA := list(t, do("GET", "/api/ai-assistant?user_id="+userBID, tokenA, "", nil).json(t)["messages"])
	check(len(chatA) == 0, "chat history cannot select another user")
	check(do("POST", "/api/ai-assistant", tokenA, origin, map[string]any{"user_id": userBID, "message": "hello"}).status == 200,
		"assistant accepts a message")
	chatOwners := []string{}
	rows, err := dbA.Query(scopeA, "SELECT DISTINCT user_id FROM ai_chat_messages")
	if err != nil {
		t.Fatalf("query chat owners: %v", err)
	}
	for rows.Next() {
		var owner string
		if err := rows.Scan(&owner); err != nil {
			t.Fatalf("scan chat owner: %v", err)
		}
		chatOwners = append(chatOwners, owner)
	}
	rows.Close()
	check(len(chatOwners) == 1 && chatOwners[0] == userAID, "chat writes use session identity")

	// --- Interleaved requests keep distinct workspaces ---
	var wg sync.WaitGroup
	problems := make(chan string, 64)
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			resp, err := fetch("GET", "/api/storefront/checkout", tokenA, "", nil)
			if err != nil {
				problems <- err.Error()
				return
			}
			var parsed map[string]any
			if err := json.Unmarshal(resp.body, &parsed); err != nil {
				problems <- err.Error()
				return
			}
			orders, _ := parsed["orders"].([]any)
			if len(orders) != 1 {
				problems <- fmt.Sprintf("A saw %d orders", len(orders))
				return
			}
			if first, _ := orders[0].(map[string]any); first["id"] != orderAID {
				problems <- fmt.Sprintf("A saw order %v", first["id"])
			}
		}()
		go func() {
			defer wg.Done()
			resp, err := fetch("GET", "/api/storefront/checkout", tokenB, "", nil)
			if err != nil {
				problems <- err.Error()
				return
			}
			var parsed map[string]any
			if err := json.Unmarshal(resp.body, &parsed); err != nil {
				problems <- err.Error()
				return
			}
			orders, _ := parsed["orders"].([]any)
			if len(orders) != 1 {
				problems <- fmt.Sprintf("B saw %d orders", len(orders))
				return
			}
			if first, _ := orders[0].(map[string]any); first["id"] != orderBID {
				problems <- fmt.Sprintf("B saw order %v", first["id"])
			}
		}()
	}
	wg.Wait()
	close(problems)
	for problem := range problems {
		t.Errorf("FAIL interleaved async requests keep distinct workspaces: %s", problem)
	}

	// --- Public webhook fails closed in demo, then binds to server config ---
	webhookPost := func(path, token string, event map[string]any) apiResponse {
		t.Helper()
		data, err := json.Marshal(event)
		if err != nil {
			t.Fatalf("marshal webhook: %v", err)
		}
		req, err := http.NewRequest("POST", server.URL+path, bytes.NewReader(data))
		if err != nil {
			t.Fatalf("webhook request: %v", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		req.Header.Set("paypal-auth-algo", "SHA256withRSA")
		req.Header.Set("paypal-cert-url", "https://api.sandbox.paypal.com/cert")
		req.Header.Set("paypal-transmission-id", "transmission-1")
		req.Header.Set("paypal-transmission-sig", "signature")
		req.Header.Set("paypal-transmission-time", config.NowISO())
		if token != "" {
			req.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatalf("webhook do: %v", err)
		}
		defer resp.Body.Close()
		b, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("webhook body: %v", err)
		}
		return apiResponse{status: resp.StatusCode, header: resp.Header, body: b}
	}
	check(webhookPost("/api/webhooks/paypal", "", map[string]any{"id": "fake", "event_type": "PAYMENT.CAPTURE.COMPLETED"}).status == 503,
		"unconfigured public webhook fails closed")

	t.Setenv("APP_MODE", "sandbox")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", userAID)
	t.Setenv("PAYPAL_WEBHOOK_ID", "test-webhook")
	t.Setenv("PAYPAL_CLIENT_ID", "test-client")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_ENVIRONMENT", "sandbox")
	paypal.Default = paypal.NewClient()
	savedVerifier := paypal.DefaultVerifier
	t.Cleanup(func() { paypal.DefaultVerifier = savedVerifier })

	providerEvent := map[string]any{
		"id": "owned-event", "create_time": config.NowISO(), "event_type": "PAYMENT.CAPTURE.COMPLETED",
		"resource_type": "capture",
		"resource":      map[string]any{"id": "private-capture", "amount": map[string]any{"value": "12.00", "currency_code": "USD"}},
	}
	paypal.DefaultVerifier = func(context.Context, paypal.WebhookHeaders, types.PayPalWebhookEvent) (bool, error) {
		return false, nil
	}
	check(webhookPost("/api/webhooks/paypal", "", providerEvent).status == 401,
		"configured webhook rejects failed signature verification")
	paypal.DefaultVerifier = func(context.Context, paypal.WebhookHeaders, types.PayPalWebhookEvent) (bool, error) { return true, nil }
	accepted := webhookPost("/api/webhooks/paypal?user_id="+userBID, tokenB, providerEvent)
	check(accepted.status == 200, "verified webhook accepts configured owner despite foreign browser identity")

	countEvents := func(merchantID string) int {
		ctx, err := scope.With(context.Background(), merchantID, config.ModeSandbox, nil)
		if err != nil {
			t.Fatalf("sandbox scope: %v", err)
		}
		db, err := store.Merchant(ctx)
		if err != nil {
			t.Fatalf("sandbox merchant: %v", err)
		}
		var n int
		if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM paypal_events WHERE event_id='owned-event'").Scan(&n); err != nil {
			t.Fatalf("count provider events: %v", err)
		}
		return n
	}
	check(countEvents(userAID) == 1 && countEvents(userBID) == 0, "webhook persists only in server-configured merchant workspace")

	t.Setenv("APP_MODE", "demo")
	t.Setenv("PAYPAL_MERCHANT_USER_ID", "")
	t.Setenv("PAYPAL_CLIENT_ID", "")
	t.Setenv("PAYPAL_CLIENT_SECRET", "")
	paypal.DefaultVerifier = savedVerifier
	paypal.Default = paypal.NewClient()

	// --- SSE delivery is isolated per merchant and dies with the session ---
	openStream := func(token string) (*http.Response, *bufio.Reader) {
		req, err := http.NewRequest("GET", server.URL+"/api/events/stream", nil)
		if err != nil {
			t.Fatalf("stream request: %v", err)
		}
		req.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: token})
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatalf("open stream: %v", err)
		}
		return resp, bufio.NewReader(resp.Body)
	}
	readFrame := func(reader *bufio.Reader) (string, error) {
		var sb strings.Builder
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return sb.String(), err
			}
			if line == "\n" {
				return sb.String(), nil
			}
			sb.WriteString(line)
		}
	}

	respA, readerA := openStream(tokenA)
	defer respA.Body.Close()
	respB, readerB := openStream(tokenB)
	defer respB.Body.Close()
	frameA, errA := readFrame(readerA)
	frameB, errB := readFrame(readerB)
	check(errA == nil && strings.Contains(frameA, "CONNECTED") && errB == nil && strings.Contains(frameB, "CONNECTED"),
		"SSE streams connect")

	realtime.Default().Publish(scopeA, "ORDER_CAPTURED", map[string]any{"secret": "A-only"})
	realtime.Default().Publish(scopeB, "ORDER_CAPTURED", map[string]any{"secret": "B-only"})
	frameA, _ = readFrame(readerA)
	frameB, _ = readFrame(readerB)
	check(strings.Contains(frameA, "A-only") && !strings.Contains(frameA, "B-only") &&
		strings.Contains(frameB, "B-only") && !strings.Contains(frameB, "A-only"), "SSE events are isolated by merchant")

	check(do("DELETE", "/api/auth", tokenA, "https://attacker.example", nil).status == 403, "cross-origin logout rejected")
	logout := do("DELETE", "/api/auth", tokenA, origin, nil)
	check(logout.status == 200 && strings.Contains(logout.header.Get("Set-Cookie"), "Max-Age=0"), "logout clears cookie")
	check(do("GET", "/api/auth", tokenA, "", nil).status == 401, "logout revokes server-side session")
	realtime.Default().Publish(scopeA, "ORDER_CAPTURED", map[string]any{"secret": "after logout"})
	if _, err := readFrame(readerA); err == nil {
		t.Error("FAIL revoked session stops existing SSE stream before further delivery")
	}
	respB.Body.Close()

	// --- Rate limiting ---
	if _, err := authDB.Exec(context.Background(),
		"INSERT OR REPLACE INTO auth_attempts(key,count,resets_at) VALUES(?,8,?)",
		auth.TokenHash("rate@example.test"), config.NowMillis()+900000); err != nil {
		t.Fatalf("seed rate limit: %v", err)
	}
	check(do("POST", "/api/auth/login", "", origin, map[string]any{"email": "rate@example.test", "password": password}).status == 429,
		"repeated sign-in attempts are rate limited")

	successes := 0
	for i := 0; i < 10; i++ {
		if do("POST", "/api/auth/login", "", origin, map[string]any{"email": "b@example.test", "password": password}).status == 200 {
			successes++
		}
	}
	check(successes == 10, "successful sign-ins never lock an account out")

	if err := demo.EnsureDemoAccounts(context.Background()); err != nil {
		t.Fatalf("seed demo accounts: %v", err)
	}
	for i := 0; i < 10; i++ {
		do("POST", "/api/auth/login", "", origin, map[string]any{"email": "admin@disputeautopilot.com", "password": "wrong password"})
	}
	check(do("POST", "/api/auth/login", "", origin, map[string]any{"email": "admin@disputeautopilot.com", "password": "Password12345678!"}).status == 200,
		"failed attempts cannot lock out a public demo account")

	// --- Demo buyer persona ---
	buyerLogin := do("POST", "/api/auth/login", "", origin, map[string]any{"email": "buyer@disputeautopilot.com", "password": "Password12345678!"})
	check(buyerLogin.status == 200, "demo buyer signs in")
	buyerToken := buyerLogin.cookie(t, auth.SessionCookie).Value
	check(do("POST", "/api/storefront/checkout", buyerToken, origin, orderInput).status == 200, "demo buyer can shop")
	for _, path := range []string{"/api/demo/seed", "/api/trust-lab/run", "/api/bench/run", "/api/disputes/any/approve",
		"/api/disputes/any/reconcile", "/api/disputes/any/verify-draft", "/api/disputes/any/regenerate-draft"} {
		check(do("POST", path, buyerToken, origin, map[string]any{}).status == 403, "demo buyer cannot POST "+path)
	}
}
