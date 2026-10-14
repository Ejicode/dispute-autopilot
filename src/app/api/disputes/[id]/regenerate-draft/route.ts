import { NextRequest, NextResponse } from 'next/server';
import { HttpError, withMerchant } from '@/lib/auth/session';
import { readAuthBody } from '@/lib/auth/validation';
import { getDb } from '@/lib/db';
import { generateDeterministicDraft, persistCitedDraft } from '@/lib/ai/drafter';
import { realtimeHub } from '@/lib/realtime/hub';
import type { Dispute, EvidenceItem } from '@/lib/types';

export const dynamic = 'force-dynamic';
async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await readAuthBody(req);
  if (Object.keys(body).length) throw new HttpError(400, 'Regeneration accepts an empty object.');
  const db = getDb();
  const draft = db.transaction(() => {
    const dispute = db.prepare('SELECT * FROM disputes WHERE id=?').get(params.id) as Dispute | undefined;
    if (!dispute) throw new HttpError(404, 'Dispute not found.');
    if (dispute.status !== 'REQUIRED_ACTION' ||
        db.prepare('SELECT id FROM approval_operations WHERE dispute_id=?').get(dispute.id) ||
        db.prepare("SELECT id FROM approvals WHERE dispute_id=? AND decision='APPROVED'").get(dispute.id)) {
      throw new HttpError(409, 'An active, unsubmitted dispute is required to regenerate a draft.');
    }
    const evidence = db.prepare('SELECT * FROM evidence_items WHERE dispute_id=? OR order_id=? ORDER BY id')
      .all(dispute.id, dispute.order_id || '') as EvidenceItem[];
    return persistCitedDraft(dispute, evidence, generateDeterministicDraft(dispute, evidence), false);
  }).immediate();
  try { realtimeHub.publish('DRAFT_GENERATED', draft); }
  catch { console.error('Unable to publish regenerated draft notification.'); }
  return NextResponse.json({ draft }, { status: 201 });
}
export const POST = withMerchant(handlePOST);
