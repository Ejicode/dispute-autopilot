import { requireDemo } from '@/lib/runtime/safety';
import { HttpError, withMerchant } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb, recordAuditLog } from '@/lib/db';
import { Dispute, DisputeReason, EvidenceItem } from '@/lib/types';
import { addToVault, getVaultEvidenceForDispute, linkOrderEvidenceToDispute } from '@/lib/vault/vault';
import { calculateEvidenceStrength } from '@/lib/ai/triage';
import { generateDeterministicDraft, persistCitedDraft } from '@/lib/ai/drafter';
import { realtimeHub } from '@/lib/realtime/hub';

import { readAuthBody, field } from '@/lib/auth/validation';

export const dynamic = 'force-dynamic';

async function handleGET() {
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

async function handlePOST(req: NextRequest) {
  requireDemo();
  const db = getDb();
  const body = await readAuthBody(req, 16384);
  for (const key of ['paypal_dispute_id','transaction_id','order_id','buyer_name','shipping_address','buyer_message']) {
    if (body[key] !== undefined) body[key] = field(body, key, key === 'buyer_message' ? 4000 : 1000);
  }
  const reasons = ['MERCHANDISE_OR_SERVICE_NOT_RECEIVED','MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED','UNAUTHORISED','INCORRECT_AMOUNT','DUPLICATE_TRANSACTION','BUYER_CANCELLED_SERVICE','OTHER'];
  if (body.reason !== undefined && !reasons.includes(body.reason as string)) throw new HttpError(400, 'Invalid dispute reason');
  if (body.amount_cents !== undefined && (!Number.isSafeInteger(body.amount_cents) || Number(body.amount_cents) <= 0 || Number(body.amount_cents) > 100000000)) throw new HttpError(400, 'Invalid amount_cents');
  if (body.hours_until_deadline !== undefined && (typeof body.hours_until_deadline !== 'number' || !Number.isFinite(body.hours_until_deadline) || body.hours_until_deadline <= 0 || body.hours_until_deadline > 2160)) throw new HttpError(400, 'Invalid deadline');
  if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))) throw new HttpError(400, 'Invalid currency');

  const disputeId = 'dsp_' + crypto.randomBytes(8).toString('hex');
  const paypalDisputeId = body.paypal_dispute_id || ('PP-D-' + crypto.randomBytes(8).toString('hex'));
  const transactionId = body.transaction_id || ('TXN-' + crypto.randomBytes(8).toString('hex'));
  const orderId = body.order_id || null;
  if (orderId && !db.prepare('SELECT id FROM demo_orders WHERE id = ?').get(orderId)) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  const reason = (body.reason || 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED') as DisputeReason;
  const amountCents = body.amount_cents || 12000;
  const currency = body.currency || 'USD';
  const hoursLeft = Number(body.hours_until_deadline ?? 36);
  const deadline = new Date(Date.now() + hoursLeft * 3600 * 1000).toISOString();
  const now = new Date().toISOString();

  const events: EvidenceItem[] = [];
  const result = db.transaction(() => {
    if (db.prepare('SELECT id FROM disputes WHERE paypal_dispute_id=?').get(paypalDisputeId)) throw new HttpError(409, 'Dispute already exists');
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
      linkOrderEvidenceToDispute(orderId as string, disputeId);
    } else {
      // Generate base transaction confirmation evidence in vault
      events.push(addToVault({
        publish: false,
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
      }));
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
    const draft = persistCitedDraft(updated, evidenceItems, generateDeterministicDraft(updated, evidenceItems), false);

    recordAuditLog('paypal', 'DISPUTE_SIMULATED_OPENED', {
      dispute_id: disputeId,
      paypal_dispute_id: paypalDisputeId,
      amount_cents: amountCents,
      reason,
    }, disputeId);

    return { dispute: updated, draft, evidenceCount: evidenceItems.length };
  }).immediate();
  for (const item of events) realtimeHub.publish('VAULT_ITEM_ADDED', item);
  realtimeHub.publish('DRAFT_GENERATED', result.draft);
  realtimeHub.publish('DISPUTE_OPENED', result.dispute);
  return NextResponse.json(result);
}

export const GET = withMerchant(handleGET);

export const POST = withMerchant(handlePOST);
