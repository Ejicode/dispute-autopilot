import crypto from 'crypto';
import { getDb, recordAuditLog } from '../db';
import { addToVault } from '../vault/vault';
import { realtimeHub } from '../realtime/hub';

export interface CarrierMilestone {
  status: 'LABEL_CREATED' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
  location: string;
  description: string;
  timestamp: string;
  signed_by?: string;
}

export function generateTrackingNumber(carrier: string = 'USPS'): string {
  const num = Math.floor(100000000 + Math.random() * 900000000);
  return `TRK-${num}-${carrier}`;
}

// Carrier-realistic milestone descriptions
const MILESTONE_DESCRIPTIONS: Record<string, (carrier: string) => string> = {
  LABEL_CREATED: (carrier) => `Shipment label created by merchant. ${carrier} awaiting package pickup.`,
  PICKED_UP: (carrier) => `Package accepted at ${carrier} origin facility.`,
  IN_TRANSIT: (carrier) => `Package in transit through ${carrier} regional distribution network.`,
  OUT_FOR_DELIVERY: (carrier) => `Package loaded for delivery on ${carrier} route.`,
  DELIVERED: (carrier) => `Package delivered and confirmed by ${carrier} delivery agent.`,
};

const MILESTONE_LOCATIONS: Record<string, string> = {
  LABEL_CREATED: 'Merchant Fulfillment Center',
  PICKED_UP: 'Origin Post Office',
  IN_TRANSIT: 'Regional Distribution Hub',
  OUT_FOR_DELIVERY: 'Local Delivery Station',
  DELIVERED: 'Delivery Address — Front Door',
};

/**
 * Progress an order through carrier transit milestones.
 * All events are stored in the Evidence Vault with full chain-of-custody.
 */
export async function advanceCarrierStatus(
  orderId: string,
  targetStatus?: CarrierMilestone['status']
): Promise<{ order: any; newStatus: string }> {
  const db = getDb();
  const order = db.prepare('SELECT * FROM demo_orders WHERE id = ?').get(orderId) as any;
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const milestones: CarrierMilestone['status'][] = [
    'LABEL_CREATED',
    'PICKED_UP',
    'IN_TRANSIT',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
  ];

  const currentIndex = milestones.indexOf(order.delivery_status);
  const nextStatus = targetStatus || (currentIndex < milestones.length - 1 ? milestones[currentIndex + 1] : 'DELIVERED');
  const now = new Date().toISOString();
  const carrier = order.carrier || 'USPS';

  let deliveredAt = order.delivered_at;
  if (nextStatus === 'DELIVERED' && !deliveredAt) {
    deliveredAt = now;
  }

  db.prepare(`
    UPDATE demo_orders
    SET delivery_status = ?, delivered_at = ?
    WHERE id = ?
  `).run(nextStatus, deliveredAt, orderId);

  // Build carrier event with professional language
  const milestoneEvent = {
    status: nextStatus,
    location: MILESTONE_LOCATIONS[nextStatus] || 'In Transit',
    description: (MILESTONE_DESCRIPTIONS[nextStatus] || (() => `Status: ${nextStatus}`))(carrier),
    timestamp: now,
    ...(nextStatus === 'DELIVERED' ? {
      signed_by: `${order.buyer_name} — Signature Captured`,
      gps_verified: true,
    } : {}),
  };

  // Snapshot tracking history into vault
  const trackingPayload = {
    carrier,
    tracking_number: order.tracking_number,
    status: nextStatus,
    events: [milestoneEvent],
    delivered_at: deliveredAt,
    source: 'CARRIER_INTEGRATION',
  };

  addToVault({
    orderId,
    evidenceType: nextStatus === 'DELIVERED' ? 'PROOF_OF_DELIVERY' : 'TRACKING_HISTORY',
    source: 'CARRIER_INTEGRATION',
    title: `${carrier} Update: ${nextStatus.replace(/_/g, ' ')}`,
    content: JSON.stringify(trackingPayload, null, 2),
  });

  recordAuditLog('system', 'CARRIER_MILESTONE_UPDATED', {
    order_id: orderId,
    tracking_number: order.tracking_number,
    carrier,
    status: nextStatus,
    location: milestoneEvent.location,
  });

  const updatedOrder = db.prepare('SELECT * FROM demo_orders WHERE id = ?').get(orderId);
  realtimeHub.publish('CARRIER_UPDATE', updatedOrder);

  return { order: updatedOrder, newStatus: nextStatus };
}
