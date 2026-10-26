package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// SessionCookie is the browser cookie name (unchanged across the migration).
const SessionCookie = "dispute_session"

// SessionDurationMillis is the session lifetime (7 days).
const SessionDurationMillis int64 = 7 * 24 * 60 * 60 * 1000

const publicAccountFields = "a.id, a.email, a.name, a.store_name, a.role, a.avatar_url, a.created_at"

var tokenPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// TokenHash returns the stored hash of a session token.
func TokenHash(token string) string { return store.SHA256Hex([]byte(token)) }

// SessionUser resolves the authenticated merchant from the request cookie.
func SessionUser(r *http.Request) (*types.UserAccount, error) {
	cookie, err := r.Cookie(SessionCookie)
	if err != nil || cookie == nil {
		return nil, nil
	}
	token := cookie.Value
	if !tokenPattern.MatchString(token) {
		return nil, nil
	}
	db, err := store.Auth()
	if err != nil {
		return nil, err
	}
	row := db.QueryRow(context.Background(), `SELECT `+publicAccountFields+`
		FROM accounts a JOIN sessions s ON s.user_id = a.id
		WHERE s.token_hash = ? AND s.expires_at > ?`, TokenHash(token), time.Now().UnixMilli())
	var (
		u      types.UserAccount
		avatar sql.NullString
	)
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.StoreName, &u.Role, &avatar, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if avatar.Valid {
		s := avatar.String
		u.AvatarURL = &s
	}
	return &u, nil
}

// AccountByID loads a merchant account's public profile. It returns (nil, nil)
// when the account does not exist, so callers can distinguish absence from error.
func AccountByID(ctx context.Context, id string) (*types.UserAccount, error) {
	db, err := store.Auth()
	if err != nil {
		return nil, err
	}
	row := db.QueryRow(ctx, `SELECT `+publicAccountFields+` FROM accounts a WHERE a.id = ?`, id)
	var (
		u      types.UserAccount
		avatar sql.NullString
	)
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.StoreName, &u.Role, &avatar, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if avatar.Valid {
		s := avatar.String
		u.AvatarURL = &s
	}
	return &u, nil
}

// RequireUser fails closed when no valid session is present.
func RequireUser(r *http.Request) (*types.UserAccount, error) {
	user, err := SessionUser(r)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, httpx.Errorf(http.StatusUnauthorized, "Sign in to continue.")
	}
	return user, nil
}

// AssertSameOrigin rejects cross-site state-changing requests.
func AssertSameOrigin(r *http.Request) error {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return nil
	}
	expected := config.Origin()
	if expected == "" {
		if config.Production() {
			return httpx.Errorf(http.StatusServiceUnavailable, "APP_ORIGIN must be configured.")
		}
		expected = requestOrigin(r)
	}
	parsed, err := url.Parse(expected)
	if err != nil || parsed.Host == "" {
		return httpx.Errorf(http.StatusServiceUnavailable, "APP_ORIGIN must be configured.")
	}
	expectedOrigin := parsed.Scheme + "://" + parsed.Host
	origin := r.Header.Get("Origin")
	if origin != expectedOrigin {
		if !config.Production() && isLoopbackEquivalent(origin, expectedOrigin) {
			return nil
		}
		return httpx.Errorf(http.StatusForbidden, "Request origin is not allowed.")
	}
	return nil
}

func isLoopbackEquivalent(a, b string) bool {
	uA, errA := url.Parse(a)
	uB, errB := url.Parse(b)
	if errA != nil || errB != nil {
		return false
	}
	if uA.Scheme != uB.Scheme || uA.Port() != uB.Port() {
		return false
	}
	isLoopback := func(h string) bool {
		return h == "localhost" || h == "127.0.0.1" || h == "::1"
	}
	return isLoopback(uA.Hostname()) && isLoopback(uB.Hostname())
}

func requestOrigin(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	}
	host := r.Host
	if fwd := r.Header.Get("X-Forwarded-Host"); fwd != "" {
		host = fwd
	}
	return scheme + "://" + host
}

// RevokeSession deletes the current request's session row.
func RevokeSession(r *http.Request) error {
	cookie, err := r.Cookie(SessionCookie)
	if err != nil || cookie == nil || cookie.Value == "" {
		return nil
	}
	db, err := store.Auth()
	if err != nil {
		return err
	}
	_, err = db.Exec(context.Background(), "DELETE FROM sessions WHERE token_hash = ?", TokenHash(cookie.Value))
	return err
}

// SetSession rotates the session and sets the browser cookie.
func SetSession(w http.ResponseWriter, r *http.Request, userID string) error {
	token := store.RandomHex(32)
	now := time.Now().UnixMilli()
	db, err := store.Auth()
	if err != nil {
		return err
	}
	err = db.WithTx(r.Context(), func(ctx context.Context) error {
		if cookie, cerr := r.Cookie(SessionCookie); cerr == nil && cookie != nil && cookie.Value != "" {
			if _, err := db.Exec(ctx, "DELETE FROM sessions WHERE token_hash = ?", TokenHash(cookie.Value)); err != nil {
				return err
			}
		}
		if _, err := db.Exec(ctx, "DELETE FROM sessions WHERE expires_at <= ?", now); err != nil {
			return err
		}
		_, err := db.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
			TokenHash(token), userID, now+SessionDurationMillis, now)
		return err
	})
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(SessionDurationMillis / 1000),
		HttpOnly: true,
		Secure:   config.Production(),
		SameSite: http.SameSiteLaxMode,
	})
	return nil
}

// ClearSession expires the browser cookie.
func ClearSession(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   config.Production(),
		SameSite: http.SameSiteLaxMode,
	})
}

// NormalizeEmail lowercases and trims an address.
func NormalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }
