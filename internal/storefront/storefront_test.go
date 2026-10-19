package storefront

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
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

func TestCatalog(t *testing.T) {
	products := Products()
	if len(products) != 52 {
		t.Fatalf("expected 52 products, got %d", len(products))
	}
	first := products[0]
	if first["id"] != "prod_1" || first["sku"] != "DJI-M3P-CINE" {
		t.Fatalf("unexpected first product: %#v", first)
	}
	if first["price_cents"] != int64(219900) {
		t.Fatalf("unexpected price: %#v", first["price_cents"])
	}
	if _, ok := first["specs"].(map[string]string); !ok {
		t.Fatalf("specs should be a string map")
	}
	last := products[len(products)-1]
	if last["id"] != "prod_52" || last["carrier_default"] != "FEDEX" {
		t.Fatalf("unexpected last product: %#v", last)
	}
}

func TestCheckoutAndListOrders(t *testing.T) {
	ctx := testCtx(t)
	body := map[string]any{
		"buyer_name":       "Ada Lovelace",
		"buyer_email":      "ada@example.com",
		"shipping_address": "1 Analytical Engine Way",
		"items": []any{
			map[string]any{"sku": "DJI-M3P-CINE", "quantity": 2},
			map[string]any{"sku": "DJI-M3P-CINE", "quantity": 1},
		},
		"carrier": "FEDEX",
	}
	result, err := Checkout(ctx, body)
	if err != nil {
		t.Fatalf("Checkout: %v", err)
	}
	if result["success"] != true {
		t.Fatalf("expected success true, got %#v", result["success"])
	}
	order, ok := result["order"].(map[string]any)
	if !ok {
		t.Fatalf("order should be a map, got %T", result["order"])
	}
	if order["provenance"] != "DEMO" {
		t.Fatalf("unexpected provenance: %#v", order["provenance"])
	}
	if order["total_cents"] != int64(659700) {
		t.Fatalf("expected total 659700, got %#v", order["total_cents"])
	}
	if order["carrier"] != "FEDEX" || order["delivery_status"] != "LABEL_CREATED" {
		t.Fatalf("unexpected order fields: %#v", order)
	}
	if !strings.HasPrefix(order["tracking_number"].(string), "TRK-") {
		t.Fatalf("unexpected tracking number: %#v", order["tracking_number"])
	}
	items, ok := order["items"].([]orderItem)
	if !ok || len(items) != 1 || items[0].Quantity != 3 || items[0].SKU != "DJI-M3P-CINE" {
		t.Fatalf("unexpected aggregated items: %#v", order["items"])
	}

	orders, err := ListOrders(ctx)
	if err != nil {
		t.Fatalf("ListOrders: %v", err)
	}
	if len(orders) != 1 {
		t.Fatalf("expected 1 order, got %d", len(orders))
	}
	parsed, ok := orders[0]["items"].([]any)
	if !ok || len(parsed) != 1 {
		t.Fatalf("items should be parsed to an array: %#v", orders[0]["items"])
	}
}

func TestCheckoutValidation(t *testing.T) {
	ctx := testCtx(t)
	base := func() map[string]any {
		return map[string]any{
			"buyer_name":       "Ada",
			"buyer_email":      "ada@example.com",
			"shipping_address": "1 Way",
			"items":            []any{map[string]any{"sku": "DJI-M3P-CINE", "quantity": 1}},
		}
	}

	cases := []struct {
		name   string
		mutate func(map[string]any)
		status int
		msg    string
	}{
		{"missing buyer", func(b map[string]any) { delete(b, "buyer_name") }, http.StatusBadRequest, "Invalid buyer_name."},
		{"bad email", func(b map[string]any) { b["buyer_email"] = "nope" }, http.StatusBadRequest, "Invalid buyer_email"},
		{"bad currency", func(b map[string]any) { b["currency"] = "EUR" }, http.StatusBadRequest, "Only USD is supported"},
		{"no items", func(b map[string]any) { b["items"] = []any{} }, http.StatusBadRequest, "Supply 1 to 100 items"},
		{"unknown sku", func(b map[string]any) { b["items"] = []any{map[string]any{"sku": "NOPE", "quantity": 1}} }, http.StatusBadRequest, "Unknown SKU or quantity exceeds demo catalog stock"},
		{"excess stock", func(b map[string]any) { b["items"] = []any{map[string]any{"sku": "DJI-M3P-CINE", "quantity": 99}} }, http.StatusBadRequest, "Unknown SKU or quantity exceeds demo catalog stock"},
		{"bad quantity", func(b map[string]any) { b["items"] = []any{map[string]any{"sku": "DJI-M3P-CINE", "quantity": 0}} }, http.StatusBadRequest, "Each item requires a catalog SKU and positive integer quantity"},
		{"bad carrier", func(b map[string]any) { b["carrier"] = "DHL" }, http.StatusBadRequest, "Unsupported carrier"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := base()
			tc.mutate(body)
			_, err := Checkout(ctx, body)
			if err == nil {
				t.Fatalf("expected error")
			}
			var he *httpx.HTTPError
			if !errors.As(err, &he) {
				t.Fatalf("expected HTTPError, got %T", err)
			}
			if he.Status != tc.status || he.Message != tc.msg {
				t.Fatalf("expected %d %q, got %d %q", tc.status, tc.msg, he.Status, he.Message)
			}
		})
	}
}
