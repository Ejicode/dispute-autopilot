package auth

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// ReadAuthBody reads a bounded JSON object.
func ReadAuthBody(r *http.Request, maxBytes int) (map[string]any, error) {
	return httpx.ReadJSONBody(r, maxBytes)
}

// Field extracts a required, trimmed, bounded string.
func Field(body map[string]any, key string, max int) (string, error) {
	value, ok := body[key].(string)
	if !ok || strings.TrimSpace(value) == "" || len(value) > max {
		return "", httpx.Errorf(http.StatusBadRequest, "Invalid %s.", key)
	}
	return strings.TrimSpace(value), nil
}

// Credentials validates and normalizes email/password input.
func Credentials(body map[string]any, registration bool) (string, string, error) {
	email, err := Field(body, "email", 254)
	if err != nil {
		return "", "", err
	}
	email = strings.ToLower(email)
	if !emailPattern.MatchString(email) {
		return "", "", httpx.Errorf(http.StatusBadRequest, "Enter a valid email address.")
	}
	password, ok := body["password"].(string)
	minLen := 1
	if registration {
		minLen = 15
	}
	if !ok || len(password) > 128 || len(password) < minLen {
		if registration {
			return "", "", httpx.Errorf(http.StatusBadRequest, "Use a password between 15 and 128 characters.")
		}
		return "", "", httpx.Errorf(http.StatusBadRequest, "Invalid password.")
	}
	return email, password, nil
}

type rateLimit struct {
	key    string
	max    int64
	window int64
}

var globalLimit = rateLimit{"global", 120, 60000}

func accountLimit(email string) rateLimit { return rateLimit{TokenHash(email), 8, 900000} }

// Throttle enforces global and per-account authentication rate limits.
func Throttle(email string) error { return throttle(globalLimit, accountLimit(email)) }

// ThrottleGlobal enforces only the global limit, for accounts whose
// credentials are public (seeded demo accounts) where a per-account lockout
// protects nothing and lets anyone deny access to everyone else.
func ThrottleGlobal() error { return throttle(globalLimit) }

// ResetThrottle clears an account's counter after a successful sign-in, so
// only consecutive failures count toward its lockout.
func ResetThrottle(ctx context.Context, email string) error {
	db, err := store.Auth()
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, "DELETE FROM auth_attempts WHERE key = ?", accountLimit(email).key)
	return err
}

func throttle(limits ...rateLimit) error {
	db, err := store.Auth()
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	allowed := false
	err = db.WithTx(context.Background(), func(ctx context.Context) error {
		if _, err := db.Exec(ctx, "DELETE FROM auth_attempts WHERE resets_at <= ?", now); err != nil {
			return err
		}
		for _, limit := range limits {
			var count int64
			err := db.QueryRow(ctx, "SELECT count FROM auth_attempts WHERE key=?", limit.key).Scan(&count)
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			if count >= limit.max {
				return nil
			}
		}
		for _, limit := range limits {
			if _, err := db.Exec(ctx, `INSERT INTO auth_attempts(key,count,resets_at) VALUES(?,1,?)
				ON CONFLICT(key) DO UPDATE SET count=count+1`, limit.key, now+limit.window); err != nil {
				return err
			}
		}
		allowed = true
		return nil
	})
	if err != nil {
		return err
	}
	if !allowed {
		return httpx.Errorf(http.StatusTooManyRequests, "Too many attempts. Please try again later.")
	}
	return nil
}
