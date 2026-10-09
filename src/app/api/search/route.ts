import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { PRODUCTS } from '@/lib/storefront/catalog';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() || '';

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [], query: q });
  }

  const db = getDb();
  const results: any[] = [];

  // ── Rebuild FTS indexes if empty (on first search after boot) ──
  try {
    const disputeFtsCount = (db.prepare('SELECT count(*) as c FROM disputes_fts').get() as any)?.c ?? 0;
    if (disputeFtsCount === 0) {
      db.exec(`
        INSERT INTO disputes_fts(disputes_fts) VALUES('rebuild');
      `);
    }
  } catch (_) {
    // FTS rebuild — insert real data manually
    try {
      db.exec(`DELETE FROM disputes_fts`);
      const allDisputes = db.prepare('SELECT rowid, id, paypal_dispute_id, reason, status, recommendation FROM disputes').all() as any[];
      const insertFts = db.prepare(`INSERT INTO disputes_fts(rowid, id, paypal_dispute_id, reason, status, recommendation, amount_cents) VALUES (?,?,?,?,?,?,0)`);
      for (const d of allDisputes) {
        insertFts.run(d.rowid, d.id, d.paypal_dispute_id, d.reason, d.status, d.recommendation);
      }
    } catch (_2) { /* ignore */ }
  }

  try {
    const orderFtsCount = (db.prepare('SELECT count(*) as c FROM orders_fts').get() as any)?.c ?? 0;
    if (orderFtsCount === 0) {
      db.exec(`INSERT INTO orders_fts(orders_fts) VALUES('rebuild')`);
    }
  } catch (_) {
    try {
      db.exec(`DELETE FROM orders_fts`);
      const allOrders = db.prepare('SELECT rowid, id, order_number, buyer_name, buyer_email, shipping_address, delivery_status FROM demo_orders').all() as any[];
      const insertFts = db.prepare(`INSERT INTO orders_fts(rowid, id, order_number, buyer_name, buyer_email, shipping_address, delivery_status) VALUES (?,?,?,?,?,?,?)`);
      for (const o of allOrders) {
        insertFts.run(o.rowid, o.id, o.order_number, o.buyer_name, o.buyer_email, o.shipping_address, o.delivery_status);
      }
    } catch (_2) { /* ignore */ }
  }

  const safeQ = q.replace(/['"*]/g, '').trim() + '*';

  // ── 1. Search Disputes via SQLite LIKE (reliable fallback) ──
  try {
    const disputeRows = db.prepare(`
      SELECT id, paypal_dispute_id, reason, status, recommendation, amount_cents, response_deadline, created_at
      FROM disputes
      WHERE paypal_dispute_id LIKE ? OR reason LIKE ? OR status LIKE ? OR recommendation LIKE ?
      LIMIT 5
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`) as any[];

    for (const d of disputeRows) {
      results.push({
        type: 'dispute',
        id: d.id,
        title: d.paypal_dispute_id,
        subtitle: `${d.reason?.replace(/_/g, ' ')} — $${(d.amount_cents / 100).toFixed(2)}`,
        badge: d.status,
        badgeColor: d.status === 'REQUIRED_ACTION' ? 'amber' : d.status === 'RESOLVED' ? 'emerald' : 'blue',
        href: `/case/${d.id}`,
        icon: 'shield',
      });
    }
  } catch (_) { /* ignore */ }

  // ── 2. Search Orders via LIKE ──
  try {
    const orderRows = db.prepare(`
      SELECT id, order_number, buyer_name, buyer_email, delivery_status, total_cents, created_at
      FROM demo_orders
      WHERE order_number LIKE ? OR buyer_name LIKE ? OR buyer_email LIKE ? OR shipping_address LIKE ?
      LIMIT 5
    `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`) as any[];

    for (const o of orderRows) {
      results.push({
        type: 'order',
        id: o.id,
        title: `${o.order_number} — ${o.buyer_name}`,
        subtitle: `${o.delivery_status?.replace(/_/g, ' ')} · $${(o.total_cents / 100).toFixed(2)}`,
        badge: o.delivery_status,
        badgeColor: o.delivery_status === 'DELIVERED' ? 'emerald' : 'blue',
        href: `/storefront`,
        icon: 'package',
      });
    }
  } catch (_) { /* ignore */ }

  // ── 3. Search Products from in-memory catalog ──
  const qLower = q.toLowerCase();
  const matchedProducts = PRODUCTS.filter(
    (p) =>
      p.name.toLowerCase().includes(qLower) ||
      p.category.toLowerCase().includes(qLower) ||
      p.brand?.toLowerCase().includes(qLower) ||
      p.sku?.toLowerCase().includes(qLower)
  ).slice(0, 4);

  for (const p of matchedProducts) {
    results.push({
      type: 'product',
      id: p.id,
      title: p.name,
      subtitle: `${p.category} · $${(p.price_cents / 100).toFixed(2)}`,
      badge: p.category,
      badgeColor: 'slate',
      href: `/storefront`,
      icon: 'shopping',
      image: p.image_url,
    });
  }

  // ── 4. Search Evidence Items ──
  try {
    const evidenceRows = db.prepare(`
      SELECT id, dispute_id, evidence_type, title, source, captured_at
      FROM evidence_items
      WHERE title LIKE ? OR evidence_type LIKE ? OR source LIKE ?
      LIMIT 3
    `).all(`%${q}%`, `%${q}%`, `%${q}%`) as any[];

    for (const e of evidenceRows) {
      results.push({
        type: 'evidence',
        id: e.id,
        title: e.title,
        subtitle: `${e.evidence_type?.replace(/_/g, ' ')} · ${e.source}`,
        badge: e.evidence_type,
        badgeColor: 'violet',
        href: e.dispute_id ? `/case/${e.dispute_id}` : `/storefront`,
        icon: 'file',
      });
    }
  } catch (_) { /* ignore */ }

  return NextResponse.json({ results: results.slice(0, 12), query: q, total: results.length });
}
