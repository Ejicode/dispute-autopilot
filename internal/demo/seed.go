package demo

import (
	"bytes"
	"context"
	"encoding/json"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
	"github.com/Ejicode/dispute-autopilot/internal/vault"
)

// SeedWorkspace populates the scoped merchant database with realistic dispute
// scenarios, storefront orders, and cryptographically hashed vault records.
func SeedWorkspace(ctx context.Context) error {
	db, err := store.Merchant(ctx)
	if err != nil {
		return err
	}

	for _, statement := range []string{
		"DELETE FROM approval_operations",
		"DELETE FROM paypal_captures",
		"DELETE FROM paypal_dispute_versions",
		"DELETE FROM webhook_inbox",
		"DELETE FROM approvals",
		"DELETE FROM ai_drafts",
		"DELETE FROM evidence_items",
		"DELETE FROM disputes",
		"DELETE FROM demo_orders",
		"DELETE FROM paypal_events",
		"DELETE FROM audit_log",
	} {
		if _, err := db.Exec(ctx, statement); err != nil {
			return err
		}
	}

	now := time.Now()

	// 1. Demo order 1 — high-value tech gadget ($1,240.00).
	const order1ID = "ord_101"
	const order1Number = "ORD-2026-98214"
	const tracking1 = "TRK-98214-USPS"
	order1Items := compactJSON([]orderItem{{Name: "UltraHD 4K Drone Pro", Quantity: 1, UnitPriceCents: 124000, SKU: "DRONE-4K-PRO"}})
	if _, err := db.Exec(ctx, `INSERT INTO demo_orders (
		id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency,
		paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		order1ID, order1Number, "Jordan Miller", "jordan.miller@example.com",
		"742 Evergreen Terrace, Springfield, OR 97477", order1Items, 124000, "USD",
		"PP-ORDER-98214", "USPS", tracking1, "DELIVERED",
		isoAgoDays(now, 4), isoAgoDays(now, 7)); err != nil {
		return err
	}

	captured := capture{ctx: ctx}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order1ID),
		EvidenceType: string(types.EvidenceOrderConfirmation),
		Source:       "STOREFRONT_GATEWAY",
		Title:        "Itemized Order Confirmation & Payment Receipt",
		Content: prettyJSON(orderConfirmation1{
			OrderNumber:     order1Number,
			BuyerName:       "Jordan Miller",
			Email:           "jordan.miller@example.com",
			ShippingAddress: "742 Evergreen Terrace, Springfield, OR 97477",
			TotalCents:      124000,
			Currency:        "USD",
			PaymentMethod:   "PayPal Express Checkout",
			TransactionID:   "9XY88192031124",
			SKU:             "DRONE-4K-PRO",
			Timestamp:       isoAgoDays(now, 7),
		}),
	}); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order1ID),
		EvidenceType: string(types.EvidenceTrackingHistory),
		Source:       "CARRIER_SIMULATOR",
		Title:        "Carrier Shipment Tracking Log (USPS)",
		Content: prettyJSON(trackingHistory{
			Carrier:        "USPS Priority Mail Express",
			TrackingNumber: tracking1,
			Status:         "DELIVERED",
			Events: []trackingEvent{
				{Status: "LABEL_CREATED", Timestamp: isoAgoDays(now, 6), Location: "Portland, OR"},
				{Status: "PICKED_UP", Timestamp: isoAgoDays(now, 5.8), Location: "Portland, OR"},
				{Status: "IN_TRANSIT", Timestamp: isoAgoDays(now, 5), Location: "Eugene Sorting Hub, OR"},
				{Status: "OUT_FOR_DELIVERY", Timestamp: isoAgoDays(now, 4.2), Location: "Springfield, OR"},
				{Status: "DELIVERED", Timestamp: isoAgoDays(now, 4), Location: "Springfield, OR", SignedBy: "J. MILLER"},
			},
			Label: "DEMO DATA - CARRIER SIMULATOR",
		}),
	}); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order1ID),
		EvidenceType: string(types.EvidenceProofOfDelivery),
		Source:       "CARRIER_SIMULATOR",
		Title:        "Carrier Electronic Proof of Delivery & Signature",
		Content: prettyJSON(proofOfDelivery{
			Carrier:            "USPS Priority Mail Express",
			TrackingNumber:     tracking1,
			DeliveryAddress:    "742 Evergreen Terrace, Springfield, OR 97477",
			DeliveredAt:        isoAgoDays(now, 4),
			RecipientSignature: "J. MILLER (SIGNATURE_VERIFIED)",
			GPSCoordinates:     "44.0462° N, 123.0220° W",
			Label:              "DEMO DATA - CARRIER SIMULATOR",
		}),
	}); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order1ID),
		EvidenceType: string(types.EvidenceRefundPolicy),
		Source:       "STOREFRONT_TERMS",
		Title:        "Merchant Terms of Sale & Fulfillment Policy",
		Content:      "All orders over $750 require adult signature confirmation. Tracking details automatically transmitted to customer email upon carrier intake.",
	}); err != nil {
		return err
	}

	// Dispute 1 — the $1,240 hero case expiring in 36 hours.
	const dispute1ID = "dsp_hero_1240"
	dispute1 := types.Dispute{
		ID:               dispute1ID,
		PayPalDisputeID:  "PP-D-99214",
		TransactionID:    "9XY88192031124",
		OrderID:          types.NullString(order1ID),
		Reason:           string(types.ReasonNotReceived),
		AmountCents:      124000,
		Currency:         "USD",
		Status:           string(types.StatusRequiredAction),
		ResponseDeadline: isoAheadHours(now, 36),
		Outcome:          types.NullString("PENDING"),
		StrengthScore:    100,
		Recommendation:   string(types.RecommendFight),
		CreatedAt:        isoAgoHours(now, 12),
		UpdatedAt:        isoAgoHours(now, 12),
	}
	if err := insertDispute(ctx, db, dispute1); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, "UPDATE evidence_items SET dispute_id = ? WHERE order_id = ?", dispute1ID, order1ID); err != nil {
		return err
	}
	evidence1, err := vault.EvidenceForDispute(ctx, dispute1ID)
	if err != nil {
		return err
	}
	if _, err := ai.GenerateCitedDraft(ctx, dispute1, evidence1,
		`Buyer stated: "Package never arrived at my address. Requesting full refund."`); err != nil {
		return err
	}
	if _, err := store.Audit(ctx, "paypal", "DISPUTE_SYNCHRONIZED", map[string]any{
		"dispute_id":        dispute1ID,
		"paypal_dispute_id": dispute1.PayPalDisputeID,
		"amount_cents":      124000,
		"source":            "PAYPAL_SANDBOX_WEBHOOK",
	}, ptr(dispute1ID)); err != nil {
		return err
	}

	// 2. Dispute 2 — $185 SNAD dispute expiring in 44 hours.
	const order2ID = "ord_102"
	const tracking2 = "TRK-55219-FEDEX"
	order2Items := compactJSON([]orderItem{{Name: "Wireless Ergonomic Keyboard", Quantity: 1, UnitPriceCents: 18500, SKU: "KEY-ERG-01"}})
	if _, err := db.Exec(ctx, `INSERT INTO demo_orders (
		id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency,
		paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		order2ID, "ORD-2026-55219", "Morgan Chen", "morgan.chen@example.com",
		"450 Mission St, San Francisco, CA 94105", order2Items, 18500, "USD",
		"PP-ORDER-55219", "FedEx", tracking2, "DELIVERED",
		isoAgoDays(now, 3), isoAgoDays(now, 6)); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order2ID),
		EvidenceType: string(types.EvidenceOrderConfirmation),
		Source:       "STOREFRONT_GATEWAY",
		Title:        "Keyboard Purchase Invoice",
		Content: compactJSON(orderConfirmation2{
			OrderNumber:     "ORD-2026-55219",
			BuyerName:       "Morgan Chen",
			AmountCents:     18500,
			Currency:        "USD",
			ShippingAddress: "450 Mission St, San Francisco, CA 94105",
		}),
	}); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order2ID),
		EvidenceType: string(types.EvidenceRefundPolicy),
		Source:       "STOREFRONT_TERMS",
		Title:        "Hardware Return Guidelines",
		Content:      "Items must be returned in original packaging with serial number intact.",
	}); err != nil {
		return err
	}

	const dispute2ID = "dsp_snad_185"
	dispute2 := types.Dispute{
		ID:               dispute2ID,
		PayPalDisputeID:  "PP-D-55219",
		TransactionID:    "8TY441992010",
		OrderID:          types.NullString(order2ID),
		Reason:           string(types.ReasonNotAsDescribed),
		AmountCents:      18500,
		Currency:         "USD",
		Status:           string(types.StatusRequiredAction),
		ResponseDeadline: isoAheadHours(now, 44),
		Outcome:          types.NullString("PENDING"),
		StrengthScore:    80,
		Recommendation:   string(types.RecommendFight),
		CreatedAt:        isoAgoHours(now, 8),
		UpdatedAt:        isoAgoHours(now, 8),
	}
	if err := insertDispute(ctx, db, dispute2); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, "UPDATE evidence_items SET dispute_id = ? WHERE order_id = ?", dispute2ID, order2ID); err != nil {
		return err
	}
	evidence2, err := vault.EvidenceForDispute(ctx, dispute2ID)
	if err != nil {
		return err
	}
	if _, err := ai.GenerateCitedDraft(ctx, dispute2, evidence2,
		`Buyer stated: "Keycaps feel slightly different from what I expected."`); err != nil {
		return err
	}

	// 3. Dispute 3 — $65 Unauthorized dispute demonstrating ACCEPT / low evidence recommendation.
	const order3ID = "ord_103"
	order3Items := compactJSON([]orderItem{{Name: "Digital Sound Sample Pack", Quantity: 1, UnitPriceCents: 6500, SKU: "DIG-SND-01"}})
	if _, err := db.Exec(ctx, `INSERT INTO demo_orders (
		id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency,
		paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		order3ID, "ORD-2026-33109", "Alex Rivera", "alex.rivera@example.com",
		"100 N University Ave, Provo, UT 84601", order3Items, 6500, "USD",
		"PP-ORDER-33109", "DIGITAL", "N/A", "DELIVERED",
		isoAgoDays(now, 1), isoAgoDays(now, 2)); err != nil {
		return err
	}
	if err := captured.add(vault.AddParams{
		OrderID:      ptr(order3ID),
		EvidenceType: string(types.EvidenceOrderConfirmation),
		Source:       "STOREFRONT_GATEWAY",
		Title:        "Digital Download Receipt",
		Content: compactJSON(orderConfirmation2{
			OrderNumber:     "ORD-2026-33109",
			BuyerName:       "Alex Rivera",
			AmountCents:     6500,
			Currency:        "USD",
			ShippingAddress: "100 N University Ave, Provo, UT 84601",
		}),
	}); err != nil {
		return err
	}

	const dispute3ID = "dsp_unauth_65"
	dispute3 := types.Dispute{
		ID:               dispute3ID,
		PayPalDisputeID:  "PP-D-33109",
		TransactionID:    "7UA119920330",
		OrderID:          types.NullString(order3ID),
		Reason:           string(types.ReasonUnauthorised),
		AmountCents:      6500,
		Currency:         "USD",
		Status:           string(types.StatusRequiredAction),
		ResponseDeadline: isoAheadHours(now, 72),
		Outcome:          types.NullString("PENDING"),
		StrengthScore:    20,
		Recommendation:   string(types.RecommendAccept),
		CreatedAt:        isoAgoHours(now, 4),
		UpdatedAt:        isoAgoHours(now, 4),
	}
	if err := insertDispute(ctx, db, dispute3); err != nil {
		return err
	}
	if _, err := db.Exec(ctx, "UPDATE evidence_items SET dispute_id = ? WHERE order_id = ?", dispute3ID, order3ID); err != nil {
		return err
	}
	evidence3, err := vault.EvidenceForDispute(ctx, dispute3ID)
	if err != nil {
		return err
	}
	if _, err := ai.GenerateCitedDraft(ctx, dispute3, evidence3,
		`Buyer stated: "Unauthorised charge on card. Did not authorize this purchase."`); err != nil {
		return err
	}

	return nil
}

type capture struct{ ctx context.Context }

func (c capture) add(params vault.AddParams) error {
	_, err := vault.AddToVault(c.ctx, params)
	return err
}

func insertDispute(ctx context.Context, db *store.Store, dispute types.Dispute) error {
	_, err := db.Exec(ctx, `INSERT INTO disputes (
		id, paypal_dispute_id, transaction_id, order_id, reason, amount_cents, currency, status,
		response_deadline, outcome, strength_score, recommendation, created_at, updated_at
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		dispute.ID, dispute.PayPalDisputeID, dispute.TransactionID, dispute.OrderID.Str(),
		dispute.Reason, dispute.AmountCents, dispute.Currency, dispute.Status,
		dispute.ResponseDeadline, dispute.Outcome.Str(), dispute.StrengthScore, dispute.Recommendation,
		dispute.CreatedAt, dispute.UpdatedAt)
	return err
}

func ptr(value string) *string { return &value }

func isoAgoDays(now time.Time, days float64) string {
	return config.FormatISO(now.Add(-time.Duration(days * 24 * float64(time.Hour))))
}

func isoAgoHours(now time.Time, hours float64) string {
	return config.FormatISO(now.Add(-time.Duration(hours * float64(time.Hour))))
}

func isoAheadHours(now time.Time, hours float64) string {
	return config.FormatISO(now.Add(time.Duration(hours * float64(time.Hour))))
}

func compactJSON(v any) string {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(v); err != nil {
		return "{}"
	}
	return string(bytes.TrimRight(buf.Bytes(), "\n"))
}

func prettyJSON(v any) string {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(v); err != nil {
		return "{}"
	}
	return string(bytes.TrimRight(buf.Bytes(), "\n"))
}

type orderItem struct {
	Name           string `json:"name"`
	Quantity       int    `json:"quantity"`
	UnitPriceCents int64  `json:"unit_price_cents"`
	SKU            string `json:"sku"`
}

type orderConfirmation1 struct {
	OrderNumber     string `json:"order_number"`
	BuyerName       string `json:"buyer_name"`
	Email           string `json:"email"`
	ShippingAddress string `json:"shipping_address"`
	TotalCents      int64  `json:"total_cents"`
	Currency        string `json:"currency"`
	PaymentMethod   string `json:"payment_method"`
	TransactionID   string `json:"transaction_id"`
	SKU             string `json:"sku"`
	Timestamp       string `json:"timestamp"`
}

type trackingEvent struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Location  string `json:"location"`
	SignedBy  string `json:"signed_by,omitempty"`
}

type trackingHistory struct {
	Carrier        string          `json:"carrier"`
	TrackingNumber string          `json:"tracking_number"`
	Status         string          `json:"status"`
	Events         []trackingEvent `json:"events"`
	Label          string          `json:"label"`
}

type proofOfDelivery struct {
	Carrier            string `json:"carrier"`
	TrackingNumber     string `json:"tracking_number"`
	DeliveryAddress    string `json:"delivery_address"`
	DeliveredAt        string `json:"delivered_at"`
	RecipientSignature string `json:"recipient_signature"`
	GPSCoordinates     string `json:"gps_coordinates"`
	Label              string `json:"label"`
}

type orderConfirmation2 struct {
	OrderNumber     string `json:"order_number"`
	BuyerName       string `json:"buyer_name"`
	AmountCents     int64  `json:"amount_cents"`
	Currency        string `json:"currency"`
	ShippingAddress string `json:"shipping_address"`
}

// EnsureDemoAccounts pre-seeds the demo merchant accounts in auth.db so login works out-of-the-box.
func EnsureDemoAccounts(ctx context.Context) error {
	db, err := store.Auth()
	if err != nil {
		return err
	}
	demoUsers := []struct {
		ID        string
		Email     string
		Name      string
		StoreName string
		Password  string
	}{
		{
			ID:        "usr_demo_da_admin",
			Email:     "admin@disputeautopilot.com",
			Name:      "DA Admin",
			StoreName: "DA Store",
			Password:  "Password12345678!",
		},
		{
			ID:        "usr_demo_auditor_2026",
			Email:     "auditor@paypal.test",
			Name:      "PayPal Risk Auditor",
			StoreName: "DA Store",
			Password:  "Password12345678!",
		},
		{
			ID:        "usr_demo_sandbox_merchant",
			Email:     "sb-n0htc53113313@business.example.com",
			Name:      "PayPal Sandbox Merchant",
			StoreName: "DA Store",
			Password:  "5k8g!_0O",
		},
		{
			ID:        "usr_demo_merchant_default",
			Email:     "demo@merchant.com",
			Name:      "Demo Merchant",
			StoreName: "DA Store",
			Password:  "Password12345678!",
		},
	}

	for _, u := range demoUsers {
		var exists int
		_ = db.QueryRow(ctx, "SELECT 1 FROM accounts WHERE email = ?", u.Email).Scan(&exists)
		if exists != 1 {
			hash, err := auth.HashPassword(u.Password)
			if err == nil {
				_, _ = db.Exec(ctx, `INSERT INTO accounts (id, email, name, store_name, role, password_hash, created_at)
					VALUES (?, ?, ?, ?, 'MERCHANT_ADMIN', ?, ?)`,
					u.ID, u.Email, u.Name, u.StoreName, hash, config.NowISO())
			}
		}

		userAccount := &types.UserAccount{
			ID:        u.ID,
			Email:     u.Email,
			Name:      u.Name,
			StoreName: u.StoreName,
			Role:      "MERCHANT_ADMIN",
		}
		scopedCtx, err := scope.With(ctx, u.ID, config.ModeDemo, userAccount)
		if err == nil {
			mDB, mErr := store.Merchant(scopedCtx)
			if mErr == nil {
				var count int
				_ = mDB.QueryRow(scopedCtx, "SELECT COUNT(*) FROM disputes").Scan(&count)
				if count == 0 {
					_ = SeedWorkspace(scopedCtx)
				}
			}
		}
	}
	return nil
}

