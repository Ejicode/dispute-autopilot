package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

const testPassword = "a sufficiently long test passphrase"

func newAuthStore(t *testing.T) {
	t.Helper()
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("APP_MODE", "demo")
	t.Setenv("APP_ORIGIN", "http://localhost:3000")
	t.Setenv("NODE_ENV", "test")
	store.Close()
	t.Cleanup(store.Close)
}

func insertAccount(t *testing.T, id, email string) {
	t.Helper()
	db, err := store.Auth()
	if err != nil {
		t.Fatalf("store.Auth: %v", err)
	}
	hash, err := HashPassword(testPassword)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if _, err := db.Exec(context.Background(),
		`INSERT INTO accounts(id,email,name,store_name,role,avatar_url,password_hash,created_at)
		 VALUES(?,?,?,?, 'MERCHANT_ADMIN', NULL, ?, ?)`,
		id, email, "Test Merchant", "Test Store", hash, config.NowISO()); err != nil {
		t.Fatalf("insert account: %v", err)
	}
}

func TestPasswordHashFormatAndVerification(t *testing.T) {
	hash, err := HashPassword(testPassword)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if !regexp.MustCompile(`^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{128}$`).MatchString(hash) {
		t.Fatalf("unexpected hash format %q", hash)
	}
	if strings.Contains(hash, testPassword) {
		t.Fatal("hash leaks the plaintext password")
	}

	ok, err := VerifyPassword(testPassword, hash)
	if err != nil || !ok {
		t.Fatalf("correct password rejected: ok=%v err=%v", ok, err)
	}
	ok, err = VerifyPassword("the wrong passphrase entirely", hash)
	if err != nil || ok {
		t.Fatalf("wrong password accepted: ok=%v err=%v", ok, err)
	}

	// Two hashes of the same password differ (per-hash random salt).
	other, err := HashPassword(testPassword)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if other == hash {
		t.Fatal("expected salted hashes to differ")
	}
}

func TestVerifyPasswordFailsClosed(t *testing.T) {
	cases := map[string]string{
		"empty":       "",
		"garbage":     "not-a-hash",
		"bad-version": "scrypt-v2:00000000000000000000000000000000:00",
		"short-salt":  "scrypt-v1:abcd:00",
		"short-hash":  "scrypt-v1:00000000000000000000000000000000:abcd",
	}
	for name, stored := range cases {
		ok, err := VerifyPassword(testPassword, stored)
		if err != nil {
			t.Fatalf("%s: unexpected error %v", name, err)
		}
		if ok {
			t.Fatalf("%s: invalid stored hash must not verify", name)
		}
	}
}

func TestCredentialsValidation(t *testing.T) {
	valid := map[string]any{"email": "  User@Example.TEST ", "password": testPassword}
	email, password, err := Credentials(valid, true)
	if err != nil {
		t.Fatalf("valid registration rejected: %v", err)
	}
	if email != "user@example.test" || password != testPassword {
		t.Fatalf("unexpected normalization: %q %q", email, password)
	}

	if _, _, err := Credentials(map[string]any{"email": "nope", "password": testPassword}, true); err == nil {
		t.Fatal("invalid email accepted")
	}
	if _, _, err := Credentials(map[string]any{"email": "a@b.co", "password": "short"}, true); err == nil {
		t.Fatal("short registration password accepted")
	}
	if _, _, err := Credentials(map[string]any{"email": "a@b.co", "password": strings.Repeat("x", 129)}, true); err == nil {
		t.Fatal("over-long password accepted")
	}
	// Sign-in only requires a non-empty password.
	if _, _, err := Credentials(map[string]any{"email": "a@b.co", "password": "x"}, false); err != nil {
		t.Fatalf("minimal login password rejected: %v", err)
	}
	if _, _, err := Credentials(map[string]any{"email": "a@b.co"}, false); err == nil {
		t.Fatal("missing login password accepted")
	}
}

func TestFieldValidation(t *testing.T) {
	body := map[string]any{"name": "  Store  ", "too_long": strings.Repeat("x", 11)}
	value, err := Field(body, "name", 100)
	if err != nil || value != "Store" {
		t.Fatalf("expected trimmed value, got %q err=%v", value, err)
	}
	if _, err := Field(body, "too_long", 10); err == nil {
		t.Fatal("over-length field accepted")
	}
	if _, err := Field(body, "missing", 10); err == nil {
		t.Fatal("missing field accepted")
	}
	if _, err := Field(map[string]any{"blank": "   "}, "blank", 10); err == nil {
		t.Fatal("blank field accepted")
	}
}

func TestTokenHashIsStableSHA256(t *testing.T) {
	token := strings.Repeat("ab", 32)
	hash := TokenHash(token)
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(hash) {
		t.Fatalf("unexpected token hash %q", hash)
	}
	if hash != TokenHash(token) {
		t.Fatal("token hash is not deterministic")
	}
	if hash != store.SHA256Hex([]byte(token)) {
		t.Fatal("token hash does not match SHA-256 hex of the token")
	}
}

func TestThrottlePerAccountLimit(t *testing.T) {
	newAuthStore(t)
	db, err := store.Auth()
	if err != nil {
		t.Fatalf("store.Auth: %v", err)
	}

	fresh := "fresh@example.test"
	if err := Throttle(fresh); err != nil {
		t.Fatalf("first attempt blocked: %v", err)
	}

	// Seed the per-account counter at the limit and confirm the next attempt fails.
	if _, err := db.Exec(context.Background(),
		"INSERT OR REPLACE INTO auth_attempts(key,count,resets_at) VALUES(?,8,?)",
		TokenHash("limited@example.test"), config.NowMillis()+900000); err != nil {
		t.Fatalf("seed attempts: %v", err)
	}
	err = Throttle("limited@example.test")
	httpErr, ok := err.(*httpx.HTTPError)
	if !ok || httpErr.Status != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %v", err)
	}
}

func TestResetThrottleClearsAccountCounter(t *testing.T) {
	newAuthStore(t)
	email := "reset@example.test"
	for i := 0; i < 7; i++ {
		if err := Throttle(email); err != nil {
			t.Fatalf("attempt %d blocked: %v", i+1, err)
		}
	}
	if err := ResetThrottle(context.Background(), email); err != nil {
		t.Fatalf("ResetThrottle: %v", err)
	}
	// Without the reset, the 9th attempt would be refused.
	for i := 0; i < 8; i++ {
		if err := Throttle(email); err != nil {
			t.Fatalf("attempt %d after reset blocked: %v", i+1, err)
		}
	}
}

func TestThrottleGlobalIgnoresAccountCounter(t *testing.T) {
	newAuthStore(t)
	db, err := store.Auth()
	if err != nil {
		t.Fatalf("store.Auth: %v", err)
	}
	if _, err := db.Exec(context.Background(),
		"INSERT OR REPLACE INTO auth_attempts(key,count,resets_at) VALUES(?,8,?)",
		TokenHash("public@example.test"), config.NowMillis()+900000); err != nil {
		t.Fatalf("seed attempts: %v", err)
	}
	if err := ThrottleGlobal(); err != nil {
		t.Fatalf("global-only throttle blocked by an account counter: %v", err)
	}
}

func TestSessionLifecycle(t *testing.T) {
	newAuthStore(t)
	insertAccount(t, "usr_00000000000000000000000000000001", "merchant@example.test")

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth", nil)
	if err := SetSession(recorder, req, "usr_00000000000000000000000000000001"); err != nil {
		t.Fatalf("SetSession: %v", err)
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("SetSession did not set a cookie")
	}
	cookie := cookies[0]
	if cookie.Name != SessionCookie || !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected session cookie: %+v", cookie)
	}
	if !tokenPattern.MatchString(cookie.Value) {
		t.Fatalf("session token is not 64 hex: %q", cookie.Value)
	}

	// The raw token is never stored: only its digest is persisted.
	var stored int
	if err := func() error {
		db, err := store.Auth()
		if err != nil {
			return err
		}
		return db.QueryRow(context.Background(), "SELECT COUNT(*) FROM sessions WHERE token_hash=?", TokenHash(cookie.Value)).Scan(&stored)
	}(); err != nil {
		t.Fatalf("query session: %v", err)
	}
	if stored != 1 {
		t.Fatal("session token digest not persisted")
	}

	authed := httptest.NewRequest(http.MethodGet, "/api/auth", nil)
	authed.AddCookie(cookie)
	user, err := SessionUser(authed)
	if err != nil || user == nil || user.ID != "usr_00000000000000000000000000000001" {
		t.Fatalf("SessionUser failed: user=%+v err=%v", user, err)
	}
	if _, err := RequireUser(authed); err != nil {
		t.Fatalf("RequireUser rejected a valid session: %v", err)
	}

	if err := RevokeSession(authed); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}
	if user, err := SessionUser(authed); err != nil || user != nil {
		t.Fatalf("revoked session still resolves: user=%+v err=%v", user, err)
	}
	if _, err := RequireUser(authed); err == nil {
		t.Fatal("RequireUser accepted a revoked session")
	}

	cleared := httptest.NewRecorder()
	ClearSession(cleared)
	if c := cleared.Result().Cookies(); len(c) == 0 || c[0].MaxAge >= 0 {
		t.Fatalf("ClearSession did not expire the cookie: %+v", c)
	}
}

func TestSessionRejectsForgedToken(t *testing.T) {
	newAuthStore(t)
	forged := httptest.NewRequest(http.MethodGet, "/api/auth", nil)
	forged.AddCookie(&http.Cookie{Name: SessionCookie, Value: "not-a-real-token"})
	if user, err := SessionUser(forged); err != nil || user != nil {
		t.Fatalf("forged token resolved: user=%+v err=%v", user, err)
	}
}

func TestAccountByID(t *testing.T) {
	newAuthStore(t)
	insertAccount(t, "usr_00000000000000000000000000000002", "lookup@example.test")
	user, err := AccountByID(context.Background(), "usr_00000000000000000000000000000002")
	if err != nil || user == nil || user.Email != "lookup@example.test" {
		t.Fatalf("AccountByID: user=%+v err=%v", user, err)
	}
	missing, err := AccountByID(context.Background(), "usr_00000000000000000000000000000009")
	if err != nil || missing != nil {
		t.Fatalf("unknown account should be (nil,nil): user=%+v err=%v", missing, err)
	}
}

func TestAssertSameOrigin(t *testing.T) {
	t.Setenv("APP_ORIGIN", "http://localhost:3000")
	t.Setenv("NODE_ENV", "test")

	get := httptest.NewRequest(http.MethodGet, "/api/disputes", nil)
	if err := AssertSameOrigin(get); err != nil {
		t.Fatalf("GET should not require an origin: %v", err)
	}

	same := httptest.NewRequest(http.MethodPost, "/api/disputes", nil)
	same.Header.Set("Origin", "http://localhost:3000")
	if err := AssertSameOrigin(same); err != nil {
		t.Fatalf("same-origin POST rejected: %v", err)
	}

	cross := httptest.NewRequest(http.MethodPost, "/api/disputes", nil)
	cross.Header.Set("Origin", "https://attacker.example")
	err := AssertSameOrigin(cross)
	if httpErr, ok := err.(*httpx.HTTPError); !ok || httpErr.Status != http.StatusForbidden {
		t.Fatalf("cross-origin POST should be 403, got %v", err)
	}

	missing := httptest.NewRequest(http.MethodPost, "/api/disputes", nil)
	err = AssertSameOrigin(missing)
	if httpErr, ok := err.(*httpx.HTTPError); !ok || httpErr.Status != http.StatusForbidden {
		t.Fatalf("missing origin should be 403, got %v", err)
	}
}

func TestNormalizeEmail(t *testing.T) {
	if got := NormalizeEmail("  Mixed@Case.COM "); got != "mixed@case.com" {
		t.Fatalf("unexpected normalization %q", got)
	}
}
