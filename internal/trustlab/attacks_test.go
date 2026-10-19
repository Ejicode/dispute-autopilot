package trustlab

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

func testCtx(t *testing.T) context.Context {
	t.Helper()
	t.Setenv("APP_MODE", "demo")
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("PAYPAL_CLIENT_ID", "")
	t.Setenv("PAYPAL_CLIENT_SECRET", "")
	store.Close()
	t.Cleanup(store.Close)
	ctx, err := scope.With(context.Background(), "demo", config.ModeDemo, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	return ctx
}

// TestRunAllBlocksEveryAttackAndPersists ports scripts/test-attacks.ts: all six
// adversarial simulations must end BLOCKED, each with a cryptographic audit
// record and a persisted attack_runs row.
func TestRunAllBlocksEveryAttackAndPersists(t *testing.T) {
	ctx := testCtx(t)
	results, err := RunAll(ctx)
	if err != nil {
		t.Fatalf("RunAll: %v", err)
	}
	if len(results) != 6 {
		t.Fatalf("expected 6 attacks, got %d", len(results))
	}

	wantActions := map[string]string{
		"att_1": "ATTACK_1_FORGED_WEBHOOK_BLOCKED",
		"att_2": "ATTACK_2_REPLAY_BLOCKED",
		"att_3": "ATTACK_3_PROMPT_INJECTION_DEFENSE_TRIGGERED",
		"att_4": "ATTACK_4_TAMPERED_AMOUNT_BLOCKED",
		"att_5": "ATTACK_5_EXPIRED_DISPUTE_BLOCKED",
		"att_6": "ATTACK_6_DOUBLE_SUBMIT_BLOCKED",
	}
	wantIDs := []string{"att_1", "att_2", "att_3", "att_4", "att_5", "att_6"}

	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}

	for i, r := range results {
		if r.ID != wantIDs[i] {
			t.Errorf("result %d id = %q, want %q", i, r.ID, wantIDs[i])
		}
		if !r.Blocked {
			t.Errorf("attack %s (%s) was not blocked (http %d): %s", r.ID, r.Name, r.HTTPStatus, r.Reason)
		}
		if r.AuditRef == "" {
			t.Errorf("attack %s missing audit_ref", r.ID)
			continue
		}
		if r.RunDate == "" {
			t.Errorf("attack %s missing run_date", r.ID)
		}

		// The audit record must exist with the expected action and a
		// `blocked: true` detail for the attack.
		var action, detail string
		err := db.QueryRow(ctx, "SELECT action, detail FROM audit_log WHERE id=?", r.AuditRef).Scan(&action, &detail)
		if errors.Is(err, sql.ErrNoRows) {
			t.Errorf("attack %s has no audit record %s", r.ID, r.AuditRef)
			continue
		}
		if err != nil {
			t.Fatalf("query audit_log %s: %v", r.AuditRef, err)
		}
		if action != wantActions[r.ID] {
			t.Errorf("attack %s audit action = %q, want %q", r.ID, action, wantActions[r.ID])
		}
		if !strings.Contains(detail, `"blocked":true`) {
			t.Errorf("attack %s audit detail = %s, want blocked true", r.ID, detail)
		}
	}

	// Every attack must be persisted exactly once to attack_runs.
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM attack_runs").Scan(&count); err != nil {
		t.Fatalf("count attack_runs: %v", err)
	}
	if count != 6 {
		t.Fatalf("expected 6 persisted attack_runs, got %d", count)
	}
	var unblocked int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM attack_runs WHERE blocked=0").Scan(&unblocked); err != nil {
		t.Fatalf("count unblocked attack_runs: %v", err)
	}
	if unblocked != 0 {
		t.Fatalf("expected every persisted attack_runs row blocked, got %d unblocked", unblocked)
	}
}

func TestRunAllRequiresDemo(t *testing.T) {
	t.Setenv("DATA_DIR", t.TempDir())
	ctx, err := scope.With(context.Background(), "demo", config.ModeSandbox, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	if _, err := RunAll(ctx); err == nil {
		t.Fatal("expected RunAll to reject non-demo mode")
	}
}
