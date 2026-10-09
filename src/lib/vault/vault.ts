import crypto from 'crypto';
import { getDb, recordAuditLog } from '../db';
import { EvidenceItem, EvidenceType } from '../types';
import { realtimeHub } from '../realtime/hub';

export function calculateSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Capture an item into the Evidence Vault with an immutable SHA-256 hash
 */
export function addToVault(params: {
  disputeId?: string | null;
  orderId?: string | null;
  evidenceType: EvidenceType;
  source: string;
  title: string;
  content: string;
  filePath?: string | null;
}): EvidenceItem {
  const db = getDb();
  const id = 'ev_' + crypto.randomBytes(8).toString('hex');
  const capturedAt = new Date().toISOString();
  const sha256Hash = calculateSha256(params.content);

  const stmt = db.prepare(`
    INSERT INTO evidence_items (
      id, dispute_id, order_id, evidence_type, source, title, content, file_path, sha256_hash, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    params.disputeId || null,
    params.orderId || null,
    params.evidenceType,
    params.source,
    params.title,
    params.content,
    params.filePath || null,
    sha256Hash,
    capturedAt
  );

  const item: EvidenceItem = {
    id,
    dispute_id: params.disputeId || null,
    order_id: params.orderId || null,
    evidence_type: params.evidenceType,
    source: params.source,
    title: params.title,
    content: params.content,
    file_path: params.filePath || null,
    sha256_hash: sha256Hash,
    captured_at: capturedAt,
  };

  recordAuditLog(
    'system',
    'EVIDENCE_VAULT_ITEM_ADDED',
    {
      evidence_id: id,
      evidence_type: params.evidenceType,
      sha256_hash: sha256Hash,
      title: params.title,
      source: params.source,
    },
    params.disputeId || null
  );

  realtimeHub.publish('VAULT_ITEM_ADDED', item);

  return item;
}

/**
 * Retrieve all vault evidence linked to a dispute
 */
export function getVaultEvidenceForDispute(disputeId: string): EvidenceItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM evidence_items
    WHERE dispute_id = ?
    ORDER BY captured_at ASC
  `).all(disputeId) as EvidenceItem[];

  return rows;
}

/**
 * Retrieve all vault evidence linked to an order
 */
export function getVaultEvidenceForOrder(orderId: string): EvidenceItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM evidence_items
    WHERE order_id = ?
    ORDER BY captured_at ASC
  `).all(orderId) as EvidenceItem[];

  return rows;
}

/**
 * Link order evidence to a dispute when a dispute is opened
 */
export function linkOrderEvidenceToDispute(orderId: string, disputeId: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE evidence_items
    SET dispute_id = ?
    WHERE order_id = ? AND (dispute_id IS NULL OR dispute_id = '')
  `).run(disputeId, orderId);

  recordAuditLog(
    'system',
    'ORDER_EVIDENCE_LINKED_TO_DISPUTE',
    { order_id: orderId, dispute_id: disputeId },
    disputeId
  );
}

/**
 * Verify cryptographic integrity of an evidence item
 */
export function verifyEvidenceIntegrity(itemId: string): { valid: boolean; currentHash: string; storedHash: string } {
  const db = getDb();
  const item = db.prepare(`SELECT * FROM evidence_items WHERE id = ?`).get(itemId) as EvidenceItem | undefined;
  if (!item) {
    throw new Error(`Evidence item ${itemId} not found`);
  }

  const currentHash = calculateSha256(item.content);
  return {
    valid: currentHash === item.sha256_hash,
    currentHash,
    storedHash: item.sha256_hash,
  };
}
