package carrier

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

func testCtx(t *testing.T) context.Context {
	t.Helper()
	t.Setenv("DATA_DIR", t.TempDir())
	ctx, err := scope.With(context.Background(), "demo", config.ModeDemo, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	return ctx
}

func seedOrder(t *testing.T, ctx context.Context) *store.Store {
	t.Helper()
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO demo_orders (
		id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency,
		paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"ord_test", "ORD-TEST", "Grace Hopper", "grace@example.com", "2 Compiler Lane",
		`[{"sku":"DJI-M3P-CINE","quantity":1,"name":"DJI","unit_price_cents":219900}]`,
		219900, "USD", "PAYPAL-TEST", "UPS", "TRK-1-UPS", "LABEL_CREATED", nil,
		"2026-01-01T00:00:00.000Z"); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	return db
}

func httpErr(t *testing.T, err error) *httpx.HTTPError {
	t.Helper()
	var he *httpx.HTTPError
	if !errors.As(err, &he) {
		t.Fatalf("expected HTTPError, got %T (%v)", err, err)
	}
	return he
}

func TestGenerateTrackingNumber(t *testing.T) {
	pattern := regexp.MustCompile(`^TRK-\d{9}-USPS$`)
	if !pattern.MatchString(GenerateTrackingNumber("USPS")) {
		t.Fatalf("unexpected tracking number format: %q", GenerateTrackingNumber("USPS"))
	}
}

func TestAdvanceCarrierStatus(t *testing.T) {
	ctx := testCtx(t)
	db := seedOrder(t, ctx)

	result, err := AdvanceCarrierStatus(ctx, "ord_test", nil)
	if err != nil {
		t.Fatalf("AdvanceCarrierStatus: %v", err)
	}
	if result["newStatus"] != "PICKED_UP" {
		t.Fatalf("expected PICKED_UP, got %#v", result["newStatus"])
	}
	order, ok := result["order"].(map[string]any)
	if !ok {
		t.Fatalf("order should be a map, got %T", result["order"])
	}
	if order["delivery_status"] != "PICKED_UP" {
		t.Fatalf("order not updated: %#v", order["delivery_status"])
	}
	items, ok := order["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("items should be parsed to an array: %#v", order["items"])
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM evidence_items WHERE order_id=?", "ord_test").Scan(&count); err != nil {
		t.Fatalf("count evidence: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 evidence row, got %d", count)
	}

	delivered := "DELIVERED"
	result, err = AdvanceCarrierStatus(ctx, "ord_test", &delivered)
	if err != nil {
		t.Fatalf("AdvanceCarrierStatus(delivered): %v", err)
	}
	if result["newStatus"] != "DELIVERED" {
		t.Fatalf("expected DELIVERED, got %#v", result["newStatus"])
	}
	order = result["order"].(map[string]any)
	if order["delivered_at"] == nil {
		t.Fatalf("delivered_at should be set")
	}
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM evidence_items WHERE order_id=? AND evidence_type='PROOF_OF_DELIVERY'", "ord_test").Scan(&count); err != nil {
		t.Fatalf("count pod: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 proof-of-delivery row, got %d", count)
	}

	// Repeating the same status is a no-op.
	result, err = AdvanceCarrierStatus(ctx, "ord_test", &delivered)
	if err != nil {
		t.Fatalf("no-op advance: %v", err)
	}
	if result["newStatus"] != "DELIVERED" {
		t.Fatalf("expected DELIVERED no-op, got %#v", result["newStatus"])
	}

	// Backwards transitions are rejected.
	back := "PICKED_UP"
	if _, err := AdvanceCarrierStatus(ctx, "ord_test", &back); err == nil {
		t.Fatalf("expected backwards transition error")
	} else if he := httpErr(t, err); he.Status != http.StatusConflict || he.Message != "Carrier status cannot move backwards" {
		t.Fatalf("unexpected backwards error: %d %q", he.Status, he.Message)
	}

	// Unknown targets are rejected.
	invalid := "NOPE"
	if _, err := AdvanceCarrierStatus(ctx, "ord_test", &invalid); err == nil {
		t.Fatalf("expected invalid status error")
	} else if he := httpErr(t, err); he.Status != http.StatusBadRequest || he.Message != "Invalid carrier status" {
		t.Fatalf("unexpected invalid error: %d %q", he.Status, he.Message)
	}

	// Missing orders surface a 404.
	if _, err := AdvanceCarrierStatus(ctx, "missing", nil); err == nil {
		t.Fatalf("expected not found error")
	} else if he := httpErr(t, err); he.Status != http.StatusNotFound || he.Message != "Order not found" {
		t.Fatalf("unexpected not found error: %d %q", he.Status, he.Message)
	}
}
