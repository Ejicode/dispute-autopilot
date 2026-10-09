import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { Dispute, EvidenceItem } from '@/lib/types';
import { generateDisputePdfPacket } from '@/lib/vault/packet';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const disputeId = params.id;

  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ? OR paypal_dispute_id = ?').get(disputeId, disputeId) as Dispute | undefined;
  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
  }

  const evidenceItems = db.prepare(`
    SELECT * FROM evidence_items
    WHERE dispute_id = ? OR order_id = ?
    ORDER BY captured_at ASC
  `).all(dispute.id, dispute.order_id || '') as EvidenceItem[];

  try {
    const pdfBytes = await generateDisputePdfPacket(dispute, evidenceItems);

    return new Response(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="evidence-packet-${dispute.paypal_dispute_id}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error('Failed to generate PDF packet:', err);
    return NextResponse.json({ error: 'Failed to generate PDF packet: ' + err.message }, { status: 500 });
  }
}
