// Command bench runs the 40-scenario Dispute Bench and writes the committed
// results artifact consumed by the dashboard and the submission write-up.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/Ejicode/dispute-autopilot/internal/bench"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
)

func main() {
	config.LoadEnvFiles()
	mode := config.MustApplicationMode()
	ctx, err := scope.With(context.Background(), "demo", mode, nil)
	if err != nil {
		log.Fatalf("bench: %v", err)
	}

	fmt.Println()
	fmt.Println("===============================================================")
	fmt.Println("  DISPUTE AUTOPILOT | 40-SCENARIO DISPUTE BENCHMARK RUNNER")
	fmt.Println("  PayPal AI Hackathon 2026 - Independent Evaluation")
	fmt.Println("===============================================================")
	fmt.Println()
	fmt.Println("Running 40 scripted dispute scenarios...")
	fmt.Println()

	summary, err := bench.Run(ctx)
	if err != nil {
		log.Fatalf("Benchmark failed: %v", err)
	}

	fmt.Println("---------------------------------------------------------------------------------------------------------------------")
	fmt.Println("| ID          | Category / Scenario Name                      | Mode    | Score | Triage      | Verified | Time (ms) | Unsafe |")
	fmt.Println("---------------------------------------------------------------------------------------------------------------------")

	for _, row := range results(summary) {
		id := padEnd(str(row["scenarioId"]), 11)
		name := str(row["name"])
		if len(name) > 44 {
			name = name[:41] + "..."
		} else {
			name = padEnd(name, 45)
		}
		modeLabel := "STUB"
		if boolValue(row["isLive"]) {
			modeLabel = "LIVE"
		}
		modeLabel = padEnd(modeLabel, 7)
		score := padStart(strconv.FormatInt(num(row["strengthScore"]), 10), 3) + "/100"
		triage := padEnd(str(row["recommendation"]), 11)
		verified := "FAIL"
		if boolValue(row["claimsVerified"]) {
			verified = "PASS"
		}
		verified = padEnd(verified, 8)
		elapsed := padStart(strconv.FormatInt(num(row["timeMs"]), 10)+"ms", 9)
		unsafe := padStart(strconv.FormatInt(num(row["unsafeActions"]), 10), 6)

		fmt.Printf("| %s | %s | %s | %s | %s | %s | %s | %s |\n", id, name, modeLabel, score, triage, verified, elapsed, unsafe)
	}
	fmt.Println("---------------------------------------------------------------------------------------------------------------------")
	fmt.Println()

	fmt.Println("BENCHMARK SUMMARY METRICS:")
	fmt.Printf("  Total Scenarios Tested:    %d (10 Live Sandbox, 30 Stubbed Pipeline)\n", num(summary["totalScenarios"]))
	fmt.Printf("  Evidence Complete Rate:    %d%%\n", num(summary["evidenceCompleteRate"]))
	fmt.Printf("  Claims Verified Rate:      %d%%\n", num(summary["claimsVerifiedRate"]))
	fmt.Printf("  Unsafe Actions Executed:   %d (STRICT ZERO TOLERANCE)\n", num(summary["unsafeActionsExecuted"]))
	fmt.Printf("  Median Processing Time:    %d ms\n", num(summary["medianProcessingTimeMs"]))
	fmt.Printf("  Hand-Timed Baseline:       %d seconds (6.0 minutes)\n", num(summary["handTimedBaselineSec"]))
	fmt.Printf("  Automation Speedup Factor: ~%dx faster than manual handling\n", num(summary["speedupFactor"]))
	fmt.Println()

	model := os.Getenv("AI_MODEL_NAME")
	if model == "" {
		model = "DisputeAutopilot-Deterministic-v1"
	}
	artifact := benchArtifact{
		BenchmarkName: "Dispute Autopilot 40-Scenario Benchmark",
		Date:          config.NowISO(),
		ModelName:     model,
		DatasetLabel:  "DEMO DATA & SYNTHETIC BENCHMARK FIXTURES",
		Metrics: benchMetrics{
			TotalScenarios:         num(summary["totalScenarios"]),
			LiveScenarios:          num(summary["liveCount"]),
			StubbedScenarios:       num(summary["stubbedCount"]),
			EvidenceCompleteRate:   num(summary["evidenceCompleteRate"]),
			ClaimsVerifiedRate:     num(summary["claimsVerifiedRate"]),
			UnsafeActionsExecuted:  num(summary["unsafeActionsExecuted"]),
			MedianProcessingTimeMs: num(summary["medianProcessingTimeMs"]),
			HandTimedBaselineSec:   num(summary["handTimedBaselineSec"]),
			SpeedupFactor:          num(summary["speedupFactor"]),
		},
		Scenarios: scenarios(summary),
	}

	outputPath := "bench_results.json"
	if err := os.WriteFile(outputPath, mustPrettyJSON(artifact), 0o644); err != nil {
		log.Fatalf("Benchmark failed: %v", err)
	}
	fmt.Printf("✓ Benchmark results saved to: %s\n", absolutePath(outputPath))
	fmt.Println()
}

type benchArtifact struct {
	BenchmarkName string          `json:"benchmark_name"`
	Date          string          `json:"date"`
	ModelName     string          `json:"model_name"`
	DatasetLabel  string          `json:"dataset_label"`
	Metrics       benchMetrics    `json:"metrics"`
	Scenarios     []benchScenario `json:"scenarios"`
}

// benchScenario mirrors the per-scenario artifact record in a stable field
// order, matching the results published by the original TypeScript runner.
type benchScenario struct {
	ScenarioID     string `json:"scenarioId"`
	Name           string `json:"name"`
	Reason         string `json:"reason"`
	IsLive         bool   `json:"isLive"`
	StrengthScore  int64  `json:"strengthScore"`
	Recommendation string `json:"recommendation"`
	ClaimsCount    int64  `json:"claimsCount"`
	ClaimsVerified bool   `json:"claimsVerified"`
	TimeMs         int64  `json:"timeMs"`
	UnsafeActions  int64  `json:"unsafeActions"`
}

type benchMetrics struct {
	TotalScenarios         int64 `json:"total_scenarios"`
	LiveScenarios          int64 `json:"live_scenarios"`
	StubbedScenarios       int64 `json:"stubbed_scenarios"`
	EvidenceCompleteRate   int64 `json:"evidence_complete_rate_pct"`
	ClaimsVerifiedRate     int64 `json:"claims_verified_rate_pct"`
	UnsafeActionsExecuted  int64 `json:"unsafe_actions_executed"`
	MedianProcessingTimeMs int64 `json:"median_processing_time_ms"`
	HandTimedBaselineSec   int64 `json:"hand_timed_baseline_sec"`
	SpeedupFactor          int64 `json:"speedup_factor"`
}

func results(summary map[string]any) []map[string]any {
	if rows, ok := summary["results"].([]map[string]any); ok {
		return rows
	}
	return nil
}

// scenarios converts the raw runner rows into artifact records.
func scenarios(summary map[string]any) []benchScenario {
	rows := results(summary)
	out := make([]benchScenario, 0, len(rows))
	for _, row := range rows {
		out = append(out, benchScenario{
			ScenarioID:     str(row["scenarioId"]),
			Name:           str(row["name"]),
			Reason:         str(row["reason"]),
			IsLive:         boolValue(row["isLive"]),
			StrengthScore:  num(row["strengthScore"]),
			Recommendation: str(row["recommendation"]),
			ClaimsCount:    num(row["claimsCount"]),
			ClaimsVerified: boolValue(row["claimsVerified"]),
			TimeMs:         num(row["timeMs"]),
			UnsafeActions:  num(row["unsafeActions"]),
		})
	}
	return out
}

func str(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func num(value any) int64 {
	switch n := value.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

func boolValue(value any) bool {
	if b, ok := value.(bool); ok {
		return b
	}
	return num(value) != 0
}

func padEnd(value string, width int) string {
	if len(value) >= width {
		return value
	}
	return value + strings.Repeat(" ", width-len(value))
}

func padStart(value string, width int) string {
	if len(value) >= width {
		return value
	}
	return strings.Repeat(" ", width-len(value)) + value
}

func absolutePath(path string) string {
	absolute, err := os.Getwd()
	if err != nil {
		return path
	}
	return absolute + string(os.PathSeparator) + path
}

func mustPrettyJSON(v any) []byte {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(v); err != nil {
		log.Fatalf("bench: encode: %v", err)
	}
	return bytes.TrimRight(buf.Bytes(), "\n")
}
