import { requireDemo } from '@/lib/runtime/safety';
import { HttpError, withMerchant } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb, recordAuditLog } from '@/lib/db';
import { addToVault } from '@/lib/vault/vault';
import { generateTrackingNumber } from '@/lib/carrier/simulator';
import { realtimeHub } from '@/lib/realtime/hub';
import { DemoOrder, EvidenceItem } from '@/lib/types';
import { readAuthBody, field } from '@/lib/auth/validation';
import { PRODUCTS } from '@/lib/storefront/catalog';

export const dynamic = 'force-dynamic';

async function handleGET() {
  const db = getDb();
  const orders = db.prepare('SELECT * FROM demo_orders ORDER BY created_at DESC LIMIT 20').all() as any[];
  const formatted: DemoOrder[] = orders.map((o) => ({
    ...o,
    items: JSON.parse(o.items || '[]'),
  }));

  return NextResponse.json({ orders: formatted });
}

async function handlePOST(req: NextRequest) {
  requireDemo();
  const db = getDb();
  const body = await readAuthBody(req, 32768);
  const buyerName = field(body, 'buyer_name', 160);
  const buyerEmail = field(body, 'buyer_email', 254);
  const shippingAddress = field(body, 'shipping_address', 1000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) throw new HttpError(400, 'Invalid buyer_email');
  if (body.currency !== undefined && body.currency !== 'USD') throw new HttpError(400, 'Only USD is supported');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw new HttpError(400, 'Supply 1 to 100 items');
  const quantities = new Map<string, number>();
  for (const item of body.items) {
    if (!item || typeof item !== 'object' || typeof item.sku !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new HttpError(400, 'Each item requires a catalog SKU and positive integer quantity');
    }
    quantities.set(item.sku, (quantities.get(item.sku) || 0) + item.quantity);
  }
  const items = [...quantities].map(([sku, quantity]) => {
    const product = PRODUCTS.find(product => product.sku === sku);
    if (!product || quantity > product.stock) throw new HttpError(400, 'Unknown SKU or quantity exceeds demo catalog stock');
    return { sku, quantity, name: product.name, unit_price_cents: product.price_cents };
  });
  const totalCents = items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);
  const carrier = body.carrier === undefined ? 'USPS' : field(body, 'carrier', 10);
  if (!['USPS', 'FEDEX', 'UPS'].includes(carrier)) throw new HttpError(400, 'Unsupported carrier');
  const orderId = 'ord_' + crypto.randomBytes(6).toString('hex');
  const orderNumber = 'ORD-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const currency = 'USD';
  const paypalOrderId = 'PAYPAL-ORD-' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const trackingNumber = generateTrackingNumber(carrier);
  const now = new Date().toISOString();

  const evidence: EvidenceItem[] = [];
  db.transaction(() => {
    db.prepare(`
      INSERT INTO demo_orders (
        id, order_number, buyer_name, buyer_email, shipping_address, items, total_cents, currency, paypal_order_id, carrier, tracking_number, delivery_status, delivered_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      orderNumber,
      buyerName,
      buyerEmail,
      shippingAddress,
      JSON.stringify(items),
      totalCents,
      currency,
      paypalOrderId,
      carrier,
      trackingNumber,
      'LABEL_CREATED',
      null,
      now
    );

    // 1. Evidence Vault: Order confirmation captured at payment time
    evidence.push(addToVault({
      publish: false,
      orderId,
      evidenceType: 'ORDER_CONFIRMATION',
      source: 'STOREFRONT_CHECKOUT_GATEWAY',
      title: `Order Invoice #${orderNumber}`,
      content: JSON.stringify({
        order_id: orderId,
        order_number: orderNumber,
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        shipping_address: shippingAddress,
        items,
        total_cents: totalCents,
        currency,
        paypal_order_id: paypalOrderId,
        paid_at: now,
      }, null, 2),
    }));

    // 2. Evidence Vault: Initial carrier label created
    evidence.push(addToVault({
      publish: false,
      orderId,
      evidenceType: 'TRACKING_HISTORY',
      source: 'CARRIER_SIMULATOR',
      title: `${carrier} Label Created — Awaiting Pickup`,
      content: JSON.stringify({
        carrier,
        tracking_number: trackingNumber,
        status: 'LABEL_CREATED',
        events: [
          {
            status: 'LABEL_CREATED',
            location: 'Merchant Fulfillment Center',
            description: `Shipment label created by merchant. ${carrier} awaiting package pickup.`,
            timestamp: now,
          },
        ],
        source: 'CARRIER_SIMULATOR',
      }, null, 2),
    }));

    // 3. Evidence Vault: Accepted terms & refund policy
    evidence.push(addToVault({
      publish: false,
      orderId,
      evidenceType: 'REFUND_POLICY',
      source: 'STOREFRONT_CHECKOUT',
      title: 'Customer Acknowledged Merchant Terms of Sale',
      content: `Buyer ${buyerName} (${buyerEmail}) acknowledged merchant return policy, 30-day inspection window, and signature requirements at time of checkout on ${now}.`,
    }));

    recordAuditLog('system', 'ORDER_CAPTURED_AND_VAULTED', {
      order_id: orderId,
      order_number: orderNumber,
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      total_cents: totalCents,
      tracking_number: trackingNumber,
    });

  }).immediate();

  const createdOrder: DemoOrder = {
    provenance: 'DEMO',
    id: orderId,
    order_number: orderNumber,
    buyer_name: buyerName,
    buyer_email: buyerEmail,
    shipping_address: shippingAddress,
    items,
    total_cents: totalCents,
    currency,
    paypal_order_id: paypalOrderId,
    carrier,
    tracking_number: trackingNumber,
    delivery_status: 'LABEL_CREATED',
    delivered_at: null,
    created_at: now,
  };

  for (const item of evidence) realtimeHub.publish('VAULT_ITEM_ADDED', item);
  realtimeHub.publish('ORDER_CAPTURED', createdOrder);

  return NextResponse.json({ order: createdOrder, success: true });
}

export const GET = withMerchant(handleGET);

export const POST = withMerchant(handlePOST);
