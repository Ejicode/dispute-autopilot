import crypto from 'node:crypto';
import { getDb, recordAuditLog } from '../db';
import { HttpError } from '../auth/session';
import { merchantScope } from '../auth/context';
import { requireMatchingProvenance } from '../runtime/safety';
import { paypalClient } from '../paypal/client';
import { object, timestamp, money, payloadHash } from '../paypal/webhook-validation';
import { realtimeHub } from '../realtime/hub';
import { requireDispute } from './service';
import type { Dispute, DisputeStatus } from '../types';

const STALE_SUBMISSION_MS = 120000;
const LEASE_MS = 90000;
const COOLDOWN_MS = 30000;
type Result = 'APPLIED'|'UNCHANGED'|'STALE'|'CONFLICT'|'ERROR'|'SUPERSEDED';
interface Operation { id:string; state:string; snapshot:string; updated_at:string; executed_at:string|null; idempotency_key:string }
interface Observation { provider_id:string; provider_status:string; status:DisputeStatus; updated_at:string; updated_ms:number; deadline:string|null; outcome:string|null }
const terminal = (status:string) => status === 'RESOLVED' || status === 'CLOSED';
const signature = (d:Dispute) => JSON.stringify([d.paypal_dispute_id,d.status,d.outcome,d.response_deadline,d.updated_at,d.amount_cents,d.currency]);
function operation(id:string): Operation {
  const row=getDb().prepare('SELECT * FROM approval_operations WHERE dispute_id=?').get(id) as Operation|undefined;
  if (!row) throw new HttpError(409,'This dispute has no approval operation to reconcile.');
  return row;
}
function validateObservation(value:unknown, dispute:Dispute): Observation {
  try {
    if (!object(value) || value.dispute_id !== dispute.paypal_dispute_id) throw new Error();
    const statuses: Record<string,DisputeStatus> = {OPEN:'UNDER_REVIEW',WAITING_FOR_SELLER_RESPONSE:'REQUIRED_ACTION',WAITING_FOR_BUYER_RESPONSE:'UNDER_REVIEW',UNDER_REVIEW:'UNDER_REVIEW',RESOLVED:'RESOLVED',CLOSED:'CLOSED'};
    if (typeof value.status !== 'string' || !Object.hasOwn(statuses,value.status)) throw new Error();
    const updated=timestamp(value.update_time);
    if (updated > Date.now()+300000) throw new Error();
    if (value.dispute_amount !== undefined) {
      const amount=money(value.dispute_amount);
      if (amount.amount !== dispute.amount_cents || amount.currency !== dispute.currency) throw new Error();
    }
    let deadline:string|null=null;
    if (value.seller_response_due_date !== undefined) {
      if (value.seller_response_due_date !== null && value.seller_response_due_date !== '') timestamp(value.seller_response_due_date);
      deadline=value.seller_response_due_date || '';
    }
    let outcome:string|null=null;
    if (value.dispute_outcome !== undefined) {
      if (!object(value.dispute_outcome) || typeof value.dispute_outcome.outcome_code !== 'string' || !/^[A-Z_]{1,100}$/.test(value.dispute_outcome.outcome_code)) throw new Error();
      outcome=value.dispute_outcome.outcome_code;
    }
    return {provider_id:value.dispute_id,provider_status:value.status,status:statuses[value.status],updated_at:value.update_time,updated_ms:updated,deadline,outcome};
  } catch { throw new HttpError(502,'Provider details are incomplete or inconsistent. Manual review is required.'); }
}

export function reconciliationHistory(id:string) {
  requireDispute(id);
  const op=operation(id);
  const history=getDb().prepare('SELECT * FROM dispute_reconciliations WHERE dispute_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20').all(id) as any[];
  return {operation:{id:op.id,state:op.state,provider_request_id:op.idempotency_key,executed_at:op.executed_at},retry_allowed:false,
    history:history.map(row=>({...row,observation:row.observation?JSON.parse(row.observation):null}))};
}

export async function reconcileDispute(id:string) {
  const db=getDb();
  const original=requireDispute(id);
  requireMatchingProvenance(original);
  if (merchantScope().mode === 'demo') throw new HttpError(409,'Provider reconciliation is unavailable in demo mode.');
  paypalClient.assertMerchantAccess();
  const actor=merchantScope().user?.id;
  if (!actor) throw new HttpError(401,'Authenticated merchant required.');
  const token=crypto.randomBytes(16).toString('hex');
  const op=db.transaction(()=>{
    const current=operation(id);
    const snapshot=JSON.parse(current.snapshot);
    if (snapshot.environment!==merchantScope().mode || snapshot.paypal_dispute_id!==original.paypal_dispute_id) throw new HttpError(422,'Operation does not match this environment or dispute.');
    if (!['SUBMITTING','UNCERTAIN'].includes(current.state)) throw new HttpError(409,'Only unresolved approval operations can be reconciled.');
    if (current.state==='SUBMITTING' && (!Number.isFinite(Date.parse(current.updated_at)) || Date.now()-Date.parse(current.updated_at)<STALE_SUBMISSION_MS)) throw new HttpError(409,'Submission may still be in progress. Wait before reconciling.');
    const lease=db.prepare('SELECT expires_at FROM reconciliation_leases WHERE dispute_id=?').get(id) as {expires_at:number}|undefined;
    if (lease && lease.expires_at>Date.now()) throw new HttpError(409,'Reconciliation is already in progress.');
    const last=db.prepare('SELECT created_at FROM dispute_reconciliations WHERE dispute_id=? ORDER BY rowid DESC LIMIT 1').get(id) as {created_at:string}|undefined;
    if (last && Date.now()-Date.parse(last.created_at)<COOLDOWN_MS) throw new HttpError(429,'Wait 30 seconds between reconciliation attempts.');
    db.prepare('INSERT INTO reconciliation_leases VALUES(?,?,?) ON CONFLICT(dispute_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at').run(id,token,Date.now()+LEASE_MS);
    if (current.state==='SUBMITTING') {
      db.prepare("UPDATE approval_operations SET state='UNCERTAIN',updated_at=? WHERE id=? AND state='SUBMITTING'").run(new Date().toISOString(),current.id);
      recordAuditLog('system','STALE_SUBMISSION_REQUIRES_RECONCILIATION',{operation_id:current.id},id);
    }
    recordAuditLog('user','DISPUTE_RECONCILIATION_STARTED',{operation_id:current.id,actor,attempt:token},id);
    return current;
  }).immediate();
  let observation:Observation|null=null, errorMessage:string|null=null;
  try { observation=validateObservation(await paypalClient.getDisputeDetails(id),original); }
  catch (error) { errorMessage=error instanceof HttpError && error.status===502 ? error.message : 'Provider lookup failed. No action was retried.'; }
  try {
    const result=db.transaction(()=>{
      const lease=db.prepare('SELECT token,expires_at FROM reconciliation_leases WHERE dispute_id=?').get(id) as {token:string;expires_at:number}|undefined;
      if (!lease || lease.token!==token || lease.expires_at<=Date.now()) throw new HttpError(409,'Reconciliation lease expired or was superseded. Check history before trying again.');
      const current=requireDispute(id), currentOp=operation(id);
      const version=db.prepare('SELECT provider_updated_ms FROM paypal_dispute_versions WHERE paypal_dispute_id=?').get(current.paypal_dispute_id) as {provider_updated_ms:number}|undefined;
      let status:Result='ERROR', message=errorMessage || 'Provider state observed; submission delivery remains unconfirmed.';
      const auditId='rec_'+crypto.randomBytes(16).toString('hex');
      if (currentOp.id!==op.id || currentOp.state==='SUCCEEDED' || signature(current)!==signature(original)) {
        status='SUPERSEDED'; message='Local state changed during the lookup; the observation did not overwrite it.';
      } else if (observation) {
        if (version && observation.updated_ms<version.provider_updated_ms) status='STALE';
        else if ((terminal(current.status) && current.status!==observation.status) ||
          (version && observation.updated_ms===version.provider_updated_ms && (current.status!==observation.status ||
            (observation.deadline!==null && current.response_deadline!==observation.deadline) ||
            (observation.outcome && current.outcome && current.outcome!=='PENDING' && current.outcome!==observation.outcome)))) {
          status='CONFLICT'; message='Provider observation conflicts with recorded lifecycle state; manual review is required.';
        } else {
          const deadline=observation.deadline??current.response_deadline;
          const outcome=observation.outcome??(current.outcome==='PENDING'?null:current.outcome);
          const changed=current.status!==observation.status || current.response_deadline!==deadline || current.outcome!==outcome;
          status=changed?'APPLIED':'UNCHANGED';
          if (changed) {
            db.prepare('UPDATE disputes SET status=?,response_deadline=?,outcome=?,updated_at=? WHERE id=?')
              .run(observation.status,deadline,outcome,new Date().toISOString(),id);
            db.prepare('UPDATE ai_drafts SET verified=0 WHERE dispute_id=?').run(id);
          }
          db.prepare('INSERT INTO paypal_dispute_versions VALUES(?,?,?) ON CONFLICT(paypal_dispute_id) DO UPDATE SET provider_updated_ms=excluded.provider_updated_ms,last_event_id=excluded.last_event_id')
            .run(current.paypal_dispute_id,observation.updated_ms,auditId);
        }
      }
      const serialized=observation?JSON.stringify(observation):null;
      db.prepare('INSERT INTO dispute_reconciliations VALUES(?,?,?,?,?,?,?,?,?,?)').run(auditId,id,op.id,actor,merchantScope().mode,status,serialized,observation?payloadHash(observation):null,message,new Date().toISOString());
      recordAuditLog('user','DISPUTE_RECONCILIATION_COMPLETED',{reconciliation_id:auditId,operation_id:op.id,result:status,actor,retry_allowed:false},id);
      db.prepare('DELETE FROM reconciliation_leases WHERE dispute_id=? AND token=?').run(id,token);
      return {reconciliation_id:auditId,result:status,message,observation,dispute:requireDispute(id),operation_state:operation(id).state,retry_allowed:false};
    }).immediate();
    if (result.result==='APPLIED') {
      try { realtimeHub.publish('DISPUTE_RECONCILED',result); } catch { console.error('Unable to publish reconciliation notification.'); }
    }
    return {status:result.result==='ERROR'?502:200,body:result};
  } finally {
    db.prepare('DELETE FROM reconciliation_leases WHERE dispute_id=? AND token=?').run(id,token);
  }
}
