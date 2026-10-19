// Package vault stores immutable, hashed evidence and renders dispute packets.
package vault

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// evidenceColumns is the explicit projection used everywhere evidence is read.
const evidenceColumns = `id, dispute_id, order_id, evidence_type, source, title, content, file_path, sha256_hash, captured_at, provenance`

// AddParams describes a vault capture.
type AddParams struct {
	DisputeID    *string
	OrderID      *string
	EvidenceType string
	Source       string
	Title        string
	Content      string
	FilePath     *string
	Publish      *bool
	Provenance   string
}

// CalculateSHA256 returns the lowercase hex digest of content.
func CalculateSHA256(content string) string { return store.SHA256Hex([]byte(content)) }

// AddToVault captures an item with an immutable SHA-256 hash.
func AddToVault(ctx context.Context, params AddParams) (types.EvidenceItem, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return types.EvidenceItem{}, err
	}
	sc, err := scope.From(ctx)
	if err != nil {
		return types.EvidenceItem{}, err
	}

	id := store.RandomID("ev_", 8)
	capturedAt := config.NowISO()
	provenance := params.Provenance
	if provenance == "" {
		if sc.Mode == config.ModeDemo {
			provenance = "DEMO"
		} else {
			provenance = "UNKNOWN"
		}
	}
	hash := CalculateSHA256(params.Content)

	var disputeVal, orderVal, fileVal any
	if params.DisputeID != nil {
		disputeVal = *params.DisputeID
	}
	if params.OrderID != nil {
		orderVal = *params.OrderID
	}
	if params.FilePath != nil {
		fileVal = *params.FilePath
	}

	if _, err := db.Exec(ctx, `INSERT INTO evidence_items (
		id, dispute_id, order_id, evidence_type, source, title, content, file_path, sha256_hash, captured_at, provenance
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, disputeVal, orderVal, params.EvidenceType, params.Source, params.Title,
		params.Content, fileVal, hash, capturedAt, provenance); err != nil {
		return types.EvidenceItem{}, err
	}

	item := types.EvidenceItem{
		ID:           id,
		EvidenceType: params.EvidenceType,
		Source:       params.Source,
		Title:        params.Title,
		Content:      params.Content,
		SHA256Hash:   hash,
		CapturedAt:   capturedAt,
		Provenance:   provenance,
	}
	if params.DisputeID != nil {
		item.DisputeID = types.NullString(*params.DisputeID)
	}
	if params.OrderID != nil {
		item.OrderID = types.NullString(*params.OrderID)
	}
	if params.FilePath != nil {
		item.FilePath = types.NullString(*params.FilePath)
	}

	auditDispute := params.DisputeID
	if _, err := store.Audit(ctx, "system", "EVIDENCE_VAULT_ITEM_ADDED", map[string]any{
		"evidence_id":   id,
		"evidence_type": params.EvidenceType,
		"sha256_hash":   hash,
		"title":         params.Title,
		"source":        params.Source,
	}, auditDispute); err != nil {
		return types.EvidenceItem{}, err
	}

	if params.Publish == nil || *params.Publish {
		realtime.Default().Publish(ctx, "VAULT_ITEM_ADDED", item)
	}
	return item, nil
}

// EvidenceForDispute returns vault evidence linked to a dispute or its order.
func EvidenceForDispute(ctx context.Context, disputeID string) ([]types.EvidenceItem, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, `SELECT `+evidenceColumns+` FROM evidence_items
		WHERE dispute_id = ? OR order_id = (SELECT order_id FROM disputes WHERE id = ?)
		ORDER BY captured_at ASC, id ASC`, disputeID, disputeID)
	if err != nil {
		return nil, err
	}
	return scanEvidence(rows)
}

// EvidenceForOrder returns vault evidence linked to an order.
func EvidenceForOrder(ctx context.Context, orderID string) ([]types.EvidenceItem, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, `SELECT `+evidenceColumns+` FROM evidence_items
		WHERE order_id = ? ORDER BY captured_at ASC`, orderID)
	if err != nil {
		return nil, err
	}
	return scanEvidence(rows)
}

// LinkOrderEvidence attaches order evidence to a dispute when it opens.
func LinkOrderEvidence(ctx context.Context, orderID, disputeID string) error {
	db, err := store.Merchant(ctx)
	if err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `UPDATE evidence_items SET dispute_id = ?
		WHERE order_id = ? AND (dispute_id IS NULL OR dispute_id = '')`, disputeID, orderID); err != nil {
		return err
	}
	_, err = store.Audit(ctx, "system", "ORDER_EVIDENCE_LINKED_TO_DISPUTE", map[string]any{
		"order_id":   orderID,
		"dispute_id": disputeID,
	}, &disputeID)
	return err
}

// IntegrityResult reports the outcome of a tamper check.
type IntegrityResult struct {
	Valid       bool   `json:"valid"`
	CurrentHash string `json:"currentHash"`
	StoredHash  string `json:"storedHash"`
}

// VerifyIntegrity recomputes an evidence item's hash.
func VerifyIntegrity(ctx context.Context, itemID string) (IntegrityResult, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return IntegrityResult{}, err
	}
	rows, err := db.Query(ctx, `SELECT `+evidenceColumns+` FROM evidence_items WHERE id = ?`, itemID)
	if err != nil {
		return IntegrityResult{}, err
	}
	items, err := scanEvidence(rows)
	if err != nil {
		return IntegrityResult{}, err
	}
	if len(items) == 0 {
		return IntegrityResult{}, fmt.Errorf("Evidence item %s not found", itemID)
	}
	current := CalculateSHA256(items[0].Content)
	return IntegrityResult{Valid: current == items[0].SHA256Hash, CurrentHash: current, StoredHash: items[0].SHA256Hash}, nil
}

func scanEvidence(rows *sql.Rows) ([]types.EvidenceItem, error) {
	defer rows.Close()
	items := []types.EvidenceItem{}
	for rows.Next() {
		var item types.EvidenceItem
		if err := rows.Scan(
			&item.ID, &item.DisputeID, &item.OrderID, &item.EvidenceType, &item.Source,
			&item.Title, &item.Content, &item.FilePath, &item.SHA256Hash, &item.CapturedAt, &item.Provenance,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

// ErrNotFound is returned when a requested record does not exist.
var ErrNotFound = errors.New("not found")
