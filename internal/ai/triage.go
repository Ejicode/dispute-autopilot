// Package ai implements the deterministic triage, drafting and verification
// pipeline. Code — never the model — decides whether a claim is true.
package ai

import (
	"strings"

	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// TriageFactor is one weighted component of the evidence strength score.
type TriageFactor struct {
	Factor  string `json:"factor"`
	Points  int    `json:"points"`
	Earned  int    `json:"earned"`
	Details string `json:"details"`
}

// TriageResult is the deterministic evidence strength assessment.
type TriageResult struct {
	Score          int            `json:"score"`
	Recommendation string         `json:"recommendation"`
	Breakdown      []TriageFactor `json:"breakdown"`
}

// CalculateEvidenceStrength scores how complete the merchant's evidence is
// relative to what PayPal expects for the given dispute reason.
func CalculateEvidenceStrength(reason string, evidenceItems []types.EvidenceItem) TriageResult {
	breakdown := []TriageFactor{}

	typeSet := map[string]bool{}
	contents := make([]string, 0, len(evidenceItems))
	for _, e := range evidenceItems {
		typeSet[e.EvidenceType] = true
		contents = append(contents, e.Content)
	}
	fullContent := strings.Join(contents, " ")

	score := 0
	add := func(factor string, points, earned int, details string) {
		breakdown = append(breakdown, TriageFactor{Factor: factor, Points: points, Earned: earned, Details: details})
		score += earned
	}

	switch reason {
	case string(types.ReasonNotReceived):
		hasTracking := typeSet["TRACKING_HISTORY"]
		add("Carrier Tracking Number Registered", 25, boolPoints(hasTracking, 25), either("Active carrier tracking record found", "Missing carrier tracking", hasTracking))

		isDeliveredOrInTransit := strings.Contains(fullContent, "DELIVERED") || strings.Contains(fullContent, "IN_TRANSIT") || strings.Contains(fullContent, "Delivered")
		add("Carrier Transit Milestone Verified", 25, boolPoints(isDeliveredOrInTransit, 25), either("Carrier confirms package movement/delivery", "No carrier transit events", isDeliveredOrInTransit))

		hasPOD := typeSet["PROOF_OF_DELIVERY"] || strings.Contains(fullContent, "DELIVERED")
		add("Delivery Confirmation Timestamp", 25, boolPoints(hasPOD, 25), either("Physical or electronic delivery confirmation exists", "Missing delivery confirmation", hasPOD))

		hasSignature := strings.Contains(fullContent, "Signature") || strings.Contains(fullContent, "SIGNATURE_VERIFIED")
		add("Recipient Signature Confirmation", 15, boolPoints(hasSignature, 15), either("Signature on file", "No signature required or recorded", hasSignature))

		hasOrder := typeSet["ORDER_CONFIRMATION"]
		add("Order Confirmation & Invoice", 10, boolPoints(hasOrder, 10), either("Matching merchant order record in vault", "Order record missing", hasOrder))

	case string(types.ReasonUnauthorised):
		hasDevice := typeSet["DEVICE_FINGERPRINT"] || strings.Contains(fullContent, "ip_address")
		add("Checkout Device & IP Fingerprint", 35, boolPoints(hasDevice, 35), either("Device fingerprint & IP logged at payment", "No device log captured", hasDevice))

		hasPOD := typeSet["PROOF_OF_DELIVERY"] || typeSet["TRACKING_HISTORY"]
		add("Shipment to Confirmed Address", 35, boolPoints(hasPOD, 35), either("Delivered to buyer PayPal registered address", "Address verification missing", hasPOD))

		hasOrder := typeSet["ORDER_CONFIRMATION"]
		add("Itemized Order Record", 20, boolPoints(hasOrder, 20), either("Order snapshot present", "Order snapshot missing", hasOrder))

		hasComms := typeSet["CUSTOMER_COMMUNICATION"]
		add("Customer Correspondence", 10, boolPoints(hasComms, 10), either("Pre-dispute customer email on file", "No customer messages", hasComms))

	default:
		hasPolicy := typeSet["REFUND_POLICY"] || strings.Contains(fullContent, "terms") || strings.Contains(fullContent, "policy")
		add("Documented Store Policy & Terms", 30, boolPoints(hasPolicy, 30), either("Terms and conditions accepted at checkout", "No terms record", hasPolicy))

		hasOrder := typeSet["ORDER_CONFIRMATION"]
		add("Detailed Item Description & Specs", 30, boolPoints(hasOrder, 30), either("Original product specs and listing preserved", "Product description missing", hasOrder))

		hasDelivery := typeSet["PROOF_OF_DELIVERY"] || typeSet["TRACKING_HISTORY"]
		add("Proof of Delivery", 20, boolPoints(hasDelivery, 20), either("Delivery verified", "Delivery missing", hasDelivery))

		hasComms := typeSet["CUSTOMER_COMMUNICATION"]
		add("Support Ticket History", 20, boolPoints(hasComms, 20), either("Customer support interactions logged", "No ticket found", hasComms))
	}

	finalScore := score
	if finalScore < 0 {
		finalScore = 0
	}
	if finalScore > 100 {
		finalScore = 100
	}

	recommendation := string(types.RecommendAskHuman)
	if finalScore >= 70 {
		recommendation = string(types.RecommendFight)
	} else if finalScore < 35 {
		recommendation = string(types.RecommendAccept)
	}

	return TriageResult{Score: finalScore, Recommendation: recommendation, Breakdown: breakdown}
}

func boolPoints(ok bool, points int) int {
	if ok {
		return points
	}
	return 0
}

func either(ifTrue, ifFalse string, ok bool) string {
	if ok {
		return ifTrue
	}
	return ifFalse
}
