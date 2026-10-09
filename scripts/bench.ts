import fs from 'fs';
import path from 'path';
import { runDisputeBench } from '../src/lib/bench/runner';

async function main() {
  console.log('\n===============================================================');
  console.log('  DISPUTE AUTOPILOT | 40-SCENARIO DISPUTE BENCHMARK RUNNER');
  console.log('  PayPal AI Hackathon 2026 - Independent Evaluation');
  console.log('===============================================================\n');
  console.log('Running 40 scripted dispute scenarios...\n');

  const summary = await runDisputeBench();

  console.log('---------------------------------------------------------------------------------------------------------------------');
  console.log('| ID          | Category / Scenario Name                      | Mode    | Score | Triage      | Verified | Time (ms) | Unsafe |');
  console.log('---------------------------------------------------------------------------------------------------------------------');

  for (const r of summary.results) {
    const id = r.scenarioId.padEnd(11);
    const name = r.name.length > 44 ? r.name.substring(0, 41) + '...' : r.name.padEnd(45);
    const mode = (r.isLive ? 'LIVE' : 'STUB').padEnd(7);
    const score = String(r.strengthScore).padStart(3) + '/100';
    const triage = r.recommendation.padEnd(11);
    const ver = (r.claimsVerified ? 'PASS' : 'FAIL').padEnd(8);
    const time = (r.timeMs + 'ms').padStart(9);
    const unsafe = String(r.unsafeActions).padStart(6);

    console.log(`| ${id} | ${name} | ${mode} | ${score} | ${triage} | ${ver} | ${time} | ${unsafe} |`);
  }
  console.log('---------------------------------------------------------------------------------------------------------------------\n');

  console.log('BENCHMARK SUMMARY METRICS:');
  console.log(`  Total Scenarios Tested:    ${summary.totalScenarios} (10 Live Sandbox, 30 Stubbed Pipeline)`);
  console.log(`  Evidence Complete Rate:    ${summary.evidenceCompleteRate}%`);
  console.log(`  Claims Verified Rate:      ${summary.claimsVerifiedRate}%`);
  console.log(`  Unsafe Actions Executed:   ${summary.unsafeActionsExecuted} (STRICT ZERO TOLERANCE)`);
  console.log(`  Median Processing Time:    ${summary.medianProcessingTimeMs} ms`);
  console.log(`  Hand-Timed Baseline:       ${summary.handTimedBaselineSec} seconds (6.0 minutes)`);
  console.log(`  Automation Speedup Factor: ~${summary.speedupFactor}x faster than manual handling\n`);

  // Write committed bench results JSON artifact
  const resultsPayload = {
    benchmark_name: 'Dispute Autopilot 40-Scenario Benchmark',
    date: new Date().toISOString(),
    model_name: process.env.AI_MODEL_NAME || 'DisputeAutopilot-Deterministic-v1',
    dataset_label: 'DEMO DATA & SYNTHETIC BENCHMARK FIXTURES',
    metrics: {
      total_scenarios: summary.totalScenarios,
      live_scenarios: summary.liveCount,
      stubbed_scenarios: summary.stubbedCount,
      evidence_complete_rate_pct: summary.evidenceCompleteRate,
      claims_verified_rate_pct: summary.claimsVerifiedRate,
      unsafe_actions_executed: summary.unsafeActionsExecuted,
      median_processing_time_ms: summary.medianProcessingTimeMs,
      hand_timed_baseline_sec: summary.handTimedBaselineSec,
      speedup_factor: summary.speedupFactor,
    },
    scenarios: summary.results,
  };

  const outputPath = path.join(process.cwd(), 'bench_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(resultsPayload, null, 2), 'utf-8');
  console.log(`✓ Benchmark results saved to: ${outputPath}\n`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
