import crypto from 'node:crypto';
import { getDb, recordAuditLog } from '../db';
import { paypalClient } from './client';
import { realtimeHub } from '../realtime/hub';
import type { PayPalWebhookEvent } from '../types';
import { projectWebhook, type Notification, type Projection } from './webhook-projection';
import { InvalidEvent, MissingDependency, payloadHash, validateEnvelope } from './webhook-validation';

export interface WebhookHeaders {
  authAlgo?: string; certUrl?: string; transmissionId?: string; transmissionSig?: string; transmissionTime?: string;
}
export type SignatureVerifier = (headers: WebhookHeaders, event: PayPalWebhookEvent) => Promise<boolean>;
export interface WebhookProcessingResult {
  status: 'PROCESSED' | 'DUPLICATE' | 'IGNORED' | 'INVALID_SIGNATURE' | 'ERROR' | 'DEFERRED' | 'DEAD_LETTER';
  statusCode: number; message: string; disputeId?: string;
}
interface InboxRow {
  event_id: string; event_type: string; resource_id: string | null; payload: string; payload_hash: string;
  state: 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED' | 'DEFERRED' | 'DEAD_LETTER';
  attempts: number; next_attempt_at: number; last_error: string | null;
}
const MAX_ATTEMPTS=10;
const complete=(state:string)=>state==='PROCESSED'||state==='IGNORED';

const providerVerifier: SignatureVerifier = (headers,event) => paypalClient.verifyWebhookSignature({
  authAlgo:headers.authAlgo!,certUrl:headers.certUrl!,transmissionId:headers.transmissionId!,
  transmissionSig:headers.transmissionSig!,transmissionTime:headers.transmissionTime!,
  webhookId:process.env.PAYPAL_WEBHOOK_ID || '',webhookEvent:event,
});

function readEvent(row: InboxRow): PayPalWebhookEvent {
  const body=JSON.parse(row.payload);
  if (payloadHash(body)!==row.payload_hash) throw new InvalidEvent('Stored receipt integrity check failed.');
  return validateEnvelope(body);
}

function markComplete(row: InboxRow, projection: Projection, attempts: number) {
  const state=projection.ignored?'IGNORED':'PROCESSED', now=new Date().toISOString();
  getDb().prepare('UPDATE webhook_inbox SET state=?,attempts=?,next_attempt_at=0,last_error=NULL,completed_at=? WHERE event_id=?').run(state,attempts,now,row.event_id);
  getDb().prepare('UPDATE paypal_events SET status=?,processed_at=? WHERE event_id=?').run(state,now,row.event_id);
  recordAuditLog('paypal','WEBHOOK_PROJECTION_COMPLETED',{event_id:row.event_id,state,attempts},projection.disputeId || null);
}

/** No async work in this transaction: competing deliveries and retry workers serialize. */
export function processInboxEvent(eventId: string, force = false): WebhookProcessingResult {
  const db=getDb();
  const committed=db.transaction(() => {
    const row=db.prepare('SELECT * FROM webhook_inbox WHERE event_id=?').get(eventId) as InboxRow|undefined;
    const empty: Notification[]=[];
    if (!row) return {result:{status:'ERROR',statusCode:404,message:'Verified event not found.'} as WebhookProcessingResult,notifications:empty};
    if (complete(row.state)) return {result:{status:'DUPLICATE',statusCode:200,message:'Event already completed.'} as WebhookProcessingResult,notifications:empty};
    if (row.state==='DEAD_LETTER' && !force) return {result:{status:'DEAD_LETTER',statusCode:422,message:'Event requires operator review.'} as WebhookProcessingResult,notifications:empty};
    if (!force && row.next_attempt_at>Date.now()) return {result:{status:row.state==='DEFERRED'?'DEFERRED':'ERROR',statusCode:503,message:'Event is durably queued for retry.'} as WebhookProcessingResult,notifications:empty};
    const attempts=row.attempts+1;
    try {
      // Savepoint rolls back ALL business writes, while the outer transaction records failure.
      const projection=db.transaction(() => {
        const event=readEvent(row);
        const projected=projectWebhook(event);
        markComplete(row,projected,attempts);
        if (projected.created && row.resource_id) {
          // Recover earlier updates/resolutions before the new dispute becomes visible.
          const deferred=db.prepare(`SELECT * FROM webhook_inbox WHERE resource_id=? AND
            (state='DEFERRED' OR (state='DEAD_LETTER' AND last_error LIKE 'DEPENDENCY:%')) ORDER BY received_at,event_id`).all(row.resource_id) as InboxRow[];
          for (const waiting of deferred) {
            const recovered=projectWebhook(readEvent(waiting));
            markComplete(waiting,recovered,waiting.attempts+1);
            projected.notifications.push(...recovered.notifications);
          }
        }
        return projected;
      })();
      return {result:{status:projection.ignored?'IGNORED':'PROCESSED',statusCode:200,message:projection.ignored?'Event recorded without a state change.':'Event applied.',disputeId:projection.disputeId} as WebhookProcessingResult,notifications:projection.notifications};
    } catch (error) {
      const dependency=error instanceof MissingDependency;
      const dead=error instanceof InvalidEvent || attempts>=MAX_ATTEMPTS;
      const state=dead?'DEAD_LETTER':dependency?'DEFERRED':'FAILED';
      const message=(dependency?'DEPENDENCY: ':'')+(error instanceof Error?error.message:'Projection failed');
      const retryAt=dead?0:Date.now()+Math.min(3600000,30000*2**Math.min(attempts-1,10));
      db.prepare('UPDATE webhook_inbox SET state=?,attempts=?,next_attempt_at=?,last_error=?,completed_at=NULL WHERE event_id=?')
        .run(state,attempts,retryAt,message.slice(0,1000),eventId);
      db.prepare('UPDATE paypal_events SET status=? WHERE event_id=?').run(state,eventId);
      recordAuditLog('system','WEBHOOK_PROJECTION_RETRY_STATE',{event_id:eventId,state,attempts});
      return {result:{status:dead?'DEAD_LETTER':dependency?'DEFERRED':'ERROR',statusCode:dead?422:503,message:dead?'Verified event requires operator review.':'Verified event retained for retry.'} as WebhookProcessingResult,notifications:empty};
    }
  }).immediate();
  // SSE is advisory; listener failures cannot undo committed processing.
  for (const notification of committed.notifications) {
    try { realtimeHub.publish(notification.type,notification.payload); }
    catch { console.error('Webhook notification delivery failed:',eventId); }
  }
  return committed.result;
}

export async function processPayPalWebhook(headers: WebhookHeaders, body: unknown, verify: SignatureVerifier = providerVerifier): Promise<WebhookProcessingResult> {
  let event: PayPalWebhookEvent;
  try { event=validateEnvelope(body); }
  catch { return {status:'ERROR',statusCode:400,message:'Invalid webhook envelope.'}; }
  if ([headers.authAlgo,headers.certUrl,headers.transmissionId,headers.transmissionSig,headers.transmissionTime].some(value=>typeof value!=='string'||!value.trim()||value.length>8192)) {
    return {status:'INVALID_SIGNATURE',statusCode:401,message:'Required verification headers are missing.'};
  }
  try {
    if (!await verify(headers,event)) return {status:'INVALID_SIGNATURE',statusCode:401,message:'Invalid webhook signature.'};
  } catch { return {status:'ERROR',statusCode:503,message:'Webhook verification is temporarily unavailable.'}; }
  const db=getDb(), hash=payloadHash(event);
  const accepted=db.transaction(() => {
    const existing=db.prepare('SELECT payload_hash FROM webhook_inbox WHERE event_id=?').get(event.id) as {payload_hash:string}|undefined;
    if (existing) return existing.payload_hash===hash;
    const now=new Date().toISOString();
    const candidate=event.event_type.startsWith('CUSTOMER.DISPUTE.')?event.resource.dispute_id:event.resource.id;
    db.prepare(`INSERT INTO webhook_inbox(event_id,event_type,resource_id,payload,payload_hash,state,received_at)
      VALUES(?,?,?,?,?,'RECEIVED',?)`).run(event.id,event.event_type,typeof candidate==='string'?candidate:null,JSON.stringify(event),hash,now);
    db.prepare(`INSERT OR IGNORE INTO paypal_events(id,event_id,event_type,resource_type,summary,payload,status,processed_at)
      VALUES(?,?,?,?,?,?,'RECEIVED',?)`).run('evt_'+crypto.randomBytes(16).toString('hex'),event.id,event.event_type,event.resource_type,typeof event.summary==='string'?event.summary:'',JSON.stringify(event),now);
    return true;
  }).immediate();
  if (!accepted) return {status:'ERROR',statusCode:409,message:'Event ID was already received with different content.'};
  return processInboxEvent(event.id);
}

export function retryWebhookEvents(options: {limit?:number;eventId?:string;force?:boolean} = {}) {
  const limit=options.limit ?? 100;
  if (!Number.isInteger(limit)||limit<1||limit>1000) throw new Error('Retry limit must be between 1 and 1000.');
  if (options.force && !options.eventId) throw new Error('Force retry requires an explicit event ID.');
  const rows=options.eventId ? [{event_id:options.eventId}] : getDb().prepare(`SELECT event_id FROM webhook_inbox
    WHERE state IN ('RECEIVED','FAILED','DEFERRED') AND next_attempt_at<=? ORDER BY received_at,event_id LIMIT ?`).all(Date.now(),limit) as {event_id:string}[];
  return rows.map(row=>({event_id:row.event_id,...processInboxEvent(row.event_id,options.force)}));
}
