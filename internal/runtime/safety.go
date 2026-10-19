// Package runtime enforces environment safety guards shared by domain code.
package runtime

import (
	"context"
	"net/http"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
)

// RequireDemo rejects simulations outside the offline demo environment.
func RequireDemo(ctx context.Context) error {
	sc, err := scope.From(ctx)
	if err != nil {
		return err
	}
	if sc.Mode != config.ModeDemo {
		return httpx.Errorf(http.StatusForbidden, "This simulation is available only in demo mode.")
	}
	return nil
}

// RequireMatchingProvenance rejects records pinned to another environment.
func RequireMatchingProvenance(ctx context.Context, provenance string) error {
	sc, err := scope.From(ctx)
	if err != nil {
		return err
	}
	if provenance != string(config.ProvenanceFor(sc.Mode)) {
		return httpx.Errorf(http.StatusUnprocessableEntity, "Record provenance does not match this environment.")
	}
	return nil
}
