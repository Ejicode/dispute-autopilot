import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb, recordAuditLog } from '@/lib/db';
import { Dispute } from '@/lib/types';
import { addToVault, getVaultEvidenceForDispute, linkOrderEvidenceToDispute } from '@/lib/vault/vault';
import { calculateEvidenceStrength } from '@/lib/ai/triage';
import { generateCitedDraft } from '@/lib/ai/drafter';
import { realtimeHub } from '@/lib/realtime/hub';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM disputes
    ORDER BY
      CASE status
        WHEN 'REQUIRED_ACTION' THEN 1
        WHEN 'UNDER_REVIEW' THEN 2
        ELSE 3
      END,
      amount_cents DESC,
      response_deadline ASC
  `).all() as Dispute[];

  // Calculate high-level banner metrics
  const now = Date.now();
  const in48Hours = now + 48 * 3600 * 1000;

  let totalAtRiskCents = 0;
  let expiring48hCount = 0;
  let requiredActionCount = 0;

  for (const d of rows) {
    if (d.status === 'REQUIRED_ACTION' || d.status === 'UNDER_REVIEW') {
      totalAtRiskCents += d.amount_cents;
      requiredActionCount++;
      const deadlineMs = new Date(d.response_deadline).getTime();
      if (deadlineMs <= in48Hours && deadlineMs >= now) {
        expiring48hCount++;
      }
    }
  }

  return NextResponse.json({
    disputes: rows,
    metrics: {
      totalAtRiskCents,
      expiring48hCount,
      requiredActionCount,
      totalCount: rows.length,
    },
  });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => ({}));

  const disputeId = 'dsp_' + crypto.randomBytes(8).toString('hex');
  const paypalDisputeId = body.paypal_dispute_id || ('PP-D-' + Math.floor(10000 + Math.random() * 90000));
  const transactionId = body.transaction_id || ('TXN-' + Math.floor(100000 + Math.random() * 900000));
  const orderId = body.order_id || null;
  const reason = body.reason || 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
  const amountCents = body.amount_cents || 12000;
  const currency = body.currency || 'USD';
  const hoursLeft = body.hours_until_deadline || 36;
  const deadline = new Date(Date.now() + hoursLeft * 3600 * 1000).toISOString();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO disputes (
      id, paypal_dispute_id, transaction_id, order_id, reason, amount_cents, currency, status, response_deadline, outcome, strength_score, recommendation, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    disputeId,
    paypalDisputeId,
    transactionId,
    orderId,
    reason,
    amountCents,
    currency,
    'REQUIRED_ACTION',
    deadline,
    'PENDING',
    0,
    'ASK A HUMAN',
    now,
    now
  );

  // Link existing order vault items if orderId is provided
  if (orderId) {
    linkOrderEvidenceToDispute(orderId, disputeId);
  } else {
    // Generate base transaction confirmation evidence in vault
    addToVault({
      disputeId,
      evidenceType: 'ORDER_CONFIRMATION',
      source: 'STOREFRONT_CHECKOUT',
      title: `Checkout Receipt for ${transactionId}`,
      content: JSON.stringify({
        transaction_id: transactionId,
        amount_cents: amountCents,
        currency,
        buyer_name: body.buyer_name || 'Sandbox Customer',
        shipping_address: body.shipping_address || '123 Market St, San Jose, CA 95113',
        created_at: now,
      }),
    });
  }

  const evidenceItems = getVaultEvidenceForDispute(disputeId);
  const triage = calculateEvidenceStrength(reason, evidenceItems);

  db.prepare(`
    UPDATE disputes
    SET strength_score = ?, recommendation = ?
    WHERE id = ?
  `).run(triage.score, triage.recommendation, disputeId);

  const updated = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as Dispute;

  // Generate cited AI draft
  const draft = await generateCitedDraft(updated, evidenceItems, body.buyer_message || 'Customer opened dispute');

  recordAuditLog('paypal', 'DISPUTE_SIMULATED_OPENED', {
    dispute_id: disputeId,
    paypal_dispute_id: paypalDisputeId,
    amount_cents: amountCents,
    reason,
  }, disputeId);

  realtimeHub.publish('DISPUTE_OPENED', updated);

  return NextResponse.json({ dispute: updated, draft, evidenceCount: evidenceItems.length });
}
