// Package types holds the domain records shared across the backend. Field names
// and JSON tags mirror src/lib/types.ts so the existing frontend continues to
// consume identical payloads.
package types

import (
	"database/sql"
	"database/sql/driver"
	"encoding/json"
)

// NullableString serializes to a JSON string or null and scans SQL NULL safely.
type NullableString struct{ sql.NullString }

// MarshalJSON emits null for absent values, matching the TypeScript `T | null` shape.
func (n NullableString) MarshalJSON() ([]byte, error) {
	if !n.Valid {
		return []byte("null"), nil
	}
	return json.Marshal(n.String)
}

// Scan implements sql.Scanner.
func (n *NullableString) Scan(value any) error { return n.NullString.Scan(value) }

// Value implements driver.Valuer.
func (n NullableString) Value() (driver.Value, error) { return n.NullString.Value() }

// Ptr returns a pointer to the underlying string, or nil when absent.
func (n NullableString) Ptr() *string {
	if !n.Valid {
		return nil
	}
	s := n.String
	return &s
}

// Str returns the underlying string or the empty string when absent.
func (n NullableString) Str() string { return n.String }

// NullString builds a valid NullableString.
func NullString(v string) NullableString {
	return NullableString{sql.NullString{String: v, Valid: true}}
}

// DisputeReason enumerates PayPal dispute reasons.
type DisputeReason string

const (
	ReasonNotReceived      DisputeReason = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
	ReasonNotAsDescribed   DisputeReason = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
	ReasonUnauthorised     DisputeReason = "UNAUTHORISED"
	ReasonIncorrectAmount  DisputeReason = "INCORRECT_AMOUNT"
	ReasonDuplicate        DisputeReason = "DUPLICATE_TRANSACTION"
	ReasonCancelledService DisputeReason = "BUYER_CANCELLED_SERVICE"
	ReasonOther            DisputeReason = "OTHER"
)

// DisputeStatus enumerates dispute lifecycle states.
type DisputeStatus string

const (
	StatusRequiredAction DisputeStatus = "REQUIRED_ACTION"
	StatusUnderReview    DisputeStatus = "UNDER_REVIEW"
	StatusResolved       DisputeStatus = "RESOLVED"
	StatusClosed         DisputeStatus = "CLOSED"
	StatusAppealed       DisputeStatus = "APPEALED"
)

// TriageRecommendation is the deterministic queue recommendation.
type TriageRecommendation string

const (
	RecommendFight    TriageRecommendation = "FIGHT"
	RecommendAccept   TriageRecommendation = "ACCEPT"
	RecommendAskHuman TriageRecommendation = "ASK A HUMAN"
)

// Dispute is a PayPal dispute tracked for a merchant.
type Dispute struct {
	ID               string         `json:"id"`
	PayPalDisputeID  string         `json:"paypal_dispute_id"`
	TransactionID    string         `json:"transaction_id"`
	OrderID          NullableString `json:"order_id"`
	Reason           string         `json:"reason"`
	AmountCents      int64          `json:"amount_cents"`
	Currency         string         `json:"currency"`
	Status           string         `json:"status"`
	ResponseDeadline string         `json:"response_deadline"`
	Outcome          NullableString `json:"outcome"`
	StrengthScore    int64          `json:"strength_score"`
	Recommendation   string         `json:"recommendation"`
	CreatedAt        string         `json:"created_at"`
	UpdatedAt        string         `json:"updated_at"`
	Provenance       string         `json:"provenance"`
}

// EvidenceType enumerates vault evidence categories.
type EvidenceType string

const (
	EvidenceProofOfDelivery   EvidenceType = "PROOF_OF_DELIVERY"
	EvidenceTrackingHistory   EvidenceType = "TRACKING_HISTORY"
	EvidenceOrderConfirmation EvidenceType = "ORDER_CONFIRMATION"
	EvidenceCustomerComms     EvidenceType = "CUSTOMER_COMMUNICATION"
	EvidenceRefundPolicy      EvidenceType = "REFUND_POLICY"
	EvidenceDeviceFingerprint EvidenceType = "DEVICE_FINGERPRINT"
)

// EvidenceItem is an immutable, hashed vault record.
type EvidenceItem struct {
	ID           string         `json:"id"`
	DisputeID    NullableString `json:"dispute_id"`
	OrderID      NullableString `json:"order_id"`
	EvidenceType string         `json:"evidence_type"`
	Source       string         `json:"source"`
	Title        string         `json:"title"`
	Content      string         `json:"content"`
	FilePath     NullableString `json:"file_path"`
	SHA256Hash   string         `json:"sha256_hash"`
	CapturedAt   string         `json:"captured_at"`
	Provenance   string         `json:"provenance"`
}

// Claim is a single cited assertion in a draft.
type Claim struct {
	ClaimID        string `json:"claim_id"`
	Text           string `json:"text"`
	ClaimType      string `json:"claim_type"`
	ExpectedValue  string `json:"expected_value"`
	EvidenceID     string `json:"evidence_id"`
	Verified       bool   `json:"verified"`
	MismatchReason string `json:"mismatch_reason,omitempty"`
}

// AIDraft is a generated, cited dispute response.
type AIDraft struct {
	ID                 string   `json:"id"`
	DisputeID          string   `json:"dispute_id"`
	Classification     string   `json:"classification"`
	DraftText          string   `json:"draft_text"`
	Claims             []Claim  `json:"claims"`
	SchemaValid        bool     `json:"schema_valid"`
	ModelName          string   `json:"model_name"`
	Verified           bool     `json:"verified"`
	VerificationErrors []string `json:"verification_errors"`
	CreatedAt          string   `json:"created_at"`
}

// ApprovalAction enumerates supported provider mutations.
type ApprovalAction string

const (
	ActionProvideEvidence   ApprovalAction = "PROVIDE_EVIDENCE"
	ActionAcceptClaim       ApprovalAction = "ACCEPT_CLAIM"
	ActionAppeal            ApprovalAction = "APPEAL"
	ActionMakeOffer         ApprovalAction = "MAKE_OFFER"
	ActionEscalate          ApprovalAction = "ESCALATE"
	ActionAcknowledgeReturn ApprovalAction = "ACKNOWLEDGE_RETURN_ITEM"
)

// ExactActionSnapshot freezes the reviewed provider request.
type ExactActionSnapshot struct {
	Environment     string         `json:"environment,omitempty"`
	ActionType      string         `json:"action_type"`
	DisputeID       string         `json:"dispute_id"`
	PayPalDisputeID string         `json:"paypal_dispute_id"`
	AmountCents     int64          `json:"amount_cents"`
	Currency        string         `json:"currency"`
	EvidenceIDs     []string       `json:"evidence_ids"`
	Notes           string         `json:"notes"`
	Timestamp       string         `json:"timestamp"`
	ProviderPayload map[string]any `json:"provider_payload,omitempty"`
}

// ApprovalReview is the reviewed digest and snapshot presented to a human.
type ApprovalReview struct {
	SnapshotDigest string         `json:"snapshot_digest"`
	Snapshot       map[string]any `json:"snapshot"`
	Operation      map[string]any `json:"operation,omitempty"`
}

// Approval is a recorded human decision.
type Approval struct {
	ID                  string          `json:"id"`
	DraftID             string          `json:"draft_id"`
	DisputeID           string          `json:"dispute_id"`
	Approver            string          `json:"approver"`
	ExactActionSnapshot json.RawMessage `json:"exact_action_snapshot"`
	Decision            string          `json:"decision"`
	IdempotencyKey      string          `json:"idempotency_key"`
	ExecutedAt          NullableString  `json:"executed_at"`
	CreatedAt           string          `json:"created_at"`
}

// AuditLogEntry is one immutable audit record.
type AuditLogEntry struct {
	ID        string          `json:"id"`
	DisputeID NullableString  `json:"dispute_id"`
	Actor     string          `json:"actor"`
	Action    string          `json:"action"`
	Detail    json.RawMessage `json:"detail"`
	SHA256    string          `json:"sha256_hash"`
	CreatedAt string          `json:"created_at"`
}

// DemoOrder mirrors a storefront order row.
type DemoOrder struct {
	ID              string          `json:"id"`
	OrderNumber     string          `json:"order_number"`
	BuyerName       string          `json:"buyer_name"`
	BuyerEmail      string          `json:"buyer_email"`
	ShippingAddress string          `json:"shipping_address"`
	Items           json.RawMessage `json:"items"`
	TotalCents      int64           `json:"total_cents"`
	Currency        string          `json:"currency"`
	PayPalOrderID   NullableString  `json:"paypal_order_id"`
	Carrier         NullableString  `json:"carrier"`
	TrackingNumber  NullableString  `json:"tracking_number"`
	DeliveryStatus  string          `json:"delivery_status"`
	DeliveredAt     NullableString  `json:"delivered_at"`
	CreatedAt       string          `json:"created_at"`
	Provenance      string          `json:"provenance"`
}

// UserAccount is the public merchant profile (never credentials).
type UserAccount struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	StoreName string  `json:"store_name"`
	Role      string  `json:"role"`
	AvatarURL *string `json:"avatar_url"`
	CreatedAt string  `json:"created_at"`
}

// PayPalWebhookEvent is a validated inbound provider event.
type PayPalWebhookEvent struct {
	ID           string         `json:"id"`
	EventVersion string         `json:"event_version"`
	CreateTime   string         `json:"create_time"`
	ResourceType string         `json:"resource_type"`
	EventType    string         `json:"event_type"`
	Summary      string         `json:"summary"`
	Resource     map[string]any `json:"resource"`
	Links        []any          `json:"links"`
}
