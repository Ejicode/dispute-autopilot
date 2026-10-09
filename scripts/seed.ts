import crypto from 'crypto';
import { getDb, recordAuditLog } from '../src/lib/db';
import { addToVault } from '../src/lib/vault/vault';
import { calculateEvidenceStrength } from '../src/lib/ai/triage';
import { generateCitedDraft } from '../src/lib/ai/drafter';
import { Dispute } from '../src/lib/types';

async function seed() {
  console.log('Seeding Dispute Autopilot database with realistic demo data...');
  const db = getDb();

  // Clear existing demo tables
  db.exec(`
    DELETE FROM approvals;
    DELETE FROM ai_drafts;
    DELETE FROM evidence_items;
    DELETE FROM disputes;
    DELETE FROM demo_orders;
    DELETE FROM paypal_events;
    DELETE FROM audit_log;
  `);

  const now = new Date();

  // 1. Seed Demo Order 1 (High Value Tech Gadget)
  const order1Id = 'ord_101';
  const order1Number = 'ORD-2026-98214';
  const tracking1 = 'TRK-98214-USPS';
  db.prepare(`
    INSERT INTO demo_orders (
      id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency, paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order1Id,
    order1Number,
    'Jordan Miller',
    'jordan.miller@example.com',
    '742 Evergreen Terrace, Springfield, OR 97477',
    JSON.stringify([
      { name: 'UltraHD 4K Drone Pro', quantity: 1, unit_price_cents: 124000, sku: 'DRONE-4K-PRO' }
    ]),
    124000,
    'USD',
    'PP-ORDER-98214',
    'USPS',
    tracking1,
    'DELIVERED',
    new Date(now.getTime() - 4 * 86400000).toISOString(),
    new Date(now.getTime() - 7 * 86400000).toISOString()
  );

  // Vault Items for Order 1 (Captured at payment & carrier events)
  addToVault({
    orderId: order1Id,
    evidenceType: 'ORDER_CONFIRMATION',
    source: 'STOREFRONT_GATEWAY',
    title: 'Itemized Order Confirmation & Payment Receipt',
    content: JSON.stringify({
      order_number: order1Number,
      buyer_name: 'Jordan Miller',
      email: 'jordan.miller@example.com',
      shipping_address: '742 Evergreen Terrace, Springfield, OR 97477',
      total_cents: 124000,
      currency: 'USD',
      payment_method: 'PayPal Express Checkout',
      transaction_id: '9XY88192031124',
      sku: 'DRONE-4K-PRO',
      timestamp: new Date(now.getTime() - 7 * 86400000).toISOString(),
    }, null, 2),
  });

  addToVault({
    orderId: order1Id,
    evidenceType: 'TRACKING_HISTORY',
    source: 'CARRIER_SIMULATOR',
    title: 'Carrier Shipment Tracking Log (USPS)',
    content: JSON.stringify({
      carrier: 'USPS Priority Mail Express',
      tracking_number: tracking1,
      status: 'DELIVERED',
      events: [
        { status: 'LABEL_CREATED', timestamp: new Date(now.getTime() - 6 * 86400000).toISOString(), location: 'Portland, OR' },
        { status: 'PICKED_UP', timestamp: new Date(now.getTime() - 5.8 * 86400000).toISOString(), location: 'Portland, OR' },
        { status: 'IN_TRANSIT', timestamp: new Date(now.getTime() - 5 * 86400000).toISOString(), location: 'Eugene Sorting Hub, OR' },
        { status: 'OUT_FOR_DELIVERY', timestamp: new Date(now.getTime() - 4.2 * 86400000).toISOString(), location: 'Springfield, OR' },
        { status: 'DELIVERED', timestamp: new Date(now.getTime() - 4 * 86400000).toISOString(), location: 'Springfield, OR', signed_by: 'J. MILLER' },
      ],
      label: 'DEMO DATA - CARRIER SIMULATOR',
    }, null, 2),
  });

  addToVault({
    orderId: order1Id,
    evidenceType: 'PROOF_OF_DELIVERY',
    source: 'CARRIER_SIMULATOR',
    title: 'Carrier Electronic Proof of Delivery & Signature',
    content: JSON.stringify({
      carrier: 'USPS Priority Mail Express',
      tracking_number: tracking1,
      delivery_address: '742 Evergreen Terrace, Springfield, OR 97477',
      delivered_at: new Date(now.getTime() - 4 * 86400000).toISOString(),
      recipient_signature: 'J. MILLER (SIGNATURE_VERIFIED)',
      gps_coordinates: '44.0462° N, 123.0220° W',
      label: 'DEMO DATA - CARRIER SIMULATOR',
    }, null, 2),
  });

  addToVault({
    orderId: order1Id,
    evidenceType: 'REFUND_POLICY',
    source: 'STOREFRONT_TERMS',
    title: 'Merchant Terms of Sale & Fulfillment Policy',
    content: 'All orders over $750 require adult signature confirmation. Tracking details automatically transmitted to customer email upon carrier intake.',
  });

  // Dispute 1 (The Video Hero Case: $1,240 at risk, expiring in 36 hours)
  const dispute1Id = 'dsp_hero_1240';
  const dispute1: Dispute = {
    id: dispute1Id,
    paypal_dispute_id: 'PP-D-99214',
    transaction_id: '9XY88192031124',
    order_id: order1Id,
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    amount_cents: 124000,
    currency: 'USD',
    status: 'REQUIRED_ACTION',
    response_deadline: new Date(now.getTime() + 36 * 3600 * 1000).toISOString(),
    outcome: 'PENDING',
    strength_score: 100,
    recommendation: 'FIGHT',
    created_at: new Date(now.getTime() - 12 * 3600 * 1000).toISOString(),
    updated_at: new Date(now.getTime() - 12 * 3600 * 1000).toISOString(),
  };

  db.prepare(`
    INSERT INTO disputes (
      id, paypal_dispute_id, transaction_id, order_id, reason, amount_cents, currency, status, response_deadline, outcome, strength_score, recommendation, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dispute1.id,
    dispute1.paypal_dispute_id,
    dispute1.transaction_id,
    dispute1.order_id,
    dispute1.reason,
    dispute1.amount_cents,
    dispute1.currency,
    dispute1.status,
    dispute1.response_deadline,
    dispute1.outcome,
    dispute1.strength_score,
    dispute1.recommendation,
    dispute1.created_at,
    dispute1.updated_at
  );

  // Link Order 1 evidence to Dispute 1
  db.prepare(`UPDATE evidence_items SET dispute_id = ? WHERE order_id = ?`).run(dispute1Id, order1Id);

  // Generate Cited AI Draft for Dispute 1
  const evidence1 = db.prepare('SELECT * FROM evidence_items WHERE dispute_id = ?').all(dispute1Id) as any[];
  await generateCitedDraft(dispute1, evidence1, 'Buyer stated: "Package never arrived at my address. Requesting full refund."');

  recordAuditLog('paypal', 'DISPUTE_SYNCHRONIZED', {
    dispute_id: dispute1Id,
    paypal_dispute_id: dispute1.paypal_dispute_id,
    amount_cents: 124000,
    source: 'PAYPAL_SANDBOX_WEBHOOK',
  }, dispute1Id);

  // 2. Seed Dispute 2: $185.00 SNAD dispute expiring in 48 hours
  const order2Id = 'ord_102';
  const tracking2 = 'TRK-55219-FEDEX';
  db.prepare(`
    INSERT INTO demo_orders (
      id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency, paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    order2Id,
    'ORD-2026-55219',
    'Morgan Chen',
    'morgan.chen@example.com',
    '450 Mission St, San Francisco, CA 94105',
    JSON.stringify([{ name: 'Wireless Ergonomic Keyboard', quantity: 1, unit_price_cents: 18500, sku: 'KEY-ERG-01' }]),
    18500,
    'USD',
    'PP-ORDER-55219',
    'FedEx',
    tracking2,
    'DELIVERED',
    new Date(now.getTime() - 3 * 86400000).toISOString(),
    new Date(now.getTime() - 6 * 86400000).toISOString()
  );

  addToVault({
    orderId: order2Id,
    evidenceType: 'ORDER_CONFIRMATION',
    source: 'STOREFRONT_GATEWAY',
    title: 'Keyboard Purchase Invoice',
    content: JSON.stringify({
      order_number: 'ORD-2026-55219',
      buyer_name: 'Morgan Chen',
      amount_cents: 18500,
      currency: 'USD',
      shipping_address: '450 Mission St, San Francisco, CA 94105',
    }),
  });

  addToVault({
    orderId: order2Id,
    evidenceType: 'REFUND_POLICY',
    source: 'STOREFRONT_TERMS',
    title: 'Hardware Return Guidelines',
    content: 'Items must be returned in original packaging with serial number intact.',
  });

  const dispute2Id = 'dsp_snad_185';
  const dispute2: Dispute = {
    id: dispute2Id,
    paypal_dispute_id: 'PP-D-55219',
    transaction_id: '8TY441992010',
    order_id: order2Id,
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    amount_cents: 18500,
    currency: 'USD',
    status: 'REQUIRED_ACTION',
    response_deadline: new Date(now.getTime() + 44 * 3600 * 1000).toISOString(),
    outcome: 'PENDING',
    strength_score: 80,
    recommendation: 'FIGHT',
    created_at: new Date(now.getTime() - 8 * 3600 * 1000).toISOString(),
    updated_at: new Date(now.getTime() - 8 * 3600 * 1000).toISOString(),
  };

  db.prepare(`
    INSERT INTO disputes (
      id, paypal_dispute_id, transaction_id, order_id, reason, amount_cents, currency, status, response_deadline, outcome, strength_score, recommendation, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dispute2.id,
    dispute2.paypal_dispute_id,
    dispute2.transaction_id,
    dispute2.order_id,
    dispute2.reason,
    dispute2.amount_cents,
    dispute2.currency,
    dispute2.status,
    dispute2.response_deadline,
    dispute2.outcome,
    dispute2.strength_score,
    dispute2.recommendation,
    dispute2.created_at,
    dispute2.updated_at
  );

  db.prepare(`UPDATE evidence_items SET dispute_id = ? WHERE order_id = ?`).run(dispute2Id, order2Id);
  const evidence2 = db.prepare('SELECT * FROM evidence_items WHERE dispute_id = ?').all(dispute2Id) as any[];
  await generateCitedDraft(dispute2, evidence2, 'Buyer stated: "Keycaps feel slightly different from what I expected."');

  console.log('✓ Seeding complete: 2 active disputes, 2 orders, 6 vault items created.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
