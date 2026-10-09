import { NextRequest, NextResponse } from 'next/server';
import { getDb, recordAuditLog } from '@/lib/db';
import { Dispute, EvidenceItem, Claim } from '@/lib/types';
import { verifyDraftClaims } from '@/lib/ai/verifier';
import { realtimeHub } from '@/lib/realtime/hub';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const disputeId = params.id;
  const body = await req.json().catch(() => ({}));

  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ? OR paypal_dispute_id = ?').get(disputeId, disputeId) as Dispute | undefined;
  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
  }

  const evidenceItems = db.prepare(`
    SELECT * FROM evidence_items
    WHERE dispute_id = ? OR order_id = ?
    ORDER BY captured_at ASC
  `).all(dispute.id, dispute.order_id || '') as EvidenceItem[];

  const draftRow = db.prepare('SELECT * FROM ai_drafts WHERE dispute_id = ? ORDER BY created_at DESC LIMIT 1').get(dispute.id) as any;
  if (!draftRow) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  const claims: Claim[] = body.claims || JSON.parse(draftRow.claims || '[]');
  const verification = verifyDraftClaims(claims, evidenceItems, dispute);

  // Update draft row with new verification state
  db.prepare(`
    UPDATE ai_drafts
    SET claims = ?, verified = ?, verification_errors = ?
    WHERE id = ?
  `).run(
    JSON.stringify(verification.verifiedClaims),
    verification.verified ? 1 : 0,
    verification.errors.length > 0 ? JSON.stringify(verification.errors) : null,
    draftRow.id
  );

  recordAuditLog('ai', 'DRAFT_CLAIMS_VERIFICATION_EVALUATED', {
    dispute_id: dispute.id,
    draft_id: draftRow.id,
    verified: verification.verified,
    errors_count: verification.errors.length,
    errors: verification.errors,
  }, dispute.id);

  realtimeHub.publish('CLAIM_VERIFIED', {
    dispute_id: dispute.id,
    draft_id: draftRow.id,
    verified: verification.verified,
    claims: verification.verifiedClaims,
    errors: verification.errors,
  });

  return NextResponse.json({
    verified: verification.verified,
    claims: verification.verifiedClaims,
    errors: verification.errors,
  });
}
