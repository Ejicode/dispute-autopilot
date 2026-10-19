package storefront

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"regexp"
	"strings"

	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/carrier"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
	"github.com/Ejicode/dispute-autopilot/internal/vault"
)

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

var supportedCarriers = []string{"USPS", "FEDEX", "UPS"}

// orderItem is the normalized line item persisted with an order.
type orderItem struct {
	SKU            string `json:"sku"`
	Quantity       int64  `json:"quantity"`
	Name           string `json:"name"`
	UnitPriceCents int64  `json:"unit_price_cents"`
}

// orderConfirmationPayload is archived as the ORDER_CONFIRMATION evidence.
type orderConfirmationPayload struct {
	OrderID         string      `json:"order_id"`
	OrderNumber     string      `json:"order_number"`
	BuyerName       string      `json:"buyer_name"`
	BuyerEmail      string      `json:"buyer_email"`
	ShippingAddress string      `json:"shipping_address"`
	Items           []orderItem `json:"items"`
	TotalCents      int64       `json:"total_cents"`
	Currency        string      `json:"currency"`
	PayPalOrderID   string      `json:"paypal_order_id"`
	PaidAt          string      `json:"paid_at"`
}

// initialTrackingEvent is the label-created carrier event.
type initialTrackingEvent struct {
	Status      string `json:"status"`
	Location    string `json:"location"`
	Description string `json:"description"`
	Timestamp   string `json:"timestamp"`
}

// initialTrackingPayload is archived as the initial TRACKING_HISTORY evidence.
type initialTrackingPayload struct {
	Carrier        string                 `json:"carrier"`
	TrackingNumber string                 `json:"tracking_number"`
	Status         string                 `json:"status"`
	Events         []initialTrackingEvent `json:"events"`
	Source         string                 `json:"source"`
}

// ListOrders returns the 20 most recent orders with items parsed from JSON.
func ListOrders(ctx context.Context) ([]map[string]any, error) {
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, "SELECT * FROM demo_orders ORDER BY created_at DESC LIMIT 20")
	if err != nil {
		return nil, err
	}
	return scanOrderRows(rows)
}

// Checkout captures a demo order, vaults its evidence, and returns the created
// order. It mirrors the POST handler in api/storefront/checkout/route.ts.
func Checkout(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := runtime.RequireDemo(ctx); err != nil {
		return nil, err
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}

	buyerName, err := auth.Field(body, "buyer_name", 160)
	if err != nil {
		return nil, err
	}
	buyerEmail, err := auth.Field(body, "buyer_email", 254)
	if err != nil {
		return nil, err
	}
	shippingAddress, err := auth.Field(body, "shipping_address", 1000)
	if err != nil {
		return nil, err
	}
	if !emailPattern.MatchString(buyerEmail) {
		return nil, httpx.Errorf(http.StatusBadRequest, "Invalid buyer_email")
	}
	if value, present := body["currency"]; present && value != "USD" {
		return nil, httpx.Errorf(http.StatusBadRequest, "Only USD is supported")
	}

	rawItems, ok := body["items"].([]any)
	if !ok || len(rawItems) == 0 || len(rawItems) > 100 {
		return nil, httpx.Errorf(http.StatusBadRequest, "Supply 1 to 100 items")
	}

	quantities := map[string]int64{}
	skuOrder := []string{}
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			return nil, httpx.Errorf(http.StatusBadRequest, "Each item requires a catalog SKU and positive integer quantity")
		}
		sku, ok := item["sku"].(string)
		if !ok {
			return nil, httpx.Errorf(http.StatusBadRequest, "Each item requires a catalog SKU and positive integer quantity")
		}
		quantity, ok := safeQuantity(item["quantity"])
		if !ok || quantity < 1 {
			return nil, httpx.Errorf(http.StatusBadRequest, "Each item requires a catalog SKU and positive integer quantity")
		}
		if _, seen := quantities[sku]; !seen {
			skuOrder = append(skuOrder, sku)
		}
		quantities[sku] += quantity
	}

	items := make([]orderItem, 0, len(skuOrder))
	var totalCents int64
	for _, sku := range skuOrder {
		quantity := quantities[sku]
		product := findProduct(sku)
		if product == nil || quantity > product.Stock {
			return nil, httpx.Errorf(http.StatusBadRequest, "Unknown SKU or quantity exceeds demo catalog stock")
		}
		items = append(items, orderItem{
			SKU:            sku,
			Quantity:       quantity,
			Name:           product.Name,
			UnitPriceCents: product.PriceCents,
		})
		totalCents += product.PriceCents * quantity
	}

	carrierName := "USPS"
	if _, present := body["carrier"]; present {
		value, err := auth.Field(body, "carrier", 10)
		if err != nil {
			return nil, err
		}
		carrierName = value
	}
	if !contains(supportedCarriers, carrierName) {
		return nil, httpx.Errorf(http.StatusBadRequest, "Unsupported carrier")
	}

	orderID := store.RandomID("ord_", 6)
	orderNumber := "ORD-" + strings.ToUpper(store.RandomHex(8))
	currency := "USD"
	paypalOrderID := "PAYPAL-ORD-" + strings.ToUpper(store.RandomHex(6))
	trackingNumber := carrier.GenerateTrackingNumber(carrierName)
	now := config.NowISO()

	evidence := []types.EvidenceItem{}
	publish := false

	err = db.WithTx(ctx, func(ctx context.Context) error {
		itemsJSON, err := json.Marshal(items)
		if err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `INSERT INTO demo_orders (
			id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency, paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			orderID, orderNumber, buyerName, buyerEmail, shippingAddress, string(itemsJSON), totalCents,
			currency, paypalOrderID, carrierName, trackingNumber, "LABEL_CREATED", nil, now); err != nil {
			return err
		}

		// 1. Evidence Vault: Order confirmation captured at payment time.
		confirmation, err := marshalIndent(orderConfirmationPayload{
			OrderID:         orderID,
			OrderNumber:     orderNumber,
			BuyerName:       buyerName,
			BuyerEmail:      buyerEmail,
			ShippingAddress: shippingAddress,
			Items:           items,
			TotalCents:      totalCents,
			Currency:        currency,
			PayPalOrderID:   paypalOrderID,
			PaidAt:          now,
		})
		if err != nil {
			return err
		}
		confirmationItem, err := vault.AddToVault(ctx, vault.AddParams{
			OrderID:      &orderID,
			EvidenceType: "ORDER_CONFIRMATION",
			Source:       "STOREFRONT_CHECKOUT_GATEWAY",
			Title:        "Order Invoice #" + orderNumber,
			Content:      confirmation,
			Publish:      &publish,
		})
		if err != nil {
			return err
		}
		evidence = append(evidence, confirmationItem)

		// 2. Evidence Vault: Initial carrier label created.
		tracking, err := marshalIndent(initialTrackingPayload{
			Carrier:        carrierName,
			TrackingNumber: trackingNumber,
			Status:         "LABEL_CREATED",
			Events: []initialTrackingEvent{{
				Status:      "LABEL_CREATED",
				Location:    "Merchant Fulfillment Center",
				Description: "Shipment label created by merchant. " + carrierName + " awaiting package pickup.",
				Timestamp:   now,
			}},
			Source: "CARRIER_SIMULATOR",
		})
		if err != nil {
			return err
		}
		trackingItem, err := vault.AddToVault(ctx, vault.AddParams{
			OrderID:      &orderID,
			EvidenceType: "TRACKING_HISTORY",
			Source:       "CARRIER_SIMULATOR",
			Title:        carrierName + " Label Created — Awaiting Pickup",
			Content:      tracking,
			Publish:      &publish,
		})
		if err != nil {
			return err
		}
		evidence = append(evidence, trackingItem)

		// 3. Evidence Vault: Accepted terms & refund policy.
		policy := "Buyer " + buyerName + " (" + buyerEmail + ") acknowledged merchant return policy, 30-day inspection window, and signature requirements at time of checkout on " + now + "."
		policyItem, err := vault.AddToVault(ctx, vault.AddParams{
			OrderID:      &orderID,
			EvidenceType: "REFUND_POLICY",
			Source:       "STOREFRONT_CHECKOUT",
			Title:        "Customer Acknowledged Merchant Terms of Sale",
			Content:      policy,
			Publish:      &publish,
		})
		if err != nil {
			return err
		}
		evidence = append(evidence, policyItem)

		if _, err := store.Audit(ctx, "system", "ORDER_CAPTURED_AND_VAULTED", map[string]any{
			"order_id":        orderID,
			"order_number":    orderNumber,
			"buyer_name":      buyerName,
			"buyer_email":     buyerEmail,
			"total_cents":     totalCents,
			"tracking_number": trackingNumber,
		}, nil); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	createdOrder := map[string]any{
		"provenance":       "DEMO",
		"id":               orderID,
		"order_number":     orderNumber,
		"buyer_name":       buyerName,
		"buyer_email":      buyerEmail,
		"shipping_address": shippingAddress,
		"items":            items,
		"total_cents":      totalCents,
		"currency":         currency,
		"paypal_order_id":  paypalOrderID,
		"carrier":          carrierName,
		"tracking_number":  trackingNumber,
		"delivery_status":  "LABEL_CREATED",
		"delivered_at":     nil,
		"created_at":       now,
	}

	for _, item := range evidence {
		realtime.Default().Publish(ctx, "VAULT_ITEM_ADDED", item)
	}
	realtime.Default().Publish(ctx, "ORDER_CAPTURED", createdOrder)

	return map[string]any{"order": createdOrder, "success": true}, nil
}

// scanOrderRows drains demo_orders rows with items parsed from JSON.
func scanOrderRows(rows *sql.Rows) ([]map[string]any, error) {
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	orders := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		order := make(map[string]any, len(columns))
		for i, column := range columns {
			order[column] = values[i]
		}
		if raw, ok := order["items"].(string); ok {
			if raw == "" {
				raw = "[]"
			}
			var parsed any
			if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
				return nil, err
			}
			order["items"] = parsed
		}
		orders = append(orders, order)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return orders, nil
}

// safeQuantity mirrors Number.isSafeInteger and coerces JSON numbers to int64.
func safeQuantity(value any) (int64, bool) {
	var f float64
	switch n := value.(type) {
	case float64:
		f = n
	case int:
		f = float64(n)
	case int64:
		f = float64(n)
	case json.Number:
		parsed, err := n.Float64()
		if err != nil {
			return 0, false
		}
		f = parsed
	default:
		return 0, false
	}
	if f != math.Trunc(f) {
		return 0, false
	}
	const maxSafe = float64(1<<53 - 1)
	if f < -maxSafe || f > maxSafe {
		return 0, false
	}
	return int64(f), true
}

// marshalIndent renders JSON like JSON.stringify(value, null, 2): no HTML
// escaping, two-space indentation, no trailing newline.
func marshalIndent(v any) (string, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return "", err
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
