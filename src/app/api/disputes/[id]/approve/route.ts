import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb, recordAuditLog } from '@/lib/db';
import { Dispute, ExactActionSnapshot } from '@/lib/types';
import { paypalClient } from '@/lib/paypal/client';
import { realtimeHub } from '@/lib/realtime/hub';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const disputeId = params.id;
  const body = await req.json().catch(() => ({}));

  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as Dispute | undefined;
  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
  }

  // 1. Policy Gate: Check Response Deadline
  const nowMs = Date.now();
  const deadlineMs = new Date(dispute.response_deadline).getTime();
  if (deadlineMs < nowMs) {
    recordAuditLog('user', 'APPROVAL_REJECTED_EXPIRED_DEADLINE', {
      dispute_id: disputeId,
      deadline: dispute.response_deadline,
    }, disputeId);
    return NextResponse.json({ error: 'Policy Violation: Dispute response deadline has already expired' }, { status: 400 });
  }

  // 2. Policy Gate: Check AI Draft & Verified Status
  const draftRow = db.prepare('SELECT * FROM ai_drafts WHERE dispute_id = ? ORDER BY created_at DESC LIMIT 1').get(disputeId) as any;
  if (!draftRow) {
    return NextResponse.json({ error: 'No response draft exists for this dispute' }, { status: 400 });
  }

  if (body.action_type === 'PROVIDE_EVIDENCE' && !draftRow.verified) {
    const errors = draftRow.verification_errors ? JSON.parse(draftRow.verification_errors) : ['Unverified claims'];
    recordAuditLog('user', 'APPROVAL_BLOCKED_UNVERIFIED_CLAIMS', {
      dispute_id: disputeId,
      draft_id: draftRow.id,
      errors,
    }, disputeId);
    return NextResponse.json(
      {
        error: 'APPROVAL BLOCKED: Code verifier detected unverified factual claims against the vault.',
        details: errors,
      },
      { status: 422 }
    );
  }

  // 3. Policy Gate: Monetary Amount Verification
  if (body.amount_cents !== undefined && body.amount_cents !== dispute.amount_cents) {
    recordAuditLog('user', 'APPROVAL_BLOCKED_AMOUNT_TAMPERING', {
      claimed_cents: body.amount_cents,
      expected_cents: dispute.amount_cents,
    }, disputeId);
    return NextResponse.json(
      { error: 'Security Violation: Tampered approval amount does not match dispute amount' },
      { status: 422 }
    );
  }

  // 4. Idempotency Key Validation
  const idempotencyKey = body.idempotency_key || ('IDEM-' + crypto.randomBytes(8).toString('hex'));
  const existingApproval = db.prepare('SELECT id FROM approvals WHERE idempotency_key = ?').get(idempotencyKey);
  if (existingApproval) {
    return NextResponse.json(
      { error: 'Duplicate request: Action with this idempotency key was already approved and executed' },
      { status: 409 }
    );
  }

  // Prepare Exact Action Snapshot
  const actionSnapshot: ExactActionSnapshot = {
    action_type: body.action_type || 'PROVIDE_EVIDENCE',
    dispute_id: dispute.id,
    paypal_dispute_id: dispute.paypal_dispute_id,
    amount_cents: dispute.amount_cents,
    currency: dispute.currency,
    evidence_ids: body.evidence_ids || [],
    notes: body.notes || draftRow.draft_text,
    timestamp: new Date().toISOString(),
  };

  const approvalId = 'app_' + crypto.randomBytes(8).toString('hex');
  const approver = body.approver || 'Merchant Admin (Owner)';

  try {
    // Record Approval in Database
    db.prepare(`
      INSERT INTO approvals (
        id, draft_id, dispute_id, approver, exact_action_snapshot, decision, idempotency_key, executed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      approvalId,
      draftRow.id,
      dispute.id,
      approver,
      JSON.stringify(actionSnapshot),
      'APPROVED',
      idempotencyKey,
      new Date().toISOString(),
      new Date().toISOString()
    );

    recordAuditLog('user', 'HUMAN_APPROVAL_GRANTED', {
      approval_id: approvalId,
      approver,
      action_type: actionSnapshot.action_type,
      idempotency_key: idempotencyKey,
    }, disputeId);

    // Execute with PayPal API
    let paypalResult;
    let newStatus = dispute.status;

    if (actionSnapshot.action_type === 'PROVIDE_EVIDENCE') {
      paypalResult = await paypalClient.provideEvidence(dispute.id, actionSnapshot, idempotencyKey);
      newStatus = 'UNDER_REVIEW';
    } else {
      paypalResult = await paypalClient.acceptClaim(dispute.id, actionSnapshot, idempotencyKey);
      newStatus = 'RESOLVED';
    }

    // Update dispute status
    db.prepare(`
      UPDATE disputes
      SET status = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, new Date().toISOString(), dispute.id);

    const updatedDispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(dispute.id) as Dispute;

    recordAuditLog('system', 'DISPUTE_STATUS_UPDATED', {
      dispute_id: dispute.id,
      previous_status: dispute.status,
      new_status: newStatus,
      paypal_response: paypalResult.result,
    }, dispute.id);

    realtimeHub.publish('ACTION_APPROVED', {
      dispute: updatedDispute,
      approval_id: approvalId,
      action: actionSnapshot,
      paypal_result: paypalResult,
    });

    return NextResponse.json({
      success: true,
      approval_id: approvalId,
      dispute: updatedDispute,
      paypal_result: paypalResult,
    });
  } catch (err: any) {
    console.error('Approval execution error:', err);
    recordAuditLog('system', 'APPROVAL_EXECUTION_FAILED', { error: err.message }, disputeId);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
