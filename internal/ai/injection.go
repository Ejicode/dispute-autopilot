package ai

import (
	"regexp"
	"strings"
)

// SanitizedInput is the result of neutralizing untrusted buyer text.
type SanitizedInput struct {
	IsSafe        bool     `json:"isSafe"`
	SanitizedText string   `json:"sanitizedText"`
	DetectedFlags []string `json:"detectedFlags"`
}

var injectionPatterns = []struct {
	re  *regexp.Regexp
	src string
}{
	{regexp.MustCompile(`(?i)ignore\s+(all\s+)?(previous|prior|above)\s+instructions`), `ignore\s+(all\s+)?(previous|prior|above)\s+instructions`},
	{regexp.MustCompile(`(?i)system\s+override`), `system\s+override`},
	{regexp.MustCompile(`(?i)you\s+are\s+now\s+(in\s+)?(developer|maintenance|god)\s+mode`), `you\s+are\s+now\s+(in\s+)?(developer|maintenance|god)\s+mode`},
	{regexp.MustCompile(`(?i)refund\s+(all|immediately|everything|\$\d+)`), `refund\s+(all|immediately|everything|\$\d+)`},
	{regexp.MustCompile(`(?i)call\s+tool\s+\w+`), `call\s+tool\s+\w+`},
	{regexp.MustCompile(`(?i)disregard\s+the\s+evidence`), `disregard\s+the\s+evidence`},
	{regexp.MustCompile(`(?i)grant\s+the\s+claim`), `grant\s+the\s+claim`},
	{regexp.MustCompile(`(?i)<script>`), `<script>`},
	{regexp.MustCompile(`(?i)DROP\s+TABLE`), `DROP\s+TABLE`},
}

// SanitizeUntrustedBuyerText flags prompt-injection attempts and neutralizes
// markup. Untrusted text stays data — it is never promoted to instructions.
func SanitizeUntrustedBuyerText(rawInput string) SanitizedInput {
	flags := []string{}
	for _, p := range injectionPatterns {
		if p.re.MatchString(rawInput) {
			flags = append(flags, "Matched suspicious pattern: "+p.src)
		}
	}

	sanitized := strings.NewReplacer(
		"<", "&lt;",
		">", "&gt;",
		"`", "",
		"$", "",
		"{", "",
		"}", "",
	).Replace(rawInput)

	return SanitizedInput{
		IsSafe:        len(flags) == 0,
		SanitizedText: sanitized,
		DetectedFlags: flags,
	}
}

// WrapUntrustedData fences untrusted data for inclusion in a model context.
func WrapUntrustedData(label, text string) string {
	sanitized := SanitizeUntrustedBuyerText(text).SanitizedText
	return "\n<<<DATA_BLOCK_UNTRUSTED label=\"" + label + "\">>>\n" + sanitized + "\n<<</DATA_BLOCK_UNTRUSTED>>>\n"
}
