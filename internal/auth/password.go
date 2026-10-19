package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"regexp"

	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"golang.org/x/crypto/scrypt"
)

// Scrypt parameters are identical to src/lib/auth/password.ts so existing
// password hashes remain valid after the migration.
const (
	scryptN = 131072
	scryptR = 8
	scryptP = 1
	scryptK = 64
)

var (
	saltPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
	hashPattern = regexp.MustCompile(`^[a-f0-9]{128}$`)
	// At most two concurrent expensive derivations, matching the TS limiter.
	passwordWork = make(chan struct{}, 2)
)

// derive performs the scrypt KDF, honoring a bounded concurrency window.
//
// Node passes the hex salt string as UTF-8 bytes, so Go must as well.
func derive(password, salt string) ([]byte, error) {
	select {
	case passwordWork <- struct{}{}:
	default:
		return nil, httpx.Errorf(429, "Sign-in service is busy. Please try again shortly.")
	}
	defer func() { <-passwordWork }()
	return scrypt.Key([]byte(password), []byte(salt), scryptN, scryptR, scryptP, scryptK)
}

// HashPassword returns a new scrypt-v1 encoded password hash.
func HashPassword(password string) (string, error) {
	saltBytes := make([]byte, 16)
	if _, err := rand.Read(saltBytes); err != nil {
		return "", err
	}
	salt := hex.EncodeToString(saltBytes)
	key, err := derive(password, salt)
	if err != nil {
		return "", err
	}
	return "scrypt-v1:" + salt + ":" + hex.EncodeToString(key), nil
}

// VerifyPassword checks a password against a stored hash. Unknown accounts still
// perform the expensive derivation to reduce enumeration.
func VerifyPassword(password string, stored string) (bool, error) {
	var salt, expectedHex string
	valid := false
	if stored != "" {
		if parts := splitColon(stored); len(parts) == 3 && parts[0] == "scrypt-v1" && saltPattern.MatchString(parts[1]) && hashPattern.MatchString(parts[2]) {
			salt, expectedHex, valid = parts[1], parts[2], true
		}
	}
	if !valid {
		salt = "00000000000000000000000000000000"
	}
	actual, err := derive(password, salt)
	if err != nil {
		return false, err
	}
	expected := make([]byte, scryptK)
	if valid {
		if decoded, derr := hex.DecodeString(expectedHex); derr == nil {
			expected = decoded
		} else {
			valid = false
		}
	}
	match := subtle.ConstantTimeCompare(actual, expected) == 1
	return match && valid, nil
}

func splitColon(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ':' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	out = append(out, s[start:])
	return out
}
