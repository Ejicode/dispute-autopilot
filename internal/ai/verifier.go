package ai

import (
	"encoding/json"
	"regexp"

	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// VerificationResult is the deterministic outcome of claim verification.
type VerificationResult struct {
	Verified       bool
	Errors         []string
	VerifiedClaims []types.Claim
}

var claimIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

// RawClaims decodes stored claim JSON into loosely-typed objects so malformed
// or tampered records are rejected instead of trusted.
func RawClaims(value string) []map[string]any {
	if value == "" {
		return nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(value), &parsed); err != nil {
		return nil
	}
	arr, ok := parsed.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(arr))
	for _, item := range arr {
		rec, ok := item.(map[string]any)
		if !ok {
			out = append(out, nil)
			continue
		}
		out = append(out, rec)
	}
	return out
}

// VerifyDraftClaims validates runtime shape, ownership, integrity, source,
// field type, and the whole normalized value of every cited claim.
func VerifyDraftClaims(claims []map[string]any, evidenceItems []types.EvidenceItem, dispute types.Dispute) VerificationResult {
	errs := []string{}
	verifiedClaims := []types.Claim{}
	if len(claims) == 0 || len(claims) > 200 {
		return VerificationResult{Verified: false, Errors: []string{"Draft requires between 1 and 200 cited claims."}, VerifiedClaims: verifiedClaims}
	}
	ids := map[string]bool{}
	for _, raw := range claims {
		if raw == nil {
			errs = append(errs, "Malformed factual claim.")
			continue
		}
		claimID, hasClaimID := strOf(raw["claim_id"])
		evidenceID, hasEvID := strOf(raw["evidence_id"])
		text, hasText := strOf(raw["text"])
		expectedNorm := normalizedText(raw["expected_value"])
		if !hasClaimID || !claimIDPattern.MatchString(claimID) ||
			!hasEvID || !claimIDPattern.MatchString(evidenceID) ||
			!hasText || expectedNorm == "" {
			errs = append(errs, "Malformed factual claim.")
			continue
		}

		claim := types.Claim{
			ClaimID:       claimID,
			Text:          text,
			ClaimType:     claimTypeOf(raw["claim_type"]),
			ExpectedValue: rawString(raw["expected_value"]),
			EvidenceID:    evidenceID,
		}

		errMsg := ""
		if ids[claim.ClaimID] {
			errMsg = "Duplicate claim identity."
		} else {
			ids[claim.ClaimID] = true
			matches := make([]types.EvidenceItem, 0, 1)
			for _, e := range evidenceItems {
				if e.ID == claim.EvidenceID {
					matches = append(matches, e)
				}
			}
			if len(matches) != 1 {
				errMsg = "Citation must identify exactly one available evidence item."
			} else if facts, ferr := EvidenceFacts(matches[0], dispute); ferr != nil {
				errMsg = ferr.Error()
			} else {
				matched := false
				for _, f := range facts {
					if f.Type == claim.ClaimType && f.Value == expectedNorm {
						matched = true
						break
					}
				}
				if !matched {
					errMsg = "Claim does not match the complete typed field in its cited evidence."
				} else if claim.Text != RenderClaimText(claim.ClaimType, claim.ExpectedValue) {
					errMsg = "Claim text must use the supported factual template."
				}
			}
		}

		claim.Verified = errMsg == ""
		if errMsg != "" {
			errs = append(errs, claim.ClaimID+": "+errMsg)
			claim.MismatchReason = errMsg
		}
		verifiedClaims = append(verifiedClaims, claim)
	}
	return VerificationResult{Verified: len(errs) == 0, Errors: errs, VerifiedClaims: verifiedClaims}
}

// VerifyCitedDraft additionally requires that every submitted sentence was
// generated from the same checked claims.
func VerifyCitedDraft(claims []map[string]any, narrative string, evidence []types.EvidenceItem, dispute types.Dispute) VerificationResult {
	result := VerifyDraftClaims(claims, evidence, dispute)
	if narrative != RenderCitedNarrative(result.VerifiedClaims) {
		result.Errors = append(result.Errors, "Narrative does not exactly match its cited factual claims. Regenerate this draft.")
	}
	result.Verified = len(result.Errors) == 0
	return result
}

func strOf(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

func rawString(v any) string {
	s, _ := strOf(v)
	return s
}

func claimTypeOf(v any) string {
	s, _ := strOf(v)
	return s
}
