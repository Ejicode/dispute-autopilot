// Package config resolves the application runtime mode and provenance.
//
// Missing configuration is always the offline demo, never an implicit provider
// connection (mirrors src/lib/runtime/mode.ts).
package config

import (
	"fmt"
	"os"
	"time"
)

// Mode is the application environment classification.
type Mode string

const (
	ModeDemo    Mode = "demo"
	ModeSandbox Mode = "sandbox"
	ModeLive    Mode = "live"
)

// Provenance classifies where a persisted record originated.
type Provenance string

const (
	ProvenanceDemo          Provenance = "DEMO"
	ProvenancePayPalSandbox Provenance = "PAYPAL_SANDBOX"
	ProvenancePayPalLive    Provenance = "PAYPAL_LIVE"
	ProvenanceUnknown       Provenance = "UNKNOWN"
)

// ApplicationMode returns the configured mode, defaulting to demo.
func ApplicationMode() (Mode, error) {
	mode := os.Getenv("APP_MODE")
	if mode == "" {
		mode = string(ModeDemo)
	}
	switch Mode(mode) {
	case ModeDemo, ModeSandbox, ModeLive:
		return Mode(mode), nil
	default:
		return "", fmt.Errorf("APP_MODE must be demo, sandbox, or live")
	}
}

// MustApplicationMode is ApplicationMode for startup paths that cannot continue.
func MustApplicationMode() Mode {
	mode, err := ApplicationMode()
	if err != nil {
		panic(err)
	}
	return mode
}

// ProvenanceFor maps a mode onto the provenance recorded on new rows.
func ProvenanceFor(mode Mode) Provenance {
	switch mode {
	case ModeDemo:
		return ProvenanceDemo
	case ModeSandbox:
		return ProvenancePayPalSandbox
	default:
		return ProvenancePayPalLive
	}
}

// Production reports whether the process is a production deployment.
func Production() bool {
	return os.Getenv("NODE_ENV") == "production" || os.Getenv("APP_ENV") == "production"
}

// Origin is the configured public origin (APP_ORIGIN).
func Origin() string {
	return os.Getenv("APP_ORIGIN")
}

// NowISO renders the current UTC instant with millisecond precision, matching
// JavaScript's Date.prototype.toISOString().
func NowISO() string {
	return FormatISO(time.Now())
}

// NowMillis returns the current Unix time in milliseconds, matching Date.now().
func NowMillis() int64 { return time.Now().UnixMilli() }

// FormatISO renders a time in JavaScript ISO-8601 with milliseconds.
func FormatISO(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
