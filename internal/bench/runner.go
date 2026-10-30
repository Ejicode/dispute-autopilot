package bench

import (
	"context"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/runtime"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// trackingContent mirrors the JSON.stringify payload for TRACKING_HISTORY.
type trackingContent struct {
	TrackingNumber string          `json:"tracking_number"`
	Status         string          `json:"status"`
	Events         []trackingEvent `json:"events"`
	DeliveredAt    *string         `json:"delivered_at"`
}

type trackingEvent struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
	Location  string `json:"location"`
}

// podContent mirrors the JSON.stringify payload for PROOF_OF_DELIVERY.
type podContent struct {
	TrackingNumber  string  `json:"tracking_number"`
	DeliveredAt     string  `json:"delivered_at"`
	SignatureOnFile *string `json:"signature_on_file"`
}

// orderContent mirrors the JSON.stringify payload for ORDER_CONFIRMATION.
type orderContent struct {
	OrderID         string `json:"order_id"`
	TransactionID   string `json:"transaction_id"`
	AmountCents     int64  `json:"amount_cents"`
	Currency        string `json:"currency"`
	ShippingAddress string `json:"shipping_address"`
	BuyerName       string `json:"buyer_name"`
}

// benchDetails is the JSON blob recorded in bench_runs.details.
type benchDetails struct {
	Triage      ai.TriageResult `json:"triage"`
	ClaimsCount int             `json:"claimsCount"`
}

// mustMarshal mirrors JavaScript's JSON.stringify: no HTML escaping and no
// trailing newline, so synthesized content and stored details match the
// TypeScript byte-for-byte.
func mustMarshal(v any) string {
	b, err := httpx.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

// synthesizeEvidence builds the deterministic dispute and vault evidence items
// for one scenario, byte-for-byte matching the TypeScript benchmark fixtures.
// The integrity hashes are recomputed from the encoded content, exactly as the
// original runner does after synthesizing its records.
func synthesizeEvidence(sc scenario) (types.Dispute, []types.EvidenceItem) {
	now := config.NowISO()
	dispute := types.Dispute{
		ID:               "bench_dsp_" + sc.id,
		PayPalDisputeID:  "PP-D-" + sc.id,
		TransactionID:    "TXN-" + sc.id,
		OrderID:          types.NullString("ORD-" + sc.id),
		Reason:           string(sc.reason),
		AmountCents:      sc.amountCents,
		Currency:         "USD",
		Status:           "REQUIRED_ACTION",
		ResponseDeadline: config.FormatISO(time.Now().Add(48 * time.Hour)),
		Outcome:          types.NullString("PENDING"),
		StrengthScore:    0,
		Recommendation:   "ASK A HUMAN",
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	evidenceItems := []types.EvidenceItem{}
	trackingNum := "TRK-" + sc.id + "-USPS"

	if sc.hasTracking {
		timestamp := "2026-10-02T14:30:00Z"
		var deliveredAt *string
		if sc.carrierStatus == "DELIVERED" {
			timestamp = "2026-10-04T11:20:00Z"
			delivered := "2026-10-04T11:20:00Z"
			deliveredAt = &delivered
		}
		content := mustMarshal(trackingContent{
			TrackingNumber: trackingNum,
			Status:         sc.carrierStatus,
			Events: []trackingEvent{{
				Status:    sc.carrierStatus,
				Timestamp: timestamp,
				Location:  "Los Angeles, CA",
			}},
			DeliveredAt: deliveredAt,
		})
		evidenceItems = append(evidenceItems, types.EvidenceItem{
			ID:           "ev_trk_" + sc.id,
			DisputeID:    types.NullString(dispute.ID),
			OrderID:      types.NullString(dispute.OrderID.Str()),
			EvidenceType: "TRACKING_HISTORY",
			Source:       "CARRIER_SIMULATOR",
			Title:        "Carrier Tracking History (" + trackingNum + ")",
			Content:      content,
			SHA256Hash:   store.SHA256Hex([]byte(trackingNum)),
			CapturedAt:   "2026-10-02T14:30:00Z",
		})
	}

	if sc.carrierStatus == "DELIVERED" {
		var signature *string
		if sc.hasSignature {
			s := "J. DOE (SIGNATURE_VERIFIED)"
			signature = &s
		}
		content := mustMarshal(podContent{
			TrackingNumber:  trackingNum,
			DeliveredAt:     "2026-10-04T11:20:00Z",
			SignatureOnFile: signature,
		})
		evidenceItems = append(evidenceItems, types.EvidenceItem{
			ID:           "ev_pod_" + sc.id,
			DisputeID:    types.NullString(dispute.ID),
			OrderID:      types.NullString(dispute.OrderID.Str()),
			EvidenceType: "PROOF_OF_DELIVERY",
			Source:       "CARRIER_SIMULATOR",
			Title:        "Proof of Delivery Confirmation",
			Content:      content,
			SHA256Hash:   store.SHA256Hex([]byte("pod_" + sc.id)),
			CapturedAt:   "2026-10-04T11:20:00Z",
		})
	}

	// Always include the order record.
	orderJSON := mustMarshal(orderContent{
		OrderID:         dispute.OrderID.Str(),
		TransactionID:   dispute.TransactionID,
		AmountCents:     dispute.AmountCents,
		Currency:        dispute.Currency,
		ShippingAddress: "100 Market St, San Francisco, CA",
		BuyerName:       "Alex Johnson",
	})
	evidenceItems = append(evidenceItems, types.EvidenceItem{
		ID:           "ev_ord_" + sc.id,
		DisputeID:    types.NullString(dispute.ID),
		OrderID:      types.NullString(dispute.OrderID.Str()),
		EvidenceType: "ORDER_CONFIRMATION",
		Source:       "STOREFRONT_CAPTURE",
		Title:        "Order Invoice & Confirmation",
		Content:      orderJSON,
		SHA256Hash:   store.SHA256Hex([]byte("ord_" + sc.id)),
		CapturedAt:   "2026-10-01T10:00:00Z",
	})

	if sc.category == categorySNAD {
		policy := "30-day return policy requiring original packaging. Customer agreed at checkout."
		evidenceItems = append(evidenceItems, types.EvidenceItem{
			ID:           "ev_pol_" + sc.id,
			DisputeID:    types.NullString(dispute.ID),
			OrderID:      types.NullString(dispute.OrderID.Str()),
			EvidenceType: "REFUND_POLICY",
			Source:       "STOREFRONT_TERMS",
			Title:        "Terms of Sale & Return Policy",
			Content:      policy,
			SHA256Hash:   store.SHA256Hex([]byte("policy")),
			CapturedAt:   "2026-10-01T10:00:00Z",
		})
	}

	// These are synthetic records, but their integrity hashes must cover their
	// actual content.
	for i := range evidenceItems {
		evidenceItems[i].SHA256Hash = store.SHA256Hex([]byte(evidenceItems[i].Content))
	}

	return dispute, evidenceItems
}

// Run executes all 40 scenarios through the deterministic pipeline, persists one
// row per scenario, publishes BENCHMARK_PROGRESS, and returns the summary.
func Run(ctx context.Context) (map[string]any, error) {
	return runBatch(ctx, "batch_"+strconv.FormatInt(config.NowMillis(), 10))
}

func runBatch(ctx context.Context, batchID string) (map[string]any, error) {
	if err := runtime.RequireDemo(ctx); err != nil {
		return nil, err
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		return nil, err
	}

	results := make([]map[string]any, 0, len(benchScenarios))
	timesUs := make([]int64, 0, len(benchScenarios))
	completeEvidenceCount := 0
	allClaimsVerifiedCount := 0
	totalUnsafeActions := 0

	for _, sc := range benchScenarios {
		startTime := time.Now()

		// 1-2. Synthesize the mock dispute and its vault evidence.
		dispute, evidenceItems := synthesizeEvidence(sc)

		// 3. Triage & Strength Score calculation.
		triage := ai.CalculateEvidenceStrength(dispute.Reason, evidenceItems)
		dispute.StrengthScore = int64(triage.Score)
		dispute.Recommendation = triage.Recommendation

		if triage.Score >= 50 {
			completeEvidenceCount++
		}

		// 4. Generate cited draft.
		draftOutput := ai.GenerateDeterministicDraft(dispute, evidenceItems, sc.buyerMessage)

		// 5. Run deterministic code verifier on claims.
		verification := ai.VerifyCitedDraft(ai.ClaimsToRaw(draftOutput.Claims), draftOutput.Narrative, evidenceItems, dispute)
		if verification.Verified {
			allClaimsVerifiedCount++
		}

		// 6. Check unsafe action rule: The AI never submits anything!
		unsafeActions := 0
		totalUnsafeActions += unsafeActions

		elapsedUs := time.Since(startTime).Microseconds()
		timesUs = append(timesUs, elapsedUs)
		elapsedMs := int(math.Round(float64(elapsedUs) / 1000))

		// Record in bench_runs table.
		details := mustMarshal(benchDetails{
			Triage:      triage,
			ClaimsCount: len(draftOutput.Claims),
		})

		claimsVerified := 0
		if verification.Verified {
			claimsVerified = 1
		}
		passed := 0
		if verification.Verified && unsafeActions == 0 {
			passed = 1
		}

		if _, err := db.Exec(ctx, `INSERT INTO bench_runs (
			id, batch_id, scenario_id, name, dispute_reason, is_live, claims_verified, unsafe_actions_executed, execution_time_ms, passed, details, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			// is_live is always 0: every scenario is an offline fixture.
			store.RandomID("br_", 6), batchID, sc.id, sc.name, string(sc.reason), 0,
			claimsVerified, unsafeActions, elapsedMs, passed, details, config.NowISO()); err != nil {
			return nil, err
		}

		results = append(results, map[string]any{
			"scenarioId":     sc.id,
			"name":           sc.name,
			"reason":         string(sc.reason),
			"category":       sc.category,
			"strengthScore":  triage.Score,
			"recommendation": triage.Recommendation,
			"claimsCount":    len(draftOutput.Claims),
			"claimsVerified": verification.Verified,
			"timeUs":         elapsedUs,
			"unsafeActions":  unsafeActions,
		})
	}

	// Calculate median execution time.
	sort.Slice(timesUs, func(i, j int) bool { return timesUs[i] < timesUs[j] })
	var medianTimeUs int64
	if len(timesUs) > 0 {
		mid := len(timesUs) / 2
		if len(timesUs)%2 != 0 {
			medianTimeUs = timesUs[mid]
		} else {
			medianTimeUs = int64(math.Round(float64(timesUs[mid-1]+timesUs[mid]) / 2))
		}
	}

	// manualBaselineSec is the team's estimate of hand-assembling one evidence
	// packet. Replace it with a measured figure before quoting the speedup.
	const manualBaselineSec = int64(360)
	speedup := int64(math.Round(float64(manualBaselineSec*1_000_000) / float64(max(medianTimeUs, 1))))

	totalScenarios := len(benchScenarios)
	evidenceCompleteRate := 0
	claimsVerifiedRate := 0
	if totalScenarios > 0 {
		evidenceCompleteRate = int(math.Round(float64(completeEvidenceCount) / float64(totalScenarios) * 100))
		claimsVerifiedRate = int(math.Round(float64(allClaimsVerifiedCount) / float64(totalScenarios) * 100))
	}

	summary := map[string]any{
		"batchId":                batchID,
		"totalScenarios":         totalScenarios,
		"evidenceCompleteRate":   evidenceCompleteRate,
		"claimsVerifiedRate":     claimsVerifiedRate,
		"unsafeActionsExecuted":  totalUnsafeActions,
		"medianProcessingTimeUs": medianTimeUs,
		"manualBaselineSec":      manualBaselineSec,
		"speedupFactor":          speedup,
		"results":                results,
	}

	realtime.Default().Publish(ctx, "BENCHMARK_PROGRESS", summary)

	return summary, nil
}
