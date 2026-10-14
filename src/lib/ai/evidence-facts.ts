import { createHash } from 'node:crypto';
import type { Claim, Dispute, EvidenceItem } from '../types';

type Fact = { type: Claim['claim_type']; value: string };
const carrierSources = new Set(['USPS', 'UPS', 'FEDEX', 'DHL', 'CARRIER_INTEGRATION', 'CARRIER_SIMULATOR']);
const orderSources = new Set(['STORE', 'STOREFRONT_CAPTURE', 'STOREFRONT_GATEWAY', 'STOREFRONT_CHECKOUT', 'STOREFRONT_CHECKOUT_GATEWAY', 'PAYMENT_CAPTURE_WEBHOOK', 'PAYPAL_SANDBOX_WEBHOOK']);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function normalizedText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() && v.length <= 500 && !/[\u0000-\u001f\u007f]/.test(v)
    ? v.trim().replace(/\s+/g, ' ') : null;
}

/** Preserve the provider's calendar day; capture time is never a shipping/delivery date. */
function day(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(v)) return null;
  const date = v.slice(0, 10);
  if (!Number.isFinite(Date.parse(v)) || new Date(date).toISOString().slice(0, 10) !== date) return null;
  return date;
}

/** Supported structured fields only. Source labels describe adapters, not independent proof of authenticity. */
export function evidenceFacts(item: EvidenceItem, dispute: Dispute): Fact[] {
  if (item.dispute_id !== dispute.id && (!dispute.order_id || item.order_id !== dispute.order_id)) throw new Error('Evidence is not linked to this dispute or its order.');
  if (createHash('sha256').update(item.content).digest('hex') !== item.sha256_hash) throw new Error('Evidence integrity check failed.');
  let data: unknown;
  try { data = JSON.parse(item.content); } catch { throw new Error('Structured JSON evidence is required.'); }
  if (!record(data)) throw new Error('Evidence must contain a JSON object.');
  const facts: Fact[] = [];
  const add = (type: Fact['type'], value: string | null) => { if (value) facts.push({ type, value }); };
  if (item.evidence_type === 'TRACKING_HISTORY' || item.evidence_type === 'PROOF_OF_DELIVERY') {
    if (!carrierSources.has(item.source)) throw new Error('Unsupported carrier evidence source.');
    const tracking = normalizedText(data.tracking_number);
    if (tracking && /^[A-Za-z0-9-]{3,100}$/.test(tracking)) add('TRACKING_NUMBER', tracking);
    const events = Array.isArray(data.events) ? data.events.filter(record) : [];
    for (const event of events) {
      if (event.status === 'PICKED_UP' || event.status === 'SHIPPED') add('SHIPPING_DATE', day(event.timestamp));
    }
    if (item.evidence_type === 'PROOF_OF_DELIVERY' && data.status !== undefined && data.status !== 'DELIVERED') throw new Error('Proof of delivery contradicts its status.');
    const delivered = item.evidence_type === 'PROOF_OF_DELIVERY' || data.status === 'DELIVERED';
    if (delivered) {
      const dates = [data.delivered_at, ...events.filter(e => e.status === 'DELIVERED').map(e => e.timestamp)]
        .filter(v => v !== undefined && v !== null);
      const days = dates.map(day);
      if (days.some(d => !d) || new Set(days).size > 1) throw new Error('Conflicting or invalid delivery dates.');
      if (days.length) {
        add('DELIVERY_DATE', days[0]);
        add('DELIVERY_ADDRESS', normalizedText(data.delivered_address));
      }
    }
  } else if (item.evidence_type === 'ORDER_CONFIRMATION') {
    if (!orderSources.has(item.source)) throw new Error('Unsupported order evidence source.');
    add('BUYER_NAME', normalizedText(data.buyer_name));
    const cents = data.total_cents ?? data.amount_cents;
    if (data.total_cents !== undefined && data.amount_cents !== undefined && data.total_cents !== data.amount_cents) throw new Error('Conflicting evidence amounts.');
    if (typeof cents === 'number' && Number.isSafeInteger(cents) && cents > 0 && typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency)) {
      add('TRANSACTION_AMOUNT', `${data.currency} ${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`);
    }
  } else throw new Error('Evidence type cannot support these factual claims.');
  return facts;
}

export function renderClaimText(claim: Pick<Claim, 'claim_type' | 'expected_value'>): string {
  const labels: Record<Claim['claim_type'], string> = {
    TRACKING_NUMBER: 'Recorded tracking number', SHIPPING_DATE: 'Recorded shipment pickup date',
    DELIVERY_DATE: 'Recorded delivery date', DELIVERY_ADDRESS: 'Recorded delivery address',
    TRANSACTION_AMOUNT: 'Recorded transaction amount', BUYER_NAME: 'Recorded buyer name',
  };
  return `${labels[claim.claim_type]}: ${JSON.stringify(claim.expected_value)}.`;
}

export function renderCitedNarrative(claims: Claim[]): string {
  return claims.length ? claims.map(c => `${renderClaimText(c)} [${c.evidence_id}]`).join('\n')
    : 'No supported factual claims are available for this draft.';
}
