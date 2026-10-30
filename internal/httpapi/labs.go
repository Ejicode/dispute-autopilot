package httpapi

import (
	"net/http"

	"github.com/Ejicode/dispute-autopilot/internal/bench"
	"github.com/Ejicode/dispute-autopilot/internal/demo"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/trustlab"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

func (a *API) trustLabList(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	runs, err := queryMaps(r.Context(), db, "SELECT * FROM attack_runs ORDER BY run_date DESC LIMIT 30")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"runs": runs})
	return nil
}

func (a *API) trustLabRun(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	if err := runtime.RequireDemo(r.Context()); err != nil {
		return err
	}
	results, err := trustlab.RunAll(r.Context())
	if err != nil {
		return &rawResponse{status: http.StatusInternalServerError, body: map[string]any{"error": err.Error()}}
	}
	allBlocked := true
	for _, result := range results {
		if !result.Blocked {
			allBlocked = false
			break
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"results": results, "allBlocked": allBlocked})
	return nil
}

func (a *API) benchList(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	db, err := store.Merchant(r.Context())
	if err != nil {
		return err
	}
	runs, err := queryMaps(r.Context(), db, "SELECT * FROM bench_runs ORDER BY created_at DESC LIMIT 50")
	if err != nil {
		return err
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"runs": runs})
	return nil
}

func (a *API) benchRun(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	if err := runtime.RequireDemo(r.Context()); err != nil {
		return err
	}
	summary, err := bench.Run(r.Context())
	if err != nil {
		return &rawResponse{status: http.StatusInternalServerError, body: map[string]any{"error": err.Error()}}
	}
	httpx.JSON(w, http.StatusOK, summary)
	return nil
}

func (a *API) demoSeed(w http.ResponseWriter, r *http.Request, _ *types.UserAccount) error {
	if err := runtime.RequireDemo(r.Context()); err != nil {
		return err
	}
	if err := demo.SeedWorkspace(r.Context()); err != nil {
		return &rawResponse{status: http.StatusInternalServerError, body: map[string]any{"error": err.Error()}}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"success": true, "message": "Demo workspace seeded with realistic disputes."})
	return nil
}
