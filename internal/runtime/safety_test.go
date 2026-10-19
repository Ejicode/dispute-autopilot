package runtime

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
)

func modeContext(t *testing.T, mode config.Mode) context.Context {
	t.Helper()
	ctx, err := scope.With(context.Background(), "demo", mode, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	return ctx
}

func statusOf(t *testing.T, err error) int {
	t.Helper()
	var he *httpx.HTTPError
	if !errors.As(err, &he) {
		t.Fatalf("expected *httpx.HTTPError, got %T (%v)", err, err)
	}
	return he.Status
}

// TestRequireDemo ports the environment-safety guards that block simulations
// outside the offline demo mode.
func TestRequireDemo(t *testing.T) {
	if err := RequireDemo(modeContext(t, config.ModeDemo)); err != nil {
		t.Fatalf("demo should allow simulations: %v", err)
	}
	for _, mode := range []config.Mode{config.ModeSandbox, config.ModeLive} {
		err := RequireDemo(modeContext(t, mode))
		if err == nil {
			t.Fatalf("%s should reject simulations", mode)
		}
		if status := statusOf(t, err); status != http.StatusForbidden {
			t.Fatalf("%s simulation guard status = %d, want 403", mode, status)
		}
	}
}

func TestRequireDemoWithoutScopeFailsClosed(t *testing.T) {
	if err := RequireDemo(context.Background()); err == nil {
		t.Fatalf("RequireDemo without a scope should fail closed")
	}
}

// TestRequireMatchingProvenance ports "Record provenance does not match this
// environment": records stamped for another environment must be rejected with
// 422 before any provider interaction.
func TestRequireMatchingProvenance(t *testing.T) {
	cases := []struct {
		mode       config.Mode
		provenance config.Provenance
		ok         bool
	}{
		{config.ModeDemo, config.ProvenanceDemo, true},
		{config.ModeDemo, config.ProvenancePayPalSandbox, false},
		{config.ModeDemo, config.ProvenancePayPalLive, false},
		{config.ModeDemo, config.ProvenanceUnknown, false},
		{config.ModeSandbox, config.ProvenancePayPalSandbox, true},
		{config.ModeSandbox, config.ProvenanceDemo, false},
		{config.ModeSandbox, config.ProvenanceUnknown, false},
		{config.ModeLive, config.ProvenancePayPalLive, true},
		{config.ModeLive, config.ProvenancePayPalSandbox, false},
		{config.ModeLive, config.ProvenanceUnknown, false},
	}
	for _, tc := range cases {
		ctx := modeContext(t, tc.mode)
		err := RequireMatchingProvenance(ctx, string(tc.provenance))
		if tc.ok {
			if err != nil {
				t.Errorf("%s/%s should be accepted: %v", tc.mode, tc.provenance, err)
			}
			continue
		}
		if err == nil {
			t.Errorf("%s/%s should be rejected", tc.mode, tc.provenance)
			continue
		}
		if status := statusOf(t, err); status != http.StatusUnprocessableEntity {
			t.Errorf("%s/%s status = %d, want 422", tc.mode, tc.provenance, status)
		}
	}
}

func TestRequireMatchingProvenanceWithoutScopeFailsClosed(t *testing.T) {
	if err := RequireMatchingProvenance(context.Background(), string(config.ProvenanceDemo)); err == nil {
		t.Fatalf("RequireMatchingProvenance without a scope should fail closed")
	}
}
