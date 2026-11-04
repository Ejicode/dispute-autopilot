package httpapi

import (
	"net/http/httptest"
	"testing"
)

func TestSetCacheHeaders(t *testing.T) {
	tests := []struct {
		rel      string
		expected string
	}{
		{"_next/static/chunks/app/storefront.js", "public, max-age=31536000, immutable"},
		{"/_next/static/css/style.css", "public, max-age=31536000, immutable"},
		{"logo.png", "public, max-age=86400, stale-while-revalidate=604800"},
		{"index.html", "public, max-age=0, must-revalidate"},
		{"storefront/index.html", "public, max-age=0, must-revalidate"},
		{"data.json", "public, max-age=3600"},
	}

	for _, tt := range tests {
		rec := httptest.NewRecorder()
		setCacheHeaders(rec, tt.rel)
		got := rec.Header().Get("Cache-Control")
		if got != tt.expected {
			t.Errorf("setCacheHeaders(%q) = %q; want %q", tt.rel, got, tt.expected)
		}
	}
}
