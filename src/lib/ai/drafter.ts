import crypto from 'crypto';
import { getDb, recordAuditLog } from '../db';
import { AIDraft, Claim, Dispute, EvidenceItem } from '../types';
import { verifyCitedDraft } from './verifier';
import { evidenceFacts, renderClaimText, renderCitedNarrative } from './evidence-facts';
import { realtimeHub } from '../realtime/hub';

export interface DraftOutput {
  classification: string;
  narrative: string;
  claims: Claim[];
  model_name: string;
}

/**
 * Generate a cited dispute rebuttal draft
 */
export async function generateCitedDraft(
  dispute: Dispute,
  evidenceItems: EvidenceItem[],
  buyerMessage: string = ''
): Promise<AIDraft> {
  const draftOutput = generateDeterministicDraft(dispute, evidenceItems, buyerMessage);

  return persistCitedDraft(dispute, evidenceItems, draftOutput);
}

/** Synchronous persistence allows webhook projection and drafting to commit atomically. */
export function persistCitedDraft(
  dispute: Dispute, evidenceItems: EvidenceItem[], draftOutput: DraftOutput, publish = true
): AIDraft {
  const db = getDb();
  // Pure code verification of all claims against vault
  const verification = verifyCitedDraft(draftOutput.claims, draftOutput.narrative, evidenceItems, dispute);

  const draftId = 'drf_' + crypto.randomBytes(8).toString('hex');
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO ai_drafts (
      id, dispute_id, classification, draft_text, claims, schema_valid, model_name, verified, verification_errors, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    draftId,
    dispute.id,
    draftOutput.classification,
    draftOutput.narrative,
    JSON.stringify(verification.verifiedClaims),
    1,
    draftOutput.model_name,
    verification.verified ? 1 : 0,
    verification.errors.length > 0 ? JSON.stringify(verification.errors) : null,
    now
  );

  const aiDraft: AIDraft = {
    id: draftId,
    dispute_id: dispute.id,
    classification: draftOutput.classification,
    draft_text: draftOutput.narrative,
    claims: verification.verifiedClaims,
    schema_valid: true,
    model_name: draftOutput.model_name,
    verified: verification.verified,
    verification_errors: verification.errors,
    created_at: now,
  };

  recordAuditLog(
    'ai',
    'AI_DRAFT_GENERATED',
    {
      draft_id: draftId,
      dispute_id: dispute.id,
      claims_count: verification.verifiedClaims.length,
      verified: verification.verified,
      errors: verification.errors,
      model: draftOutput.model_name,
    },
    dispute.id
  );

  if (publish) realtimeHub.publish('DRAFT_GENERATED', aiDraft);

  return aiDraft;
}

/**
 * Deterministic cited response generator
 * Produces structured factual rebuttals strictly bound to vault evidence IDs
 */
export function generateDeterministicDraft(
  dispute: Dispute,
  evidenceItems: EvidenceItem[],
  buyerMessage: string = ''
): DraftOutput {
  const claims: Claim[] = [];
  // Invalid/unstructured records cannot supply facts. Missing information stays absent.
  for (const item of [...evidenceItems].sort((a, b) => a.id.localeCompare(b.id))) {
    try {
      for (const fact of evidenceFacts(item, dispute)) {
        if (claims.some(c => c.claim_type === fact.type && c.expected_value === fact.value && c.evidence_id === item.id)) continue;
        const claim: Claim = {
          claim_id: 'clm_' + crypto.randomBytes(8).toString('hex'),
          claim_type: fact.type, expected_value: fact.value, evidence_id: item.id, text: '',
        };
        claim.text = renderClaimText(claim);
        claims.push(claim);
      }
    } catch { /* Unusable evidence is excluded, never replaced with invented facts. */ }
  }
  return {
    classification: dispute.reason,
    narrative: renderCitedNarrative(claims),
    claims,
    model_name: 'DisputeAutopilot-Deterministic-v2',
  };
}
