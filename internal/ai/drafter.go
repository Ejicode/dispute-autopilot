package ai

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/realtime"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// DraftOutput is the deterministic draft before verification.
type DraftOutput struct {
	Classification string        `json:"classification"`
	Narrative      string        `json:"narrative"`
	Claims         []types.Claim `json:"claims"`
	ModelName      string        `json:"model_name"`
}

// GenerateCitedDraft generates and persists a cited rebuttal draft.
func GenerateCitedDraft(ctx context.Context, dispute types.Dispute, evidenceItems []types.EvidenceItem, buyerMessage string) (types.AIDraft, error) {
	output := GenerateDeterministicDraft(dispute, evidenceItems, buyerMessage)
	return PersistCitedDraft(ctx, dispute, evidenceItems, output, true)
}

// GenerateDeterministicDraft produces structured factual rebuttals strictly
// bound to vault evidence IDs.
func GenerateDeterministicDraft(dispute types.Dispute, evidenceItems []types.EvidenceItem, buyerMessage string) DraftOutput {
	_ = buyerMessage
	claims := []types.Claim{}

	items := append([]types.EvidenceItem(nil), evidenceItems...)
	sort.SliceStable(items, func(i, j int) bool { return items[i].ID < items[j].ID })

	for _, item := range items {
		facts, err := EvidenceFacts(item, dispute)
		if err != nil {
			// Unusable evidence is excluded, never replaced with invented facts.
			continue
		}
		for _, fact := range facts {
			duplicate := false
			for _, c := range claims {
				if c.ClaimType == fact.Type && c.ExpectedValue == fact.Value && c.EvidenceID == item.ID {
					duplicate = true
					break
				}
			}
			if duplicate {
				continue
			}
			claim := types.Claim{
				ClaimID:       store.RandomID("clm_", 8),
				ClaimType:     fact.Type,
				ExpectedValue: fact.Value,
				EvidenceID:    item.ID,
			}
			claim.Text = RenderClaimText(claim.ClaimType, claim.ExpectedValue)
			claims = append(claims, claim)
		}
	}

	return DraftOutput{
		Classification: dispute.Reason,
		Narrative:      RenderCitedNarrative(claims),
		Claims:         claims,
		ModelName:      "DisputeAutopilot-Deterministic-v2",
	}
}

// PersistCitedDraft verifies and stores a draft. It is intentionally
// synchronous so webhook projection and drafting can commit atomically.
func PersistCitedDraft(ctx context.Context, dispute types.Dispute, evidenceItems []types.EvidenceItem, output DraftOutput, publish bool) (types.AIDraft, error) {
	verification := VerifyCitedDraft(ClaimsToRaw(output.Claims), output.Narrative, evidenceItems, dispute)

	db, err := store.Merchant(ctx)
	if err != nil {
		return types.AIDraft{}, err
	}
	draftID := store.RandomID("drf_", 8)
	now := config.NowISO()

	claimsJSON, err := json.Marshal(verification.VerifiedClaims)
	if err != nil {
		return types.AIDraft{}, err
	}
	var verificationErrors any
	if len(verification.Errors) > 0 {
		encoded, err := json.Marshal(verification.Errors)
		if err != nil {
			return types.AIDraft{}, err
		}
		verificationErrors = string(encoded)
	}

	if _, err := db.Exec(ctx, `INSERT INTO ai_drafts (
		id, dispute_id, classification, draft_text, claims, schema_valid, model_name, verified, verification_errors, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		draftID, dispute.ID, output.Classification, output.Narrative, string(claimsJSON), 1,
		output.ModelName, boolToInt(verification.Verified), verificationErrors, now); err != nil {
		return types.AIDraft{}, err
	}

	draft := types.AIDraft{
		ID:                 draftID,
		DisputeID:          dispute.ID,
		Classification:     output.Classification,
		DraftText:          output.Narrative,
		Claims:             verification.VerifiedClaims,
		SchemaValid:        true,
		ModelName:          output.ModelName,
		Verified:           verification.Verified,
		VerificationErrors: verification.Errors,
		CreatedAt:          now,
	}

	disputeID := dispute.ID
	if _, err := store.Audit(ctx, "ai", "AI_DRAFT_GENERATED", map[string]any{
		"draft_id":     draftID,
		"dispute_id":   dispute.ID,
		"claims_count": len(verification.VerifiedClaims),
		"verified":     verification.Verified,
		"errors":       verification.Errors,
		"model":        output.ModelName,
	}, &disputeID); err != nil {
		return types.AIDraft{}, err
	}

	if publish {
		realtime.Default().Publish(ctx, "DRAFT_GENERATED", draft)
	}
	return draft, nil
}

// ClaimsToRaw converts typed claims into the loosely-typed shape the verifier
// accepts, so callers (such as the benchmark) can verify a generated draft.
func ClaimsToRaw(claims []types.Claim) []map[string]any {
	out := make([]map[string]any, 0, len(claims))
	for _, c := range claims {
		out = append(out, map[string]any{
			"claim_id":       c.ClaimID,
			"text":           c.Text,
			"claim_type":     c.ClaimType,
			"expected_value": c.ExpectedValue,
			"evidence_id":    c.EvidenceID,
		})
	}
	return out
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
