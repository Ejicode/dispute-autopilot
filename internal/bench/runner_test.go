package bench

import (
	"context"
	"math"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

func testCtx(t *testing.T) context.Context {
	t.Helper()
	t.Setenv("DATA_DIR", t.TempDir())
	ctx, err := scope.With(context.Background(), "demo", config.ModeDemo, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	return ctx
}

func TestRunProducesFortyScenarioSummary(t *testing.T) {
	ctx := testCtx(t)
	summary, err := Run(ctx)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	if got := summary["totalScenarios"]; got != 40 {
		t.Errorf("totalScenarios = %v, want 40", got)
	}
	if _, present := summary["liveCount"]; present {
		t.Error("summary must not claim live PayPal scenarios; the bench never calls PayPal")
	}
	if got := summary["unsafeActionsExecuted"]; got != 0 {
		t.Errorf("unsafeActionsExecuted = %v, want 0", got)
	}
	if got := summary["manualBaselineSec"]; got != int64(360) {
		t.Errorf("manualBaselineSec = %v, want 360", got)
	}
	median, _ := summary["medianProcessingTimeUs"].(int64)
	if want := int64(math.Round(360_000_000 / float64(max(median, 1)))); summary["speedupFactor"] != want {
		t.Errorf("speedupFactor = %v, want %d from the measured median of %dµs", summary["speedupFactor"], want, median)
	}
	results, ok := summary["results"].([]map[string]any)
	if !ok {
		t.Fatalf("results has unexpected type %T", summary["results"])
	}
	if len(results) != 40 {
		t.Fatalf("expected 40 results, got %d", len(results))
	}

	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM bench_runs").Scan(&count); err != nil {
		t.Fatalf("count bench_runs: %v", err)
	}
	if count != 40 {
		t.Fatalf("expected 40 persisted bench_runs, got %d", count)
	}

	// Every synthesized evidence hash must cover its content, and every scenario
	// must pass verification with no unsafe actions.
	for _, r := range results {
		if r["claimsVerified"] != true {
			t.Errorf("scenario %v did not verify", r["scenarioId"])
		}
		if r["unsafeActions"] != 0 {
			t.Errorf("scenario %v executed unsafe actions", r["scenarioId"])
		}
	}
}

// TestScenarioParity locks in the deterministic draft output of the ported
// pipeline. Expected values were derived from the TypeScript fixtures: scenario
// IDs contain an underscore, so their synthesized `TRK-...` numbers are
// intentionally rejected by the tracking-number charset and never become claims.
func TestScenarioParity(t *testing.T) {
	cases := []struct {
		id     string
		claims []string
	}{
		{
			id: "SCENARIO_01",
			claims: []string{
				"BUYER_NAME=Alex Johnson",
				"TRANSACTION_AMOUNT=USD 60.00",
				"DELIVERY_DATE=2026-10-04",
				"DELIVERY_DATE=2026-10-04",
			},
		},
		{
			id: "SCENARIO_11",
			claims: []string{
				"BUYER_NAME=Alex Johnson",
				"TRANSACTION_AMOUNT=USD 100.00",
				"DELIVERY_DATE=2026-10-04",
				"DELIVERY_DATE=2026-10-04",
			},
		},
		{
			id: "SCENARIO_31",
			claims: []string{
				"BUYER_NAME=Alex Johnson",
				"TRANSACTION_AMOUNT=USD 89.00",
			},
		},
		{
			id: "SCENARIO_34",
			claims: []string{
				"BUYER_NAME=Alex Johnson",
				"TRANSACTION_AMOUNT=USD 49.99",
				"DELIVERY_DATE=2026-10-04",
				"DELIVERY_DATE=2026-10-04",
			},
		},
	}

	byID := map[string]scenario{}
	for _, sc := range benchScenarios {
		byID[sc.id] = sc
	}

	for _, tc := range cases {
		sc, ok := byID[tc.id]
		if !ok {
			t.Fatalf("scenario %s not found", tc.id)
		}
		dispute, evidence := synthesizeEvidence(sc)
		draft := ai.GenerateDeterministicDraft(dispute, evidence, sc.buyerMessage)

		got := make([]string, 0, len(draft.Claims))
		for _, claim := range draft.Claims {
			got = append(got, claim.ClaimType+"="+claim.ExpectedValue)
		}
		if len(got) != len(tc.claims) {
			t.Errorf("%s: got %d claims %v, want %d %v", tc.id, len(got), got, len(tc.claims), tc.claims)
			continue
		}
		for i := range got {
			if got[i] != tc.claims[i] {
				t.Errorf("%s: claim %d = %q, want %q", tc.id, i, got[i], tc.claims[i])
			}
		}
	}
}

// TestScenarioRecommendations locks the triage port against the recorded
// TypeScript benchmark output for representative scenarios. The fixtures'
// `expected_recommendation` field is design intent, not the triage result, so
// these expectations come from the committed bench artifact.
func TestScenarioRecommendations(t *testing.T) {
	cases := map[string]struct {
		recommendation string
		score          int
	}{
		"SCENARIO_01": {"FIGHT", 85},
		"SCENARIO_12": {"FIGHT", 80},
		"SCENARIO_21": {"ASK A HUMAN", 55},
		"SCENARIO_30": {"ACCEPT", 10},
		"SCENARIO_31": {"ASK A HUMAN", 60},
		"SCENARIO_32": {"FIGHT", 85},
		"SCENARIO_33": {"ASK A HUMAN", 50},
		"SCENARIO_34": {"ASK A HUMAN", 50},
	}

	byID := map[string]scenario{}
	for _, sc := range benchScenarios {
		byID[sc.id] = sc
	}

	for id, want := range cases {
		sc, ok := byID[id]
		if !ok {
			t.Fatalf("scenario %s not found", id)
		}
		dispute, evidence := synthesizeEvidence(sc)
		triage := ai.CalculateEvidenceStrength(dispute.Reason, evidence)
		if triage.Recommendation != want.recommendation || triage.Score != want.score {
			t.Errorf("%s: got %q/%d, want %q/%d",
				id, triage.Recommendation, triage.Score, want.recommendation, want.score)
		}
	}
}
