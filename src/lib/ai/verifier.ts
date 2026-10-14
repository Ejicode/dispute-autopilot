import type { Claim, Dispute, EvidenceItem } from '../types';
import { evidenceFacts, normalizedText, renderClaimText, renderCitedNarrative } from './evidence-facts';

export interface VerificationResult {
  verified: boolean;
  errors: string[];
  verifiedClaims: Claim[];
}

/** Validate runtime shape, ownership, integrity, source, field type, and the whole normalized value. */
export function verifyDraftClaims(claims: unknown, evidenceItems: EvidenceItem[], dispute: Dispute): VerificationResult {
  const errors: string[] = [];
  const verifiedClaims: Claim[] = [];
  if (!Array.isArray(claims) || !claims.length || claims.length > 200) {
    return { verified: false, errors: ['Draft requires between 1 and 200 cited claims.'], verifiedClaims };
  }
  const ids = new Set<string>();
  for (const raw of claims) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        typeof raw.claim_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.claim_id) ||
        typeof raw.evidence_id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.evidence_id) ||
        typeof raw.text !== 'string' || !normalizedText(raw.expected_value)) {
      errors.push('Malformed factual claim.');
      continue;
    }
    const claim = { ...raw } as Claim;
    let error = '';
    try {
      if (ids.has(claim.claim_id)) throw new Error('Duplicate claim identity.');
      ids.add(claim.claim_id);
      const matches = evidenceItems.filter(e => e.id === claim.evidence_id);
      if (matches.length !== 1) throw new Error('Citation must identify exactly one available evidence item.');
      const facts = evidenceFacts(matches[0], dispute);
      if (!facts.some(f => f.type === claim.claim_type && f.value === normalizedText(claim.expected_value))) {
        throw new Error('Claim does not match the complete typed field in its cited evidence.');
      }
      if (claim.text !== renderClaimText(claim)) throw new Error('Claim text must use the supported factual template.');
    } catch (err) { error = err instanceof Error ? err.message : 'Invalid claim.'; }
    claim.verified = !error;
    if (error) { errors.push(`${claim.claim_id}: ${error}`); claim.mismatch_reason = error; }
    else delete claim.mismatch_reason;
    verifiedClaims.push(claim);
  }
  return { verified: errors.length === 0, errors, verifiedClaims };
}

/** Every submitted sentence must be generated from the same checked claims. */
export function verifyCitedDraft(claims: unknown, narrative: unknown, evidence: EvidenceItem[], dispute: Dispute): VerificationResult {
  const result = verifyDraftClaims(claims, evidence, dispute);
  if (typeof narrative !== 'string' || narrative !== renderCitedNarrative(result.verifiedClaims)) {
    result.errors.push('Narrative does not exactly match its cited factual claims. Regenerate this draft.');
  }
  result.verified = result.errors.length === 0;
  return result;
}

export function parseStoredClaims(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}
