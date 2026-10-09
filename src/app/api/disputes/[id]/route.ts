import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { Dispute, EvidenceItem, AIDraft, Approval, AuditLogEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const disputeId = params.id;

  const dispute = db.prepare(`SELECT * FROM disputes WHERE id = ? OR paypal_dispute_id = ?`).get(disputeId, disputeId) as Dispute | undefined;

  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
  }

  // Load evidence items
  const evidenceItems = db.prepare(`
    SELECT * FROM evidence_items
    WHERE dispute_id = ? OR order_id = ?
    ORDER BY captured_at ASC
  `).all(dispute.id, dispute.order_id || '') as EvidenceItem[];

  // Load latest AI draft
  const draftRow = db.prepare(`
    SELECT * FROM ai_drafts
    WHERE dispute_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(dispute.id) as any;

  let draft: AIDraft | null = null;
  if (draftRow) {
    draft = {
      id: draftRow.id,
      dispute_id: draftRow.dispute_id,
      classification: draftRow.classification,
      draft_text: draftRow.draft_text,
      claims: JSON.parse(draftRow.claims || '[]'),
      schema_valid: Boolean(draftRow.schema_valid),
      model_name: draftRow.model_name,
      verified: Boolean(draftRow.verified),
      verification_errors: draftRow.verification_errors ? JSON.parse(draftRow.verification_errors) : undefined,
      created_at: draftRow.created_at,
    };
  }

  // Load approvals
  const approval = db.prepare(`
    SELECT * FROM approvals
    WHERE dispute_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(dispute.id) as any;

  // Load audit trail
  const auditLogs = db.prepare(`
    SELECT * FROM audit_log
    WHERE dispute_id = ? OR dispute_id IS NULL
    ORDER BY created_at ASC
  `).all(dispute.id) as any[];

  const formattedAudit: AuditLogEntry[] = auditLogs.map((a) => ({
    id: a.id,
    dispute_id: a.dispute_id,
    actor: a.actor,
    action: a.action,
    detail: JSON.parse(a.detail || '{}'),
    sha256_hash: a.sha256_hash,
    created_at: a.created_at,
  }));

  // Load order if linked
  let order = null;
  if (dispute.order_id) {
    order = db.prepare('SELECT * FROM demo_orders WHERE id = ?').get(dispute.order_id);
  }

  return NextResponse.json({
    dispute,
    evidenceItems,
    draft,
    approval: approval ? {
      ...approval,
      exact_action_snapshot: JSON.parse(approval.exact_action_snapshot || '{}'),
    } : null,
    auditLogs: formattedAudit,
    order,
  });
}
