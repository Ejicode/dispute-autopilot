import crypto from 'crypto';
import { getDb, recordAuditLog } from '../db';
import { paypalClient } from './client';
import { Dispute, PayPalWebhookEvent } from '../types';
import { addToVault, getVaultEvidenceForDispute, linkOrderEvidenceToDispute } from '../vault/vault';
import { calculateEvidenceStrength } from '../ai/triage';
import { generateCitedDraft } from '../ai/drafter';
import { realtimeHub } from '../realtime/hub';

export interface WebhookProcessingResult {
  status: 'PROCESSED' | 'DUPLICATE' | 'INVALID_SIGNATURE' | 'ERROR';
  statusCode: number;
  message: string;
  disputeId?: string;
}

export async function processPayPalWebhook(
  headers: {
    authAlgo?: string;
    certUrl?: string;
    transmissionId?: string;
    transmissionSig?: string;
    transmissionTime?: string;
  },
  body: PayPalWebhookEvent
): Promise<WebhookProcessingResult> {
  const db = getDb();
  const eventId = body.id;

  if (!eventId) {
    return { status: 'ERROR', statusCode: 400, message: 'Missing event ID' };
  }

  // 1. Signature Verification
  const isSignatureValid = await paypalClient.verifyWebhookSignature({
    authAlgo: headers.authAlgo || 'SHA256withRSA',
    certUrl: headers.certUrl || 'https://api.sandbox.paypal.com/cert.pem',
    transmissionId: headers.transmissionId || '',
    transmissionSig: headers.transmissionSig || '',
    transmissionTime: headers.transmissionTime || '',
    webhookId: process.env.PAYPAL_WEBHOOK_ID || 'DEFAULT_WEBHOOK',
    webhookEvent: body,
  });

  if (!isSignatureValid) {
    recordAuditLog('paypal', 'WEBHOOK_SIGNATURE_VERIFICATION_FAILED', {
      event_id: eventId,
      transmission_id: headers.transmissionId,
    });
    return { status: 'INVALID_SIGNATURE', statusCode: 401, message: 'Invalid webhook signature' };
  }

  // 2. Event Deduplication Check (Rule: Duplicates do nothing)
  const existingEvent = db.prepare('SELECT id FROM paypal_events WHERE event_id = ?').get(eventId);
  if (existingEvent) {
    recordAuditLog('paypal', 'WEBHOOK_DUPLICATE_IGNORED', { event_id: eventId });
    return { status: 'DUPLICATE', statusCode: 200, message: 'Event already processed' };
  }

  // Record incoming event
  const internalEventId = 'evt_' + crypto.randomBytes(8).toString('hex');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO paypal_events (id, event_id, event_type, resource_type, summary, payload, status, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    internalEventId,
    eventId,
    body.event_type,
    body.resource_type,
    body.summary || '',
    JSON.stringify(body),
    'PROCESSED',
    now
  );

  recordAuditLog('paypal', 'WEBHOOK_EVENT_VERIFIED_AND_RECORDED', {
    event_id: eventId,
    event_type: body.event_type,
  });

  // 3. Handle specific dispute events
  try {
    if (body.event_type === 'CUSTOMER.DISPUTE.CREATED') {
      const dispute = await handleDisputeCreated(body.resource);
      return { status: 'PROCESSED', statusCode: 200, message: 'Dispute recorded and processed', disputeId: dispute.id };
    } else if (body.event_type === 'CUSTOMER.DISPUTE.RESOLVED') {
      await handleDisputeResolved(body.resource);
      return { status: 'PROCESSED', statusCode: 200, message: 'Dispute resolution recorded' };
    } else if (body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      await handlePaymentCaptured(body.resource);
      return { status: 'PROCESSED', statusCode: 200, message: 'Vault record created from capture' };
    }
  } catch (err: any) {
    console.error('Error handling webhook event:', err);
    return { status: 'ERROR', statusCode: 500, message: err.message };
  }

  return { status: 'PROCESSED', statusCode: 200, message: 'Event acknowledged' };
}

async function handleDisputeCreated(resource: Record<string, any>): Promise<Dispute> {
  const db = getDb();
  const disputeId = 'dsp_' + crypto.randomBytes(8).toString('hex');
  const paypalDisputeId = resource.dispute_id || ('PP-D-' + Math.floor(10000 + Math.random() * 90000));
  const transactionId = resource.disputed_transactions?.[0]?.seller_transaction_id || ('TXN-' + Math.floor(100000 + Math.random() * 900000));
  const reason = resource.reason || 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
  const amountStr = resource.dispute_amount?.value || '120.00';
  const amountCents = Math.round(parseFloat(amountStr) * 100);
  const currency = resource.dispute_amount?.currency_code || 'USD';
  const now = new Date();
  const deadline = resource.seller_response_due_date || new Date(now.getTime() + 48 * 3600 * 1000).toISOString();

  // Check if an order matches the transaction or order_id
  const matchingOrder = db.prepare(
    'SELECT * FROM demo_orders WHERE paypal_order_id = ? OR id = ? OR order_number = ?'
  ).get(transactionId, resource.invoice_id || '', resource.invoice_id || '') as any;

  // Insert dispute row
  db.prepare(`
    INSERT INTO disputes (
      id, paypal_dispute_id, transaction_id, order_id, reason, amount_cents, currency, status, response_deadline, outcome, strength_score, recommendation, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    disputeId,
    paypalDisputeId,
    transactionId,
    matchingOrder?.id || null,
    reason,
    amountCents,
    currency,
    'REQUIRED_ACTION',
    deadline,
    'PENDING',
    0,
    'ASK A HUMAN',
    now.toISOString(),
    now.toISOString()
  );

  // Link vault items if order exists
  if (matchingOrder) {
    linkOrderEvidenceToDispute(matchingOrder.id, disputeId);
  } else {
    // If no order previously linked, generate standard policy & transaction vault evidence
    addToVault({
      disputeId,
      evidenceType: 'ORDER_CONFIRMATION',
      source: 'PAYPAL_TRANSACTION_GATEWAY',
      title: `Order Record for ${transactionId}`,
      content: JSON.stringify({
        transaction_id: transactionId,
        amount_cents: amountCents,
        currency,
        buyer_id: resource.buyer?.payer_id || 'PAYER-99182',
        created_at: now.toISOString(),
      }),
    });
  }

  // Load evidence
  const evidenceItems = getVaultEvidenceForDispute(disputeId);

  // Calculate Evidence Strength Score & Triage
  const triage = calculateEvidenceStrength(reason, evidenceItems);

  db.prepare(`
    UPDATE disputes
    SET strength_score = ?, recommendation = ?
    WHERE id = ?
  `).run(triage.score, triage.recommendation, disputeId);

  const updatedDispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId) as Dispute;

  // Generate cited AI draft
  const buyerMessage = resource.messages?.[0]?.content || 'Buyer opened dispute regarding item';
  await generateCitedDraft(updatedDispute, evidenceItems, buyerMessage);

  recordAuditLog('paypal', 'DISPUTE_SYNCHRONIZED', {
    dispute_id: disputeId,
    paypal_dispute_id: paypalDisputeId,
    reason,
    amount_cents: amountCents,
    strength_score: triage.score,
    recommendation: triage.recommendation,
  }, disputeId);

  realtimeHub.publish('DISPUTE_OPENED', updatedDispute);

  return updatedDispute;
}

async function handleDisputeResolved(resource: Record<string, any>): Promise<void> {
  const db = getDb();
  const paypalDisputeId = resource.dispute_id;
  const outcome = resource.dispute_outcome?.outcome_code || 'RESOLVED_SELLER_FAVOUR';

  db.prepare(`
    UPDATE disputes
    SET status = 'RESOLVED', outcome = ?, updated_at = ?
    WHERE paypal_dispute_id = ?
  `).run(outcome, new Date().toISOString(), paypalDisputeId);

  const dispute = db.prepare('SELECT * FROM disputes WHERE paypal_dispute_id = ?').get(paypalDisputeId) as Dispute | undefined;

  recordAuditLog('paypal', 'DISPUTE_RESOLVED_BY_WEBHOOK', {
    paypal_dispute_id: paypalDisputeId,
    outcome,
  }, dispute?.id || null);

  if (dispute) {
    realtimeHub.publish('PAYPAL_API_RESOLVED', { ...dispute, status: 'RESOLVED', outcome });
  }
}

async function handlePaymentCaptured(resource: Record<string, any>): Promise<void> {
  const captureId = resource.id;
  const amountCents = Math.round(parseFloat(resource.amount?.value || '0') * 100);
  const currency = resource.amount?.currency_code || 'USD';

  addToVault({
    evidenceType: 'ORDER_CONFIRMATION',
    source: 'PAYMENT_CAPTURE_WEBHOOK',
    title: `Payment Capture ${captureId}`,
    content: JSON.stringify({
      capture_id: captureId,
      amount_cents: amountCents,
      currency,
      status: resource.status,
      create_time: resource.create_time,
    }),
  });
}
