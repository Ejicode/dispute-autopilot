package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"github.com/Ejicode/dispute-autopilot/internal/config"
)

// RandomHex returns n random bytes as lowercase hex.
func RandomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// RandomID returns a prefixed identifier, e.g. "ev_1a2b...".
func RandomID(prefix string, bytes int) string {
	return prefix + RandomHex(bytes)
}

// SHA256Hex hashes content to a lowercase hex digest.
func SHA256Hex(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

// RandomUUID returns a lowercase RFC 4122 v4 UUID (matches crypto.randomUUID()).
func RandomUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return hex.EncodeToString(b[0:4]) + "-" + hex.EncodeToString(b[4:6]) + "-" +
		hex.EncodeToString(b[6:8]) + "-" + hex.EncodeToString(b[8:10]) + "-" +
		hex.EncodeToString(b[10:16])
}

// Nullable returns nil for an empty-NullableString-equivalent and a pointer otherwise.
func Nullable(v string) any {
	if v == "" {
		return nil
	}
	return v
}

// Audit appends an immutable, self-hashed audit entry and returns its ID.
func Audit(ctx context.Context, actor, action string, detail any, disputeID *string) (string, error) {
	s, err := Merchant(ctx)
	if err != nil {
		return "", err
	}
	id := RandomID("aud_", 8)
	timestamp := config.NowISO()
	detailBytes, err := json.Marshal(detail)
	if err != nil {
		return "", err
	}
	detailStr := string(detailBytes)

	dispute := ""
	if disputeID != nil {
		dispute = *disputeID
	}
	hashInput := id + ":" + dispute + ":" + actor + ":" + action + ":" + detailStr + ":" + timestamp
	sha := SHA256Hex([]byte(hashInput))

	var disputeVal any
	if disputeID != nil {
		disputeVal = *disputeID
	}
	if _, err := s.Exec(ctx, `INSERT INTO audit_log (id, dispute_id, actor, action, detail, sha256_hash, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, id, disputeVal, actor, action, detailStr, sha, timestamp); err != nil {
		return "", err
	}
	return id, nil
}
