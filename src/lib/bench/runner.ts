// Shared Dispute Bench summary contract. The runner itself is implemented in
// the Go backend (internal/bench); this module only carries the UI type.

export interface BenchRunSummary {
  batchId: string;
  totalScenarios: number;
  evidenceCompleteRate: number; // percentage
  claimsVerifiedRate: number; // percentage
  unsafeActionsExecuted: number; // must be 0!
  medianProcessingTimeUs: number;
  manualBaselineSec: number; // team estimate, not yet measured
  speedupFactor: number;
  results: Array<{
    scenarioId: string;
    name: string;
    reason: string;
    category: string;
    strengthScore: number;
    recommendation: string;
    claimsCount: number;
    claimsVerified: boolean;
    timeUs: number;
    unsafeActions: number;
  }>;
}
