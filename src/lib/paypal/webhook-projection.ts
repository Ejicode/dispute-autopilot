import { merchantScope } from '../auth/context';
import { provenanceFor } from '../runtime/mode';
import crypto from 'node:crypto';
import { getDb, recordAuditLog } from '../db';
import { addToVault, calculateSha256, linkOrderEvidenceToDispute } from '../vault/vault';
import { calculateEvidenceStrength } from '../ai/triage';
import { generateDeterministicDraft, persistCitedDraft } from '../ai/drafter';
import type { Dispute, DisputeStatus, EvidenceItem, PayPalWebhookEvent } from '../types';
import type { SystemEvent } from '../realtime/hub';
import { identifier, InvalidEvent, MissingDependency, money, object, timestamp } from './webhook-validation';

export type Notification = Pick<SystemEvent,'type'|'payload'>;
export interface Projection { ignored?: boolean; disputeId?: string; created?: boolean; notifications: Notification[] }
const statusMap: Record<string,DisputeStatus> = {
  OPEN:'UNDER_REVIEW', WAITING_FOR_SELLER_RESPONSE:'REQUIRED_ACTION',
  WAITING_FOR_BUYER_RESPONSE:'UNDER_REVIEW', UNDER_REVIEW:'UNDER_REVIEW',
  RESOLVED:'RESOLVED', CLOSED:'CLOSED', REQUIRED_ACTION:'REQUIRED_ACTION',
};
const terminal = (status: string) => status === 'RESOLVED' || status === 'CLOSED';

function refreshDraft(id: string, notifications: Notification[]) {
  const db = getDb();
  const dispute = db.prepare('SELECT * FROM disputes WHERE id=?').get(id) as Dispute;
  const evidence = db.prepare('SELECT * FROM evidence_items WHERE dispute_id=? OR order_id=? ORDER BY captured_at,id').all(id,dispute.order_id || '') as EvidenceItem[];
  const triage = calculateEvidenceStrength(dispute.reason,evidence);
  db.prepare('UPDATE disputes SET strength_score=?,recommendation=? WHERE id=?').run(triage.score,triage.recommendation,id);
  dispute.strength_score=triage.score; dispute.recommendation=triage.recommendation;
  if (!terminal(dispute.status)) {
    const draft=persistCitedDraft(dispute,evidence,generateDeterministicDraft(dispute,evidence),false);
    notifications.push({type:'DRAFT_GENERATED',payload:draft});
  }
}

function projectDispute(event: PayPalWebhookEvent): Projection {
  const db=getDb(), resource=event.resource, notifications: Notification[]=[];
  const providerId=identifier(resource.dispute_id,'dispute ID');
  const version=timestamp(resource.update_time ?? event.create_time);
  const isResolved=event.event_type==='CUSTOMER.DISPUTE.RESOLVED';
  const status: DisputeStatus | undefined = isResolved ? 'RESOLVED' :
    typeof resource.status==='string' && Object.prototype.hasOwnProperty.call(statusMap,resource.status) ? statusMap[resource.status] : undefined;
  if (!status) throw new InvalidEvent('Unsupported or missing dispute status.');
  let outcome: string | null=null;
  if (resource.dispute_outcome !== undefined) {
    if (!object(resource.dispute_outcome) || typeof resource.dispute_outcome.outcome_code !== 'string' || !/^[A-Z_]{1,100}$/.test(resource.dispute_outcome.outcome_code)) throw new InvalidEvent('Invalid dispute outcome.');
    outcome=resource.dispute_outcome.outcome_code;
  }
  if (resource.seller_response_due_date !== undefined && resource.seller_response_due_date !== null && resource.seller_response_due_date !== '') timestamp(resource.seller_response_due_date);
  const amount=resource.dispute_amount !== undefined ? money(resource.dispute_amount) : undefined;
  if (resource.reason !== undefined && (typeof resource.reason!=='string' || !/^[A-Z_]{1,100}$/.test(resource.reason))) throw new InvalidEvent('Invalid dispute reason.');
  let current=db.prepare('SELECT * FROM disputes WHERE paypal_dispute_id=?').get(providerId) as Dispute | undefined;
  if (current && current.provenance !== provenanceFor(merchantScope().mode)) throw new InvalidEvent('Dispute provenance does not match this environment.');
  const previous=db.prepare('SELECT provider_updated_ms FROM paypal_dispute_versions WHERE paypal_dispute_id=?').get(providerId) as {provider_updated_ms:number}|undefined;
  if (current && event.event_type==='CUSTOMER.DISPUTE.CREATED') return {ignored:true,disputeId:current.id,notifications};
  // Terminal states do not reopen automatically. Reopening requires provider reconciliation.
  if (current && terminal(current.status) && !terminal(status)) return {ignored:true,disputeId:current.id,notifications};
  if (current && previous && version===previous.provider_updated_ms && terminal(current.status) && terminal(status)) {
    if (current.status!==status || (outcome && current.outcome && current.outcome!=='PENDING' && outcome!==current.outcome)) throw new InvalidEvent('Conflicting terminal states at the same provider timestamp require reconciliation.');
    if (!outcome || current.outcome===outcome) return {ignored:true,disputeId:current.id,notifications};
  }
  if (current && previous && version===previous.provider_updated_ms && !terminal(status)) {
    const deadlineChanged=resource.seller_response_due_date !== undefined &&
      (resource.seller_response_due_date ? Date.parse(resource.seller_response_due_date)!==Date.parse(current.response_deadline) : current.response_deadline!=='');
    if (current.status!==status || deadlineChanged || (amount && (amount.amount!==current.amount_cents || amount.currency!==current.currency)) ||
      (resource.reason !== undefined && resource.reason!==current.reason)) {
      throw new InvalidEvent('Conflicting dispute states at the same provider timestamp require reconciliation.');
    }
  }
  if (previous && (version < previous.provider_updated_ms || (version === previous.provider_updated_ms && !terminal(status)))) return {ignored:true,disputeId:current?.id,notifications};
  if (!current && event.event_type!=='CUSTOMER.DISPUTE.CREATED') throw new MissingDependency('Dispute creation has not arrived yet.');
  const created=!current;
  const now=new Date().toISOString();
  if (!current) {
    const transactionId=identifier(resource.disputed_transactions?.[0]?.seller_transaction_id,'seller transaction ID');
    if (!amount || typeof resource.reason!=='string' || !/^[A-Z_]{1,100}$/.test(resource.reason)) throw new InvalidEvent('Dispute amount and reason are required.');
    const order=db.prepare(`SELECT id FROM demo_orders WHERE (id=(SELECT order_id FROM paypal_captures WHERE capture_id=?) OR paypal_order_id=?) AND provenance=? LIMIT 1`).get(transactionId,transactionId,provenanceFor(merchantScope().mode)) as {id:string}|undefined;
    const id='dsp_'+crypto.randomBytes(16).toString('hex');
    db.prepare(`INSERT INTO disputes(id,paypal_dispute_id,transaction_id,order_id,reason,amount_cents,currency,status,response_deadline,outcome,created_at,updated_at,provenance)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,providerId,transactionId,order?.id || null,resource.reason,amount.amount,amount.currency,status,resource.seller_response_due_date || '',outcome,now,now,provenanceFor(merchantScope().mode));
    if (order) linkOrderEvidenceToDispute(order.id,id);
    current=db.prepare('SELECT * FROM disputes WHERE id=?').get(id) as Dispute;
  } else {
    const deadline=resource.seller_response_due_date !== undefined ? resource.seller_response_due_date || '' : current.response_deadline;
    db.prepare(`UPDATE disputes SET status=?,outcome=?,response_deadline=?,amount_cents=?,currency=?,reason=?,updated_at=? WHERE id=?`)
      .run(status,outcome ?? (current.outcome==='PENDING'?null:current.outcome),deadline,amount?.amount ?? current.amount_cents,amount?.currency ?? current.currency,resource.reason ?? current.reason,now,current.id);
    db.prepare('UPDATE ai_drafts SET verified=0 WHERE dispute_id=?').run(current.id);
  }
  db.prepare(`INSERT INTO paypal_dispute_versions VALUES(?,?,?) ON CONFLICT(paypal_dispute_id) DO UPDATE SET provider_updated_ms=excluded.provider_updated_ms,last_event_id=excluded.last_event_id`)
    .run(providerId,version,event.id);
  refreshDraft(current.id,notifications);
  const updated=db.prepare('SELECT * FROM disputes WHERE id=?').get(current.id) as Dispute;
  recordAuditLog('paypal','DISPUTE_WEBHOOK_APPLIED',{event_id:event.id,paypal_dispute_id:providerId,status:updated.status,outcome:updated.outcome},current.id);
  notifications.push({type:terminal(updated.status)?'PAYPAL_API_RESOLVED':'DISPUTE_OPENED',payload:updated});
  return {disputeId:current.id,created,notifications};
}

function projectCapture(event: PayPalWebhookEvent): Projection {
  const db=getDb(), resource=event.resource, notifications: Notification[]=[];
  const captureId=identifier(resource.id,'capture ID'), amount=money(resource.amount);
  if (resource.status !== undefined && resource.status!=='COMPLETED') throw new InvalidEvent('Capture is not completed.');
  if (resource.create_time !== undefined) timestamp(resource.create_time);
  const providerOrderId=resource.supplementary_data?.related_ids?.order_id;
  if (providerOrderId !== undefined) identifier(providerOrderId,'provider order ID');
  const content=JSON.stringify({capture_id:captureId,amount_cents:amount.amount,currency:amount.currency,status:'COMPLETED',create_time:resource.create_time ?? null});
  const hash=calculateSha256(content);
  const existing=db.prepare('SELECT * FROM paypal_captures WHERE capture_id=?').get(captureId) as any;
  if (existing) {
    if (existing.content_hash!==hash || (existing.paypal_order_id && providerOrderId && existing.paypal_order_id!==providerOrderId)) throw new InvalidEvent('Conflicting capture facts require reconciliation.');
    return {ignored:true,notifications};
  }
  const order=providerOrderId ? db.prepare('SELECT id FROM demo_orders WHERE paypal_order_id=? AND provenance=?').get(providerOrderId,provenanceFor(merchantScope().mode)) as {id:string}|undefined : undefined;
  // Older releases may have captured evidence before this inbox existed. Reuse it safely.
  const legacy=db.prepare(`SELECT * FROM evidence_items WHERE source='PAYMENT_CAPTURE_WEBHOOK'
    AND json_extract(CASE WHEN json_valid(content) THEN content ELSE '{}' END,'$.capture_id')=? LIMIT 1`).get(captureId) as EvidenceItem|undefined;
  let evidence: EvidenceItem;
  if (legacy) {
    if (legacy.provenance !== provenanceFor(merchantScope().mode)) throw new InvalidEvent('Legacy capture provenance requires reconciliation.');
    const value=JSON.parse(legacy.content);
    if (value.amount_cents!==amount.amount || value.currency!==amount.currency || calculateSha256(legacy.content)!==legacy.sha256_hash) throw new InvalidEvent('Legacy capture evidence requires reconciliation.');
    evidence=legacy;
    if (order && !legacy.order_id) db.prepare('UPDATE evidence_items SET order_id=? WHERE id=?').run(order.id,legacy.id);
  } else {
    evidence=addToVault({orderId:order?.id,evidenceType:'ORDER_CONFIRMATION',source:'PAYMENT_CAPTURE_WEBHOOK',title:`Payment Capture ${captureId}`,content,publish:false,provenance:provenanceFor(merchantScope().mode)});
    notifications.push({type:'VAULT_ITEM_ADDED',payload:evidence});
  }
  db.prepare('INSERT INTO paypal_captures VALUES(?,?,?,?,?)').run(captureId,providerOrderId ?? null,order?.id ?? null,evidence.id,hash);
  if (order) {
    const disputes=db.prepare('SELECT id FROM disputes WHERE transaction_id=? AND order_id IS NULL AND provenance=?').all(captureId,provenanceFor(merchantScope().mode)) as {id:string}[];
    for (const dispute of disputes) {
      db.prepare('UPDATE disputes SET order_id=?,updated_at=? WHERE id=?').run(order.id,new Date().toISOString(),dispute.id);
      linkOrderEvidenceToDispute(order.id,dispute.id);
      refreshDraft(dispute.id,notifications);
    }
  }
  return {notifications};
}

/** Only synchronous local work is allowed here; callers wrap this in a SQLite transaction. */
export function projectWebhook(event: PayPalWebhookEvent): Projection {
  switch (event.event_type) {
    case 'CUSTOMER.DISPUTE.CREATED':
    case 'CUSTOMER.DISPUTE.UPDATED':
    case 'CUSTOMER.DISPUTE.RESOLVED': return projectDispute(event);
    case 'PAYMENT.CAPTURE.COMPLETED': return projectCapture(event);
    default: return {ignored:true,notifications:[]};
  }
}
