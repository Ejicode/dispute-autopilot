package store

import (
	"database/sql"
	"encoding/json"

	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// DisputeColumns is the canonical, explicit dispute projection. Using an
// explicit list keeps reads stable regardless of physical column order.
const DisputeColumns = `id, paypal_dispute_id, transaction_id, order_id, reason, amount_cents, currency, ` +
	`status, response_deadline, outcome, strength_score, recommendation, created_at, updated_at, provenance`

// EvidenceColumns is the canonical evidence projection.
const EvidenceColumns = `id, dispute_id, order_id, evidence_type, source, title, content, file_path, sha256_hash, captured_at, provenance`

// Scanner is satisfied by *sql.Row and *sql.Rows.
type Scanner interface{ Scan(dest ...any) error }

// ScanDispute scans a dispute row.
func ScanDispute(sc Scanner) (types.Dispute, error) {
	var d types.Dispute
	err := sc.Scan(
		&d.ID, &d.PayPalDisputeID, &d.TransactionID, &d.OrderID, &d.Reason, &d.AmountCents, &d.Currency,
		&d.Status, &d.ResponseDeadline, &d.Outcome, &d.StrengthScore, &d.Recommendation,
		&d.CreatedAt, &d.UpdatedAt, &d.Provenance,
	)
	return d, err
}

// ScanEvidence scans an evidence row.
func ScanEvidenceRow(sc Scanner) (types.EvidenceItem, error) {
	var item types.EvidenceItem
	err := sc.Scan(
		&item.ID, &item.DisputeID, &item.OrderID, &item.EvidenceType, &item.Source, &item.Title,
		&item.Content, &item.FilePath, &item.SHA256Hash, &item.CapturedAt, &item.Provenance,
	)
	return item, err
}

// ScanEvidenceRows drains every evidence row.
func ScanEvidenceRows(rows *sql.Rows) ([]types.EvidenceItem, error) {
	defer rows.Close()
	items := []types.EvidenceItem{}
	for rows.Next() {
		item, err := ScanEvidenceRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ScanAuditLog scans an audit row.
func ScanAuditLog(sc Scanner) (types.AuditLogEntry, error) {
	var entry types.AuditLogEntry
	var detail string
	err := sc.Scan(&entry.ID, &entry.DisputeID, &entry.Actor, &entry.Action, &detail, &entry.SHA256, &entry.CreatedAt)
	if err != nil {
		return entry, err
	}
	if detail != "" {
		entry.Detail = json.RawMessage(detail)
	} else {
		entry.Detail = json.RawMessage("null")
	}
	return entry, nil
}
