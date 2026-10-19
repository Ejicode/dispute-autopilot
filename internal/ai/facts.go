package ai

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// Fact is a typed, verifiable statement extracted from structured evidence.
type Fact struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

var (
	carrierSources = map[string]bool{
		"USPS": true, "UPS": true, "FEDEX": true, "DHL": true,
		"CARRIER_INTEGRATION": true, "CARRIER_SIMULATOR": true,
	}
	orderSources = map[string]bool{
		"STORE": true, "STOREFRONT_CAPTURE": true, "STOREFRONT_GATEWAY": true,
		"STOREFRONT_CHECKOUT": true, "STOREFRONT_CHECKOUT_GATEWAY": true,
		"PAYMENT_CAPTURE_WEBHOOK": true, "PAYPAL_SANDBOX_WEBHOOK": true,
	}

	controlChars    = regexp.MustCompile(`[\x00-\x1f\x7f]`)
	whitespaceRun   = regexp.MustCompile(`\s+`)
	datePattern     = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$`)
	trackingPattern = regexp.MustCompile(`^[A-Za-z0-9-]{3,100}$`)
	currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)
)

// normalizedText trims, collapses whitespace and rejects control characters.
// Returns "" for anything that cannot be trusted as a factual value.
func normalizedText(v any) string {
	s, ok := v.(string)
	if !ok {
		return ""
	}
	if strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > 500 || controlChars.MatchString(s) {
		return ""
	}
	return whitespaceRun.ReplaceAllString(strings.TrimSpace(s), " ")
}

// asDay preserves the provider's calendar day; capture time is never a
// shipping/delivery date.
func asDay(v any) string {
	s, ok := v.(string)
	if !ok || !datePattern.MatchString(s) {
		return ""
	}
	date := s[:10]
	d, err := time.Parse("2006-01-02", date)
	if err != nil || d.Format("2006-01-02") != date {
		return ""
	}
	if len(s) > 10 {
		if _, err := time.Parse(time.RFC3339Nano, s); err != nil {
			return ""
		}
	}
	return date
}

// EvidenceFacts extracts only supported structured fields. Source labels
// describe adapters, not independent proof of authenticity.
func EvidenceFacts(item types.EvidenceItem, dispute types.Dispute) ([]Fact, error) {
	if item.DisputeID.Str() != dispute.ID && (dispute.OrderID.Str() == "" || item.OrderID.Str() != dispute.OrderID.Str()) {
		return nil, errors.New("Evidence is not linked to this dispute or its order.")
	}
	if store.SHA256Hex([]byte(item.Content)) != item.SHA256Hash {
		return nil, errors.New("Evidence integrity check failed.")
	}
	var dataAny any
	if err := json.Unmarshal([]byte(item.Content), &dataAny); err != nil {
		return nil, errors.New("Structured JSON evidence is required.")
	}
	data, ok := dataAny.(map[string]any)
	if !ok {
		return nil, errors.New("Evidence must contain a JSON object.")
	}

	facts := []Fact{}
	add := func(t, v string) {
		if v != "" {
			facts = append(facts, Fact{Type: t, Value: v})
		}
	}

	switch item.EvidenceType {
	case "TRACKING_HISTORY", "PROOF_OF_DELIVERY":
		if !carrierSources[item.Source] {
			return nil, errors.New("Unsupported carrier evidence source.")
		}
		tracking := normalizedText(data["tracking_number"])
		if tracking != "" && trackingPattern.MatchString(tracking) {
			add("TRACKING_NUMBER", tracking)
		}
		events := []map[string]any{}
		if arr, ok := data["events"].([]any); ok {
			for _, e := range arr {
				if rec, ok := e.(map[string]any); ok {
					events = append(events, rec)
				}
			}
		}
		for _, event := range events {
			if event["status"] == "PICKED_UP" || event["status"] == "SHIPPED" {
				add("SHIPPING_DATE", asDay(event["timestamp"]))
			}
		}
		if item.EvidenceType == "PROOF_OF_DELIVERY" {
			if st, present := data["status"]; present && st != "DELIVERED" {
				return nil, errors.New("Proof of delivery contradicts its status.")
			}
		}
		delivered := item.EvidenceType == "PROOF_OF_DELIVERY" || data["status"] == "DELIVERED"
		if delivered {
			dates := []any{}
			if v, ok := data["delivered_at"]; ok && v != nil {
				dates = append(dates, v)
			}
			for _, event := range events {
				if event["status"] == "DELIVERED" {
					if v, ok := event["timestamp"]; ok && v != nil {
						dates = append(dates, v)
					}
				}
			}
			days := make([]string, 0, len(dates))
			seen := map[string]bool{}
			for _, d := range dates {
				day := asDay(d)
				if day == "" {
					return nil, errors.New("Conflicting or invalid delivery dates.")
				}
				days = append(days, day)
				seen[day] = true
			}
			if len(seen) > 1 {
				return nil, errors.New("Conflicting or invalid delivery dates.")
			}
			if len(days) > 0 {
				add("DELIVERY_DATE", days[0])
				add("DELIVERY_ADDRESS", normalizedText(data["delivered_address"]))
			}
		}

	case "ORDER_CONFIRMATION":
		if !orderSources[item.Source] {
			return nil, errors.New("Unsupported order evidence source.")
		}
		add("BUYER_NAME", normalizedText(data["buyer_name"]))
		totalCents, hasTotal := data["total_cents"]
		amountCents, hasAmount := data["amount_cents"]
		if hasTotal && hasAmount && !numEqual(totalCents, amountCents) {
			return nil, errors.New("Conflicting evidence amounts.")
		}
		centsAny := amountCents
		if hasTotal && totalCents != nil {
			centsAny = totalCents
		}
		if cents, ok := numAsInt(centsAny); ok && cents > 0 {
			if currency, ok := data["currency"].(string); ok && currencyPattern.MatchString(currency) {
				add("TRANSACTION_AMOUNT", fmt.Sprintf("%s %d.%02d", currency, cents/100, cents%100))
			}
		}

	default:
		return nil, errors.New("Evidence type cannot support these factual claims.")
	}

	return facts, nil
}

func numEqual(a, b any) bool {
	af, aok := numAsFloat(a)
	bf, bok := numAsFloat(b)
	if !aok || !bok {
		return false
	}
	return af == bf
}

func numAsFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

func numAsInt(v any) (int64, bool) {
	f, ok := numAsFloat(v)
	if !ok {
		return 0, false
	}
	if f != float64(int64(f)) {
		return 0, false
	}
	const maxSafe = int64(1) << 53
	if f < -float64(maxSafe) || f > float64(maxSafe) {
		return 0, false
	}
	return int64(f), true
}

var claimLabels = map[string]string{
	"TRACKING_NUMBER":    "Recorded tracking number",
	"SHIPPING_DATE":      "Recorded shipment pickup date",
	"DELIVERY_DATE":      "Recorded delivery date",
	"DELIVERY_ADDRESS":   "Recorded delivery address",
	"TRANSACTION_AMOUNT": "Recorded transaction amount",
	"BUYER_NAME":         "Recorded buyer name",
}

// RenderClaimText renders the only supported factual template for a claim.
func RenderClaimText(claimType, expectedValue string) string {
	return claimLabels[claimType] + ": " + jsonString(expectedValue) + "."
}

// RenderCitedNarrative renders a narrative derived strictly from its claims.
func RenderCitedNarrative(claims []types.Claim) string {
	if len(claims) == 0 {
		return "No supported factual claims are available for this draft."
	}
	parts := make([]string, len(claims))
	for i, c := range claims {
		parts[i] = RenderClaimText(c.ClaimType, c.ExpectedValue) + " [" + c.EvidenceID + "]"
	}
	return strings.Join(parts, "\n")
}

// jsonString mirrors JavaScript's JSON.stringify for a string value.
func jsonString(v string) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return `""`
	}
	return strings.TrimRight(buf.String(), "\n")
}

// NormalizeExpected returns the canonical form of an expected value, or "".
func NormalizeExpected(v any) string { return normalizedText(v) }
