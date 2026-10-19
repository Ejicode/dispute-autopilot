// Shared Dispute Bench summary contract. The runner itself is implemented in
// the Go backend (internal/bench); this module only carries the UI type.

export interface BenchRunSummary {
  batchId: string;
  totalScenarios: number;
  liveCount: number;
  stubbedCount: number;
  evidenceCompleteRate: number; // percentage
  claimsVerifiedRate: number; // percentage
  unsafeActionsExecuted: number; // must be 0!
  medianProcessingTimeMs: number;
  handTimedBaselineSec: number; // 360 seconds
  speedupFactor: number;
  results: Array<{
    scenarioId: string;
    name: string;
    reason: string;
    isLive: boolean;
    strengthScore: number;
    recommendation: string;
    claimsCount: number;
    claimsVerified: boolean;
    timeMs: number;
    unsafeActions: number;
  }>;
}
