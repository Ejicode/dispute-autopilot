import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb, recordAuditLog } from '@/lib/db';
import { addToVault } from '@/lib/vault/vault';
import { generateTrackingNumber } from '@/lib/carrier/simulator';
import { realtimeHub } from '@/lib/realtime/hub';
import { DemoOrder } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const orders = db.prepare('SELECT * FROM demo_orders ORDER BY created_at DESC LIMIT 20').all() as any[];
  const formatted: DemoOrder[] = orders.map((o) => ({
    ...o,
    items: JSON.parse(o.items || '[]'),
  }));

  return NextResponse.json({ orders: formatted });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => ({}));

  // Buyer details are required — no fake defaults
  const buyerName = (body.buyer_name || '').trim();
  const buyerEmail = (body.buyer_email || '').trim();
  const shippingAddress = (body.shipping_address || '').trim();

  if (!buyerName || !buyerEmail) {
    return NextResponse.json(
      { error: 'buyer_name and buyer_email are required to place an order.' },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return NextResponse.json(
      { error: 'buyer_email must be a valid email address.' },
      { status: 400 }
    );
  }

  if (!shippingAddress) {
    return NextResponse.json(
      { error: 'shipping_address is required to place an order.' },
      { status: 400 }
    );
  }

  const items = body.items;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: 'At least one item is required to place an order.' },
      { status: 400 }
    );
  }

  const totalCents = items.reduce((sum: number, it: any) => sum + (it.unit_price_cents * it.quantity), 0);
  if (totalCents <= 0) {
    return NextResponse.json(
      { error: 'Order total must be greater than zero.' },
      { status: 400 }
    );
  }

  const orderId = 'ord_' + crypto.randomBytes(6).toString('hex');
  const orderNumber = 'ORD-' + Math.floor(10000 + Math.random() * 90000);
  const currency = body.currency || 'USD';
  const paypalOrderId = 'PAYPAL-ORD-' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const carrier = body.carrier || 'USPS';
  const trackingNumber = generateTrackingNumber(carrier);
  const now = new Date().toISOString();

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
  addToVault({
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
  });

  // 2. Evidence Vault: Initial carrier label created
  addToVault({
    orderId,
    evidenceType: 'TRACKING_HISTORY',
    source: 'CARRIER_INTEGRATION',
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
      source: 'CARRIER_INTEGRATION',
    }, null, 2),
  });

  // 3. Evidence Vault: Accepted terms & refund policy
  addToVault({
    orderId,
    evidenceType: 'REFUND_POLICY',
    source: 'STOREFRONT_CHECKOUT',
    title: 'Customer Acknowledged Merchant Terms of Sale',
    content: `Buyer ${buyerName} (${buyerEmail}) acknowledged merchant return policy, 30-day inspection window, and signature requirements at time of checkout on ${now}.`,
  });

  recordAuditLog('system', 'ORDER_CAPTURED_AND_VAULTED', {
    order_id: orderId,
    order_number: orderNumber,
    buyer_name: buyerName,
    buyer_email: buyerEmail,
    total_cents: totalCents,
    tracking_number: trackingNumber,
  });

  const createdOrder: DemoOrder = {
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

  realtimeHub.publish('ORDER_CAPTURED', createdOrder);

  return NextResponse.json({ order: createdOrder, success: true });
}
