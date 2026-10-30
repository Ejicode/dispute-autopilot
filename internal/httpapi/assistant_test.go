package httpapi

import (
	"context"
	"strings"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/demo"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

func assistantStore(t *testing.T) (context.Context, *store.Store) {
	t.Helper()
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("APP_MODE", "demo")
	store.Close()
	t.Cleanup(store.Close)
	ctx, err := scope.With(context.Background(), "usr_demo_assistant", config.ModeDemo, nil)
	if err != nil {
		t.Fatalf("scope: %v", err)
	}
	if err := demo.SeedWorkspace(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}
	return ctx, db
}

func count(t *testing.T, ctx context.Context, db *store.Store, query string) int {
	t.Helper()
	var n int
	if err := db.QueryRow(ctx, query).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func TestAssistantActionsNeedExplicitPhrasesAndRunNothing(t *testing.T) {
	ctx, db := assistantStore(t)
	disputes := count(t, ctx, db, "SELECT COUNT(*) FROM disputes")

	for _, message := range []string{"Is my store under attack?", "Which disputes were seeded with tracking?"} {
		if action, _, _ := detectAndExecuteAction(ctx, db, nil, message); action == "RUN_ATTACKS" || action == "SEED_DEMO" {
			t.Errorf("%q triggered %s", message, action)
		}
	}
	if action, _, _ := detectAndExecuteAction(ctx, db, nil, "run trust lab"); action != "RUN_ATTACKS" {
		t.Errorf("run trust lab -> %q, want RUN_ATTACKS", action)
	}
	if action, _, _ := detectAndExecuteAction(ctx, db, nil, "reset demo"); action != "SEED_DEMO" {
		t.Errorf("reset demo -> %q, want SEED_DEMO", action)
	}
	if got := count(t, ctx, db, "SELECT COUNT(*) FROM attack_runs"); got != 0 {
		t.Errorf("the assistant ran the attack suite itself (%d runs); the client must run it", got)
	}
	if got := count(t, ctx, db, "SELECT COUNT(*) FROM disputes"); got != disputes {
		t.Errorf("the assistant reseeded the workspace itself: %d disputes, want %d", got, disputes)
	}
}

func TestAssistantReportsStoredVerifierResult(t *testing.T) {
	ctx, db := assistantStore(t)
	var id string
	if err := db.QueryRow(ctx, "SELECT dispute_id FROM ai_drafts ORDER BY rowid LIMIT 1").Scan(&id); err != nil {
		t.Fatalf("find drafted dispute: %v", err)
	}
	if _, err := db.Exec(ctx, "UPDATE ai_drafts SET verified = 0 WHERE dispute_id = ?", id); err != nil {
		t.Fatalf("mark draft unverified: %v", err)
	}
	if got := draftStatus(ctx, db, id); !strings.Contains(got, "did not pass") {
		t.Errorf("unverified draft reported as %q", got)
	}
	if got := draftStatus(ctx, db, "dsp_missing"); !strings.Contains(got, "no rebuttal draft") {
		t.Errorf("missing draft reported as %q", got)
	}
}
