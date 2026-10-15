import crypto from 'node:crypto';
import { getDb, recordAuditLog } from '../db';
import { HttpError } from '../auth/session';
import { merchantScope } from '../auth/context';
import { paypalClient } from '../paypal/client';
import { realtimeHub } from '../realtime/hub';
import { verifyCitedDraft, parseStoredClaims } from '../ai/verifier';
import { calculateSha256 } from '../vault/vault';
import type { ApprovalAction, ApprovalReview, Dispute, EvidenceItem } from '../types';

interface Operation {
  id: string; dispute_id: string; action_type: ApprovalAction; snapshot_digest: string;
  snapshot: string; state: 'SUBMITTING' | 'SUCCEEDED' | 'UNCERTAIN'; response: string | null;
  idempotency_key: string;
}

export function parseAction(value: unknown): ApprovalAction {
  if (value !== 'PROVIDE_EVIDENCE' && value !== 'ACCEPT_CLAIM') throw new HttpError(400, 'An explicit supported action_type is required.');
  return value;
}

export function requireDispute(id: string): Dispute {
  const dispute = getDb().prepare('SELECT * FROM disputes WHERE id=?').get(id) as Dispute | undefined;
  if (!dispute) throw new HttpError(404, 'Dispute not found.');
  return dispute;
}

function operationFor(id: string): Operation | undefined {
  return getDb().prepare('SELECT * FROM approval_operations WHERE dispute_id=?').get(id) as Operation | undefined;
}

function checkPolicy(dispute: Dispute) {
  if (dispute.status !== 'REQUIRED_ACTION') throw new HttpError(409, 'This dispute is not awaiting a merchant action.');
  const deadline = Date.parse(dispute.response_deadline);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new HttpError(422, 'The response deadline is expired or unknown.');
  if (!Number.isSafeInteger(dispute.amount_cents) || dispute.amount_cents <= 0 || !/^[A-Z]{3}$/.test(dispute.currency)) {
    throw new HttpError(422, 'Dispute amount or currency is invalid.');
  }
  if (getDb().prepare("SELECT id FROM approvals WHERE dispute_id=? AND decision='APPROVED' LIMIT 1").get(dispute.id)) {
    throw new HttpError(409, 'An earlier approval requires reconciliation before another action.');
  }
}

/** Synchronous capture: no await between reading review inputs and reserving execution. */
function buildReview(dispute: Dispute, action: ApprovalAction): ApprovalReview {
  checkPolicy(dispute);
  const db = getDb();
  const draft = action === 'PROVIDE_EVIDENCE' ? db.prepare('SELECT * FROM ai_drafts WHERE dispute_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(dispute.id) as any : null;
  const evidence = action === 'PROVIDE_EVIDENCE' ? db.prepare(`SELECT * FROM evidence_items
    WHERE dispute_id=? OR order_id=? ORDER BY id`).all(dispute.id, dispute.order_id || '') as EvidenceItem[] : [];
  let payload: Record<string, unknown>;
  if (action === 'PROVIDE_EVIDENCE') {
    if (!draft?.verified || !draft.schema_valid) throw new HttpError(422, 'A verified response draft is required.');
    if (evidence.some(item => calculateSha256(item.content) !== item.sha256_hash)) throw new HttpError(422, 'Evidence integrity check failed.');
    const claims = parseStoredClaims(draft.claims);
    if (!Array.isArray(claims) || !claims.length || claims.some(c => !c || typeof c.expected_value !== 'string' || !c.expected_value.trim())) {
      throw new HttpError(422, 'Draft claims are incomplete.');
    }
    if (!verifyCitedDraft(claims, draft.draft_text, evidence, dispute).verified) throw new HttpError(422, 'Draft facts or narrative no longer match the evidence. Regenerate the draft.');
    const citedTracking = new Set(claims.filter(c => c.claim_type === 'TRACKING_NUMBER').map(c => c.evidence_id));
    const tracking = evidence.filter(e => citedTracking.has(e.id)).map(e => {
      try { return JSON.parse(e.content); } catch { return null; }
    }).filter(e => e && typeof e.carrier === 'string' && e.carrier.trim() && typeof e.tracking_number === 'string' && e.tracking_number.trim());
    if (!tracking.length) throw new HttpError(422, 'Recorded carrier and tracking number are required.');
    payload = { evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: {
      tracking_info: tracking.map(t => ({ carrier_name: t.carrier, tracking_number: t.tracking_number })),
    }, notes: draft.draft_text }] };
  } else {
    payload = { note: 'Seller accepted buyer claim.' };
  }
  const snapshot: ApprovalReview['snapshot'] = {
    action_type: action, dispute_id: dispute.id, paypal_dispute_id: dispute.paypal_dispute_id,
    amount_cents: dispute.amount_cents, currency: dispute.currency,
    evidence_ids: evidence.map(e => e.id), notes: draft?.draft_text || 'Seller accepted buyer claim.',
    timestamp: dispute.updated_at, draft_id: draft?.id || null,
    response_deadline: dispute.response_deadline, provider_payload: payload,
  };
  // Evidence edits with recomputed hashes also invalidate the reviewed digest.
  const snapshot_digest = calculateSha256(JSON.stringify({ snapshot, draft, evidence, status: dispute.status }));
  return { snapshot_digest, snapshot };
}

export function reviewAction(id: string, action: ApprovalAction): ApprovalReview {
  const dispute = requireDispute(id);
  paypalClient.assertMerchantAccess();
  const existing = operationFor(id);
  if (existing) return { snapshot_digest: existing.snapshot_digest, snapshot: JSON.parse(existing.snapshot), operation: { id: existing.id, state: existing.state } };
  return getDb().transaction(() => buildReview(dispute, action))();
}

function operationResult(operation: Operation) {
  if (operation.state === 'SUCCEEDED') return { status: 200, body: JSON.parse(operation.response!) };
  return {
    status: operation.state === 'SUBMITTING' ? 202 : 409,
    body: { approval_id: operation.id, state: operation.state, success: false,
      message: operation.state === 'SUBMITTING' ? 'Submission is in progress. Refresh to check its status; do not start another action.' : 'Provider outcome is uncertain. Reconcile with PayPal before any further action.',
    },
  };
}

export async function executeApproval(id: string, action: ApprovalAction, digest: string) {
  const db = getDb();
  requireDispute(id);
  paypalClient.assertMerchantAccess();
  const reserved = db.transaction(() => {
    const existing = operationFor(id);
    if (existing) {
      if (existing.snapshot_digest !== digest || existing.action_type !== action) throw new HttpError(409, 'Another action has already been reserved for this dispute.');
      return { operation: existing, fresh: false };
    }
    const review = buildReview(requireDispute(id), action);
    if (review.snapshot_digest !== digest) throw new HttpError(409, 'The draft, evidence, or dispute changed. Review the action again.');
    const operationId = 'app_' + crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const approver = merchantScope().user!.id;
    db.prepare(`INSERT INTO approval_operations(id,dispute_id,action_type,snapshot_digest,snapshot,approver,idempotency_key,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'SUBMITTING',?,?)`).run(operationId,id,action,digest,JSON.stringify(review.snapshot),approver,operationId,now,now);
    if (review.snapshot.draft_id) db.prepare(`INSERT INTO approvals(id,draft_id,dispute_id,approver,exact_action_snapshot,decision,idempotency_key,created_at)
      VALUES(?,?,?,?,?,'APPROVED',?,?)`).run(operationId,review.snapshot.draft_id,id,approver,JSON.stringify(review.snapshot),operationId,now);
    recordAuditLog('user','HUMAN_APPROVAL_GRANTED',{ approval_id: operationId, approver, action_type: action, snapshot_digest: digest },id);
    return { operation: operationFor(id)!, fresh: true };
  }).immediate();
  if (!reserved.fresh) return operationResult(reserved.operation);
  const operation = reserved.operation;
  const snapshot = JSON.parse(operation.snapshot) as ApprovalReview['snapshot'];
  try {
    let result;
    switch (action) {
      case 'PROVIDE_EVIDENCE': result = await paypalClient.provideEvidence(id,snapshot,operation.idempotency_key); break;
      case 'ACCEPT_CLAIM': result = await paypalClient.acceptClaim(id,snapshot,operation.idempotency_key); break;
    }
    if (!result.success) throw new Error('Provider did not acknowledge the operation.');
    const body = db.transaction(() => {
      const now = new Date().toISOString();
      // Acknowledgement is not final resolution and cannot overwrite a newer webhook.
      db.prepare("UPDATE disputes SET status='UNDER_REVIEW',updated_at=? WHERE id=? AND status='REQUIRED_ACTION' AND updated_at=?")
        .run(now,id,snapshot.timestamp);
      const response = { success: true, approval_id: operation.id, state: 'SUCCEEDED', dispute: requireDispute(id), paypal_result: result };
      db.prepare("UPDATE approval_operations SET state='SUCCEEDED',response=?,executed_at=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(response),now,now,operation.id);
      db.prepare('UPDATE approvals SET executed_at=? WHERE id=?').run(now,operation.id);
      recordAuditLog('system','APPROVAL_EXECUTION_ACKNOWLEDGED',{ approval_id: operation.id, snapshot_digest: digest },id);
      return response;
    }).immediate();
    // A notification failure must not reclassify an acknowledged payment operation.
    try { realtimeHub.publish('ACTION_APPROVED',body); }
    catch { console.error('Unable to publish approval notification:', operation.id); }
    return { status: 200, body };
  } catch {
    // An exception is not proof the provider did nothing. Never automatically resubmit.
    db.prepare("UPDATE approval_operations SET state='UNCERTAIN',updated_at=? WHERE id=? AND state='SUBMITTING'")
      .run(new Date().toISOString(),operation.id);
    recordAuditLog('system','APPROVAL_EXECUTION_UNCERTAIN',{ approval_id: operation.id },id);
    return operationResult(operationFor(id)!);
  }
}
