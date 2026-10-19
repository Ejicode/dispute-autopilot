// Package paypal integrates with PayPal: webhook validation, the durable
// receipt inbox, and the audited REST client.
package paypal

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/types"
)

func sha256Hex(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

// InvalidEvent marks an event that can never succeed and must not be retried.
type InvalidEvent struct{ Message string }

func (e *InvalidEvent) Error() string { return e.Message }

// MissingDependency marks an event that is valid but arrived out of order.
type MissingDependency struct{ Message string }

func (e *MissingDependency) Error() string { return e.Message }

func invalid(msg string) error    { return &InvalidEvent{Message: msg} }
func missingDep(msg string) error { return &MissingDependency{Message: msg} }

var (
	identifierPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,255}$`)
	eventTypePattern  = regexp.MustCompile(`^[A-Z0-9_.-]{1,150}$`)
	codePattern       = regexp.MustCompile(`^[A-Z_]{1,100}$`)
	timestampPattern  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$`)
	moneyValuePattern = regexp.MustCompile(`^\d+(?:\.\d{1,2})?$`)
	currencyPattern   = regexp.MustCompile(`^[A-Z]{3}$`)
)

// Object reports whether v is a JSON object (and not an array or null). A typed
// nil map counts as null, matching JavaScript's `!!v && typeof v === 'object'`.
func Object(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok && m != nil
}

// Identifier validates a provider identifier.
func Identifier(v any, label string) (string, error) {
	s, ok := v.(string)
	if !ok || !identifierPattern.MatchString(s) {
		return "", invalid("Invalid " + label + ".")
	}
	return s, nil
}

// Timestamp validates a provider timestamp and returns Unix milliseconds.
func Timestamp(v any) (int64, error) {
	s, ok := v.(string)
	if !ok || !timestampPattern.MatchString(s) {
		return 0, invalid("A valid provider timestamp is required.")
	}
	t, err := parseTimestamp(s)
	if err != nil {
		return 0, invalid("A valid provider timestamp is required.")
	}
	return t, nil
}

func parseTimestamp(s string) (int64, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05Z0700", "2006-01-02T15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UnixMilli(), nil
		}
	}
	return 0, fmt.Errorf("unparseable timestamp")
}

// ValidateEnvelope validates the structural shape of a provider webhook.
func ValidateEnvelope(value any) (types.PayPalWebhookEvent, error) {
	obj, ok := Object(value)
	if !ok {
		return types.PayPalWebhookEvent{}, invalid("Webhook must be an object.")
	}
	id, err := Identifier(obj["id"], "event ID")
	if err != nil {
		return types.PayPalWebhookEvent{}, err
	}
	eventType, ok := obj["event_type"].(string)
	if !ok || !eventTypePattern.MatchString(eventType) {
		return types.PayPalWebhookEvent{}, invalid("Invalid event type.")
	}
	resourceType, ok := obj["resource_type"].(string)
	if !ok || resourceType == "" || len([]rune(resourceType)) > 100 {
		return types.PayPalWebhookEvent{}, invalid("Invalid resource type.")
	}
	if _, err := Timestamp(obj["create_time"]); err != nil {
		return types.PayPalWebhookEvent{}, err
	}
	resource, ok := Object(obj["resource"])
	if !ok {
		return types.PayPalWebhookEvent{}, invalid("Webhook resource must be an object.")
	}

	event := types.PayPalWebhookEvent{
		ID:           id,
		EventType:    eventType,
		ResourceType: resourceType,
		Resource:     resource,
	}
	if v, ok := obj["event_version"].(string); ok {
		event.EventVersion = v
	}
	if v, ok := obj["create_time"].(string); ok {
		event.CreateTime = v
	}
	if v, ok := obj["summary"].(string); ok {
		event.Summary = v
	}
	if links, ok := obj["links"].([]any); ok {
		event.Links = links
	}
	return event, nil
}

// CanonicalJSON serializes a value with sorted object keys so redeliveries with
// reordered keys hash identically while changed content does not.
func CanonicalJSON(value any) string {
	switch v := value.(type) {
	case nil:
		return "null"
	case bool:
		if v {
			return "true"
		}
		return "false"
	case string:
		return jsonStringNoEscape(v)
	case float64:
		if v == math.Trunc(v) && math.Abs(v) < 1e15 {
			return strconv.FormatInt(int64(v), 10)
		}
		b, _ := json.Marshal(v)
		return string(b)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case json.Number:
		return v.String()
	case []any:
		parts := make([]string, len(v))
		for i, item := range v {
			parts[i] = CanonicalJSON(item)
		}
		return "[" + strings.Join(parts, ",") + "]"
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, jsonStringNoEscape(k)+":"+CanonicalJSON(v[k]))
		}
		return "{" + strings.Join(parts, ",") + "}"
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

// PayloadHash returns the SHA-256 of the canonical JSON encoding.
func PayloadHash(value any) string {
	return sha256Hex([]byte(CanonicalJSON(value)))
}

// Money validates a provider amount and returns cents plus the currency code.
func Money(value any) (int64, string, error) {
	obj, ok := Object(value)
	if !ok {
		return 0, "", invalid("Invalid provider amount.")
	}
	raw, ok := obj["value"].(string)
	if !ok || !moneyValuePattern.MatchString(raw) {
		return 0, "", invalid("Invalid provider amount.")
	}
	currency, ok := obj["currency_code"].(string)
	if !ok || !currencyPattern.MatchString(currency) {
		return 0, "", invalid("Invalid provider amount.")
	}
	whole, fraction, _ := strings.Cut(raw, ".")
	for len(fraction) < 2 {
		fraction += "0"
	}
	wholeCents, err1 := strconv.ParseInt(whole, 10, 64)
	fractionCents, err2 := strconv.ParseInt(fraction, 10, 64)
	if err1 != nil || err2 != nil {
		return 0, "", invalid("Invalid provider amount.")
	}
	amount := wholeCents*100 + fractionCents
	if amount <= 0 {
		return 0, "", invalid("Invalid provider amount.")
	}
	return amount, currency, nil
}

func jsonStringNoEscape(s string) string {
	var buf strings.Builder
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(s); err != nil {
		return `""`
	}
	return strings.TrimRight(buf.String(), "\n")
}
