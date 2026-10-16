import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { NextRequest } from 'next/server';

async function main() {
  process.env.APP_MODE = 'sandbox';
  process.env.PAYPAL_ENVIRONMENT = 'sandbox';
  process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),'webhook-tests-'));
  for (const key of ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','GEMINI_API_KEY','OPENAI_API_KEY']) delete process.env[key];
  const merchant='usr_'+'c'.repeat(32), foreign='usr_'+'d'.repeat(32);
  process.env.PAYPAL_MERCHANT_USER_ID=merchant;
  process.env.PAYPAL_WEBHOOK_ID='test-webhook';
  const {withMerchantScope}=await import('../src/lib/auth/context');
  const {getDb}=await import('../src/lib/db');
  const {authDb}=await import('../src/lib/auth/store');
  const {realtimeHub}=await import('../src/lib/realtime/hub');
  const {paypalClient}=await import('../src/lib/paypal/client');
  const {processPayPalWebhook,processInboxEvent,retryWebhookEvents}=await import('../src/lib/paypal/webhooks');
  const route=await import('../src/app/api/webhooks/paypal/route');
  authDb().prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(merchant,'test@example.test','Test','Store','MERCHANT_ADMIN',null,'unused',new Date().toISOString());
  const scoped=<T>(work:()=>T)=>withMerchantScope(merchant,work);
  const db=scoped(()=>getDb());
  const now='2026-10-14T10:00:00.000Z', later='2026-10-14T11:00:00.000Z', newest='2026-10-14T12:00:00.000Z';
  const headers={authAlgo:'SHA256withRSA',certUrl:'https://example.test/cert',transmissionId:'test-transmission',transmissionSig:'test-signature',transmissionTime:now};
  let checks=0;
  const check=(condition:unknown,label:string)=>{assert.ok(condition,label);checks++;console.log('PASS '+label);};
  const event=(id:string,event_type:string,resource:any,time=now)=>({id,event_type,resource_type:event_type.startsWith('CUSTOMER')?'dispute':'capture',create_time:time,resource});
  const capture=(id:string,captureId=id)=>event(id,'PAYMENT.CAPTURE.COMPLETED',{id:captureId,amount:{value:'12.34',currency_code:'USD'},status:'COMPLETED',create_time:now});
  const created=(id:string,providerId=id)=>event(id,'CUSTOMER.DISPUTE.CREATED',{
    dispute_id:providerId,update_time:now,status:'WAITING_FOR_SELLER_RESPONSE',reason:'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    disputed_transactions:[{seller_transaction_id:'TX-'+providerId}],dispute_amount:{value:'12.34',currency_code:'USD'},seller_response_due_date:'2026-12-01T00:00:00Z',
  });
  const send=(body:unknown,verify=async()=>true)=>scoped(()=>processPayPalWebhook(headers,body,verify));
  const receipt=(id:string)=>db.prepare('SELECT * FROM webhook_inbox WHERE event_id=?').get(id) as any;
  const dispute=(id:string)=>db.prepare('SELECT * FROM disputes WHERE paypal_dispute_id=?').get(id) as any;
  const count=(table:string)=> (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n;
  const notes:any[]=[];
  const listener=(value:any)=>notes.push(value);
  realtimeHub.on('system_event:sandbox:'+merchant,listener);

  check((await send(capture('bad-signature'),async()=>false)).statusCode===401 && count('webhook_inbox')===0,'invalid signatures never reach the inbox');
  check((await scoped(()=>processPayPalWebhook({},capture('missing-headers'),async()=>true))).statusCode===401,'missing verification headers fail closed');
  check((await scoped(()=>processPayPalWebhook(headers,capture('unconfigured')))).statusCode===401,'unconfigured provider verifier no longer accepts mock signatures');
  check((await send(capture('verification-outage'),async()=>{throw new Error('unavailable');})).statusCode===503 && count('webhook_inbox')===0,'verification outage remains retryable without trusting the event');
  for (const body of [null,[],{},event('missing-resource','PAYMENT.CAPTURE.COMPLETED',null),{...capture('bad-time'),create_time:'yesterday'}]) {
    check((await send(body)).statusCode===400,'malformed webhook envelope rejected');
  }
  check((await send(capture('capture-one'))).status==='PROCESSED','verified capture commits successfully');
  check(receipt('capture-one').state==='PROCESSED' && receipt('capture-one').attempts===1 && receipt('capture-one').completed_at,'completion and attempt metadata persisted');
  check(count('evidence_items')===1 && count('paypal_captures')===1,'capture produces one evidence item and one capture mapping');
  const published=notes.length;
  check((await send(capture('capture-one'))).status==='DUPLICATE' && count('evidence_items')===1 && notes.length===published,'completed duplicate causes no evidence or notification side effects');
  check((await send(capture('different-event-id','capture-one'))).status==='IGNORED' && count('evidence_items')===1,'different event IDs for the same capture cannot duplicate evidence');
  const reordered=JSON.parse(JSON.stringify(capture('capture-one')));
  reordered.resource.amount={currency_code:'USD',value:'12.34'};
  check((await send(reordered)).status==='DUPLICATE','object key order does not change event identity');
  check((await send({...capture('capture-one'),summary:'changed payload'})).statusCode===409,'same event ID with changed content is rejected');
  check((await send(capture('capture-one'),async()=>false)).statusCode===401,'replayed completed events still require signature verification');
  assert.throws(()=>db.prepare("UPDATE webhook_inbox SET payload='{}' WHERE event_id='capture-one'").run(),/immutable/);
  check(true,'stored verified payload is immutable');

  let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const concurrent=async()=>{await gate;return true;};
  const first=send(capture('concurrent'),concurrent),second=send(capture('concurrent'),concurrent);release();
  const results=await Promise.all([first,second]);
  check(results.filter(r=>r.status==='PROCESSED').length===1 && results.filter(r=>r.status==='DUPLICATE').length===1,'concurrent verified delivery projects once');

  db.exec("CREATE TRIGGER fail_capture BEFORE INSERT ON paypal_captures WHEN NEW.capture_id='rollback-capture' BEGIN SELECT RAISE(ABORT,'injected capture failure'); END;");
  const beforeEvidence=count('evidence_items'),beforeNotifications=notes.length;
  check((await send(capture('rollback','rollback-capture'))).statusCode===503,'projection failure returns a retryable status');
  check(receipt('rollback').state==='FAILED' && receipt('rollback').attempts===1 && receipt('rollback').completed_at===null,'failed projection remains durably retryable');
  check(count('evidence_items')===beforeEvidence && notes.length===beforeNotifications,'failed projection rolls back evidence and suppresses notifications');
  check((await send(capture('rollback','rollback-capture'))).statusCode===503 && receipt('rollback').attempts===1,'retry backoff prevents immediate repeated work');
  db.exec('DROP TRIGGER fail_capture');
  db.prepare("UPDATE webhook_inbox SET next_attempt_at=0 WHERE event_id='rollback'").run();
  const recovered=scoped(()=>retryWebhookEvents());
  check(recovered.some(r=>r.event_id==='rollback'&&r.status==='PROCESSED') && receipt('rollback').attempts===2,'scheduled retry recovers failed projection');
  check(count('evidence_items')===beforeEvidence+1,'recovery writes one complete capture');

  db.exec("CREATE TRIGGER fail_draft BEFORE INSERT ON ai_drafts BEGIN SELECT RAISE(ABORT,'injected draft failure'); END;");
  const priorDisputes=count('disputes'),priorDrafts=count('ai_drafts'),priorNotes=notes.length;
  check((await send(created('draft-failure'))).statusCode===503,'draft persistence failure is recoverable');
  check(count('disputes')===priorDisputes && count('ai_drafts')===priorDrafts && notes.length===priorNotes,'draft failure rolls back dispute, version, draft, and events together');
  db.exec('DROP TRIGGER fail_draft');
  check(scoped(()=>processInboxEvent('draft-failure',true)).status==='PROCESSED' && dispute('draft-failure'),'failed dispute can be recovered without duplicate-key poisoning');

  const resolution=event('resolve-first','CUSTOMER.DISPUTE.RESOLVED',{dispute_id:'out-of-order',update_time:later},later);
  check((await send(resolution)).status==='DEFERRED' && !dispute('out-of-order'),'resolution before creation is retained without inventing a dispute');
  const observed:string[]=[];
  const observer=()=>{const value=dispute('out-of-order');if(value) observed.push(value.status);};
  realtimeHub.on('system_event:sandbox:'+merchant,observer);
  check((await send(created('create-later','out-of-order'))).status==='PROCESSED','creation repairs previously deferred resolution');
  realtimeHub.off('system_event:sandbox:'+merchant,observer);
  check(dispute('out-of-order').status==='RESOLVED' && dispute('out-of-order').outcome===null,'missing outcome remains unknown instead of becoming a seller win');
  check(receipt('resolve-first').state==='PROCESSED' && observed.length>0 && observed.every(s=>s==='RESOLVED'),'deferred resolution commits before creation notifications are delivered');
  check((await send(event('late-open','CUSTOMER.DISPUTE.UPDATED',{dispute_id:'out-of-order',status:'WAITING_FOR_SELLER_RESPONSE',update_time:newest},newest))).status==='IGNORED' && dispute('out-of-order').status==='RESOLVED','late updates cannot reopen a terminal dispute');
  const final=event('confirmed-outcome','CUSTOMER.DISPUTE.RESOLVED',{dispute_id:'out-of-order',update_time:newest,dispute_outcome:{outcome_code:'RESOLVED_BUYER_FAVOUR'}},newest);
  check((await send(final)).status==='PROCESSED' && dispute('out-of-order').outcome==='RESOLVED_BUYER_FAVOUR','newer resolution can supply an authoritative outcome');
  const conflict={...final,id:'conflicting-outcome',resource:{...final.resource,dispute_outcome:{outcome_code:'RESOLVED_SELLER_FAVOUR'}}};
  check((await send(conflict)).status==='DEAD_LETTER' && dispute('out-of-order').outcome==='RESOLVED_BUYER_FAVOUR','conflicting terminal outcomes at one timestamp require review');

  await send(created('ordered'));
  check((await send(event('ordered-update','CUSTOMER.DISPUTE.UPDATED',{dispute_id:'ordered',status:'UNDER_REVIEW',update_time:newest,seller_response_due_date:'2026-12-15T00:00:00Z'},newest))).status==='PROCESSED','newer update applies provider status and deadline');
  check((await send(event('old-update','CUSTOMER.DISPUTE.UPDATED',{dispute_id:'ordered',status:'WAITING_FOR_SELLER_RESPONSE',update_time:later},later))).status==='IGNORED' && dispute('ordered').status==='UNDER_REVIEW','older update cannot overwrite newer state');
  check((await send(event('tied-update','CUSTOMER.DISPUTE.UPDATED',{dispute_id:'ordered',status:'WAITING_FOR_SELLER_RESPONSE',update_time:newest},newest))).status==='DEAD_LETTER' && dispute('ordered').status==='UNDER_REVIEW','conflicting updates with tied timestamps require review instead of silently overwriting');
  const noDeadline=created('no-deadline');delete (noDeadline.resource as any).seller_response_due_date;
  check((await send(noDeadline)).status==='PROCESSED' && dispute('no-deadline').response_deadline==='','missing deadline remains unknown');
  check((await send({...created('repeat-create','ordered'),create_time:newest})).status==='IGNORED','duplicate creation with a different event ID preserves existing state');
  check((await send(event('unknown','UNHANDLED.EVENT',{id:'unknown'}))).status==='IGNORED' && receipt('unknown').state==='IGNORED','unsupported events are explicitly recorded as ignored');
  check((await send(event('missing-id','CUSTOMER.DISPUTE.CREATED',{status:'OPEN'}))).status==='DEAD_LETTER','invalid verified resource becomes visible dead letter');

  await send(event('dead-dependency','CUSTOMER.DISPUTE.RESOLVED',{dispute_id:'very-late',update_time:later},later));
  db.prepare("UPDATE webhook_inbox SET attempts=9,next_attempt_at=0 WHERE event_id='dead-dependency'").run();
  check(scoped(()=>processInboxEvent('dead-dependency')).status==='DEAD_LETTER','retry attempts are bounded');
  await send(created('very-late-create','very-late'));
  check(dispute('very-late').status==='RESOLVED' && receipt('dead-dependency').state==='PROCESSED','late dependency arrival can recover an exhausted deferred resolution');

  const old=created('legacy-receipt');
  db.prepare('INSERT INTO paypal_events VALUES(?,?,?,?,?,?,?,?)').run('legacy',old.id,old.event_type,old.resource_type,'',JSON.stringify(old),'PROCESSED',now);
  check((await send(old)).status==='PROCESSED' && dispute('legacy-receipt'),'legacy processed receipts do not suppress missing business state');

  db.prepare(`INSERT INTO demo_orders(id,order_number,buyer_name,buyer_email,shipping_address,items,total_cents,paypal_order_id,created_at,provenance)
    VALUES('linked-order','ORDER-1','Buyer','buyer@example.test','Test Street','[]',1234,'PAYPAL-ORDER',?,'PAYPAL_SANDBOX')`).run(now);
  const correlated=capture('correlated-capture','CAP-LINKED');
  correlated.resource.supplementary_data={related_ids:{order_id:'PAYPAL-ORDER'}};
  await send(correlated);
  const correlatedDispute=created('correlated-dispute');
  correlatedDispute.resource.disputed_transactions=[{seller_transaction_id:'CAP-LINKED'}];
  await send(correlatedDispute);
  check(dispute('correlated-dispute').order_id==='linked-order','capture identity correlates a dispute with its provider order');
  check((db.prepare("SELECT order_id FROM evidence_items WHERE id=(SELECT evidence_id FROM paypal_captures WHERE capture_id='CAP-LINKED')").get() as any).order_id==='linked-order','capture evidence is linked to its known order');
  const beforeCapture=created('dispute-before-capture');
  beforeCapture.resource.disputed_transactions=[{seller_transaction_id:'CAP-LATE'}];
  await send(beforeCapture);
  check(dispute('dispute-before-capture').order_id===null,'missing capture mapping remains unknown');
  const lateCapture=capture('late-capture','CAP-LATE');lateCapture.resource.supplementary_data={related_ids:{order_id:'PAYPAL-ORDER'}};
  await send(lateCapture);
  check(dispute('dispute-before-capture').order_id==='linked-order','late capture repairs an existing dispute association');

  const snapshot=count('evidence_items');
  const conflictingCapture=capture('conflicting-capture','capture-one');conflictingCapture.resource.amount.value='99.00';
  check((await send(conflictingCapture)).status==='DEAD_LETTER' && count('evidence_items')===snapshot,'conflicting facts for an existing capture do not replace its evidence');

  // Recovery from a separate process proves receipts survive module and process lifetimes.
  db.exec("CREATE TRIGGER restart_failure BEFORE INSERT ON paypal_captures WHEN NEW.capture_id='restart' BEGIN SELECT RAISE(ABORT,'temporary failure'); END;");
  await send(capture('restart'));db.exec('DROP TRIGGER restart_failure');
  const child=spawnSync(process.execPath,['--import','tsx','scripts/retry-webhooks.ts','--event-id','restart','--force'],{env:process.env,encoding:'utf8',timeout:30000});
  // Other intentional dead letters make the CLI exit nonzero; the targeted event must still recover.
  assert.equal(receipt('restart').state,'PROCESSED',child.stderr || child.stdout);
  check(true,'separate retry process recovers persisted event');
  check(withMerchantScope(foreign,()=>(getDb().prepare('SELECT COUNT(*) AS n FROM webhook_inbox').get() as any).n)===0,'retry processing stays within configured merchant workspace');

  const originalConfigured=paypalClient.isConfigured, originalVerifier=paypalClient.verifyWebhookSignature;
  paypalClient.isConfigured=()=>true;paypalClient.verifyWebhookSignature=async()=>true;
  const httpHeaders={'content-type':'application/json','paypal-auth-algo':headers.authAlgo,'paypal-cert-url':headers.certUrl,'paypal-transmission-id':headers.transmissionId,'paypal-transmission-sig':headers.transmissionSig,'paypal-transmission-time':headers.transmissionTime};
  const req=(body:string,h:Record<string,string>=httpHeaders)=>new NextRequest('http://localhost:3000/api/webhooks/paypal',{method:'POST',headers:h,body});
  try {
    check((await route.POST(req('{'))).status===400,'HTTP route rejects malformed JSON');
    check((await route.POST(req(JSON.stringify({...capture('oversized'),summary:'x'.repeat(270000)})))).status===413,'HTTP route bounds webhook body size');
    check((await route.POST(req(JSON.stringify(capture('no-signature')),{'content-type':'application/json'}))).status===401,'HTTP route requires verification headers');
    check((await route.POST(req(JSON.stringify(capture('http-route'))))).status===200,'configured public route projects into its server-selected merchant');
  } finally {paypalClient.isConfigured=originalConfigured;paypalClient.verifyWebhookSignature=originalVerifier;}
  realtimeHub.off('system_event:sandbox:'+merchant,listener);
  console.log(`\n${checks} webhook reliability checks passed.`);
}
main().catch(error=>{console.error(error);process.exit(1);});
