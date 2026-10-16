import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

async function main() {
  process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),'reconciliation-tests-'));
  process.env.APP_MODE='sandbox';process.env.PAYPAL_ENVIRONMENT='sandbox';process.env.APP_ORIGIN='http://localhost:3000';
  process.env.PAYPAL_CLIENT_ID='test-client';process.env.PAYPAL_CLIENT_SECRET='test-secret';
  const owner='usr_'+'a'.repeat(32), foreign='usr_'+'b'.repeat(32), cookie='a'.repeat(64);
  process.env.PAYPAL_MERCHANT_USER_ID=owner;
  const {withMerchantScope}=await import('../src/lib/auth/context');
  const {authDb}=await import('../src/lib/auth/store');
  const {tokenHash}=await import('../src/lib/auth/session');
  const {getDb}=await import('../src/lib/db');
  const {paypalClient}=await import('../src/lib/paypal/client');
  const route=await import('../src/app/api/disputes/[id]/reconcile/route');
  const approval=await import('../src/app/api/disputes/[id]/approve/route');
  const {realtimeHub}=await import('../src/lib/realtime/hub');
  for (const [id,token] of [[owner,cookie],[foreign,'b'.repeat(64)]]) {
    authDb().prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(id,id+'@test.example','Test','Store','MERCHANT_ADMIN',null,'unused',new Date().toISOString());
    authDb().prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash(token),id,Date.now()+600000,Date.now());
  }
  const scoped=<T>(fn:()=>T)=>withMerchantScope(owner,fn);
  const db=scoped(()=>getDb());
  const now=new Date().toISOString(),old=new Date(Date.now()-300000).toISOString(),older=new Date(Date.now()-600000).toISOString();
  function fixture(id:string,state='UNCERTAIN',updated=old,provenance='PAYPAL_SANDBOX') {
    db.prepare(`INSERT INTO disputes(id,paypal_dispute_id,transaction_id,reason,amount_cents,status,response_deadline,created_at,updated_at,provenance)
      VALUES(?,?,?,'OTHER',1000,'REQUIRED_ACTION',?,?,?,?)`).run(id,'PP-'+id,'TX-'+id,new Date(Date.now()+3600000).toISOString(),old,old,provenance);
    const snapshot=JSON.stringify({environment:'sandbox',paypal_dispute_id:'PP-'+id});
    db.prepare(`INSERT INTO approval_operations(id,dispute_id,action_type,snapshot_digest,snapshot,approver,idempotency_key,state,created_at,updated_at)
      VALUES(?,?,'ACCEPT_CLAIM',?,?,?,?,?,?,?)`).run('op-'+id,id,'0'.repeat(64),snapshot,owner,'key-'+id,state,old,updated);
  }
  const request=(method='POST',body:unknown={},token=cookie,origin='http://localhost:3000')=>new NextRequest('http://localhost:3000/api/reconcile',{
    method,headers:{origin,cookie:'dispute_session='+token,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{}),
  });
  const post=(id:string,body:unknown={})=>route.POST(request('POST',body),{params:{id}});
  const read=(id:string)=>db.prepare('SELECT * FROM disputes WHERE id=?').get(id) as any;
  const op=(id:string)=>db.prepare('SELECT * FROM approval_operations WHERE dispute_id=?').get(id) as any;
  const count=(table:string,id:string)=>(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE dispute_id=?`).get(id) as any).n;
  const details=(id:string,status='UNDER_REVIEW',time=now)=>({dispute_id:'PP-'+id,status,update_time:time,dispute_amount:{value:'10.00',currency_code:'USD'}});
  let checks=0,calls=0;
  const check=(value:unknown,label:string)=>{assert.ok(value,label);checks++;console.log('PASS '+label);};
  const originalFetch=globalThis.fetch;
  let respond:(url:string)=>Promise<Response>=async url=>new Response(JSON.stringify(details(decodeURIComponent(url.split('/').at(-1)!).slice(3))));
  const network:{url:string;method:string}[]=[];
  globalThis.fetch=async (url,options)=>{
    network.push({url:String(url),method:options?.method||'GET'});
    if (String(url).endsWith('/token')) return new Response(JSON.stringify({access_token:'test-token',expires_in:3600}));
    calls++;return respond(String(url));
  };
  try {
    fixture('auth');
    check((await route.POST(request('POST',{},'invalid'),{params:{id:'auth'}})).status===401,'anonymous reconciliation rejected');
    check((await route.GET(request('GET',{},'invalid'),{params:{id:'auth'}})).status===401,'anonymous history rejected');
    check((await route.POST(request('POST',{},'b'.repeat(64)),{params:{id:'auth'}})).status===404,'foreign merchant cannot reconcile');
    check((await route.GET(request('GET',{},'b'.repeat(64)),{params:{id:'auth'}})).status===404,'foreign merchant cannot read history');
    check((await route.POST(request('POST',{},cookie,'https://evil.example'),{params:{id:'auth'}})).status===403,'cross-origin reconciliation rejected');
    check((await post('auth',{status:'RESOLVED'})).status===400,'client cannot supply provider state');
    fixture('fresh','SUBMITTING',now);
    check((await post('fresh')).status===409 && op('fresh').state==='SUBMITTING','active submission cannot be reconciled early');
    fixture('success','SUCCEEDED');check((await post('success')).status===409,'acknowledged operation is not reclassified');
    fixture('wrong-origin','UNCERTAIN',old,'DEMO');check((await post('wrong-origin')).status===422,'mismatched record provenance rejected');
    check(calls===0,'authorization and state checks run before provider lookup');
    fixture('stale-submission','SUBMITTING');
    const recovered=await (await post('stale-submission')).json();
    check(recovered.result==='APPLIED' && recovered.dispute.status==='UNDER_REVIEW','provider lifecycle observation updates stale local state');
    check(op('stale-submission').state==='UNCERTAIN' && op('stale-submission').executed_at===null,'stale submission becomes uncertain without fabricated acknowledgement');
    check(recovered.retry_allowed===false,'reconciliation never authorizes a blind retry');
    const prior=calls;
    check((await post('stale-submission')).status===429 && calls===prior,'repeated reconciliation respects cooldown');
    const history=await (await route.GET(request('GET'),{params:{id:'stale-submission'}})).json();
    check(history.history.length===1 && history.history[0].actor===owner && history.operation.provider_request_id==='key-stale-submission','history exposes actor and stable provider request identity');
    assert.throws(()=>db.prepare("UPDATE dispute_reconciliations SET message='forged'").run(),/immutable/);
    assert.throws(()=>db.prepare('DELETE FROM dispute_reconciliations').run(),/immutable/);
    check(true,'reconciliation observations are immutable');
    const approvalRetry=await approval.POST(new NextRequest('http://localhost:3000/api/approve',{method:'POST',headers:{origin:'http://localhost:3000',cookie:'dispute_session='+cookie,'content-type':'application/json'},body:JSON.stringify({action_type:'ACCEPT_CLAIM',snapshot_digest:'0'.repeat(64)})}),{params:{id:'stale-submission'}});
    check(approvalRetry.status===409 && calls===prior,'original approval retry still cannot resubmit');
    fixture('terminal');respond=async()=>new Response(JSON.stringify({...details('terminal','RESOLVED'),dispute_outcome:{outcome_code:'RESOLVED_BUYER_FAVOUR'}}));
    check((await (await post('terminal')).json()).dispute.outcome==='RESOLVED_BUYER_FAVOUR','provider outcome is stored without inventing a seller win');
    check(op('terminal').state==='UNCERTAIN' && op('terminal').executed_at===null,'terminal dispute does not prove our operation executed');
    fixture('unknown-outcome');respond=async()=>new Response(JSON.stringify(details('unknown-outcome','RESOLVED')));
    check((await (await post('unknown-outcome')).json()).dispute.outcome===null,'missing provider outcome remains unknown');
    fixture('stale');db.prepare('INSERT INTO paypal_dispute_versions VALUES(?,?,?)').run('PP-stale',Date.parse(now),'webhook-new');
    respond=async()=>new Response(JSON.stringify(details('stale','UNDER_REVIEW',older)));
    check((await (await post('stale')).json()).result==='STALE' && read('stale').status==='REQUIRED_ACTION','older provider snapshot cannot overwrite newer webhook state');
    fixture('tied');db.prepare('INSERT INTO paypal_dispute_versions VALUES(?,?,?)').run('PP-tied',Date.parse(now),'webhook-tie');
    respond=async()=>new Response(JSON.stringify(details('tied')));
    check((await (await post('tied')).json()).result==='CONFLICT','conflicting equal-version snapshot requires review');
    fixture('closed');db.prepare("UPDATE disputes SET status='RESOLVED' WHERE id='closed'").run();respond=async()=>new Response(JSON.stringify(details('closed')));
    check((await (await post('closed')).json()).result==='CONFLICT' && read('closed').status==='RESOLVED','terminal dispute cannot reopen automatically');
    for (const [id,value] of [
      ['wrong-id',details('different')],['missing-time',{dispute_id:'PP-missing-time',status:'RESOLVED'}],
      ['bad-status',details('bad-status','UNKNOWN')],['bad-amount',{...details('bad-amount'),dispute_amount:{value:'99.00',currency_code:'USD'}}],
      ['bad-date',{...details('bad-date'),seller_response_due_date:'yesterday'}],['bad-outcome',{...details('bad-outcome'),dispute_outcome:{}}],
    ] as const) {
      fixture(id);respond=async()=>new Response(JSON.stringify(value));
      check((await post(id)).status===502 && read(id).status==='REQUIRED_ACTION' && count('dispute_reconciliations',id)===1,'invalid provider observation fails closed: '+id);
    }
    for (const [id,handler] of [
      ['timeout',async()=>{throw new Error('private provider failure');}],
      ['provider-404',async()=>new Response('sensitive details',{status:404})],
      ['invalid-json',async()=>new Response('{')],
      ['oversized',async()=>new Response('x'.repeat(1024*1024+1))],
    ] as const) {
      fixture(id);respond=handler;
      const response=await post(id),body=await response.json();
      check(response.status===502 && body.result==='ERROR' && !JSON.stringify(body).includes('sensitive') && !JSON.stringify(body).includes('private provider'),'provider failure recorded without success or leaked details: '+id);
      check(!db.prepare('SELECT * FROM reconciliation_leases WHERE dispute_id=?').get(id),'failure releases lease: '+id);
    }
    fixture('concurrent');let entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
    respond=async()=>{entered();await gate;return new Response(JSON.stringify(details('concurrent')));};
    const first=post('concurrent');await started;const before=calls;
    check((await post('concurrent')).status===409 && calls===before,'concurrent callers perform one provider lookup');
    db.prepare("UPDATE disputes SET status='RESOLVED',updated_at=? WHERE id='concurrent'").run(now);
    release();const concurrentBody=await (await first).json();
    check(concurrentBody.result==='SUPERSEDED' && read('concurrent').status==='RESOLVED','webhook change during lookup wins over stale observation');
    fixture('late-ack','SUBMITTING');let ackEntered!:()=>void,ackRelease!:()=>void;
    const ackStarted=new Promise<void>(resolve=>ackEntered=resolve),ackGate=new Promise<void>(resolve=>ackRelease=resolve);
    respond=async()=>{ackEntered();await ackGate;return new Response(JSON.stringify(details('late-ack')));};
    const ackRead=post('late-ack');await ackStarted;
    db.prepare("UPDATE approval_operations SET state='SUCCEEDED',executed_at=? WHERE dispute_id='late-ack'").run(now);ackRelease();
    check((await (await ackRead).json()).result==='SUPERSEDED' && op('late-ack').state==='SUCCEEDED','late acknowledgement is preserved');
    fixture('crash-lease');db.prepare('INSERT INTO reconciliation_leases VALUES(?,?,?)').run('crash-lease','dead-process',Date.now()-1);respond=async()=>new Response(JSON.stringify(details('crash-lease')));
    check((await post('crash-lease')).status===200,'expired lease from crashed worker can be recovered');
    fixture('replaced-lease');let leaseEntered!:()=>void,leaseRelease!:()=>void;
    const leaseStarted=new Promise<void>(resolve=>leaseEntered=resolve),leaseGate=new Promise<void>(resolve=>leaseRelease=resolve);
    respond=async()=>{leaseEntered();await leaseGate;return new Response(JSON.stringify(details('replaced-lease')));};
    const oldWorker=post('replaced-lease');await leaseStarted;
    db.prepare("UPDATE reconciliation_leases SET token='new-worker',expires_at=? WHERE dispute_id='replaced-lease'").run(Date.now()+90000);
    leaseRelease();
    check((await oldWorker).status===409 && read('replaced-lease').status==='REQUIRED_ACTION','superseded worker cannot apply its response');
    check((db.prepare("SELECT token FROM reconciliation_leases WHERE dispute_id='replaced-lease'").get() as any).token==='new-worker','old worker cannot release another worker lease');
    fixture('waiting');respond=async()=>new Response(JSON.stringify(details('waiting','WAITING_FOR_SELLER_RESPONSE')));
    const waiting=await (await post('waiting')).json();
    check(waiting.result==='UNCHANGED' && waiting.retry_allowed===false && op('waiting').state==='UNCERTAIN','provider waiting for evidence is not proof the earlier request failed');
    const notes:any[]=[];const listener=(value:any)=>notes.push(value);
    realtimeHub.on('system_event:sandbox:'+owner,listener);
    fixture('rollback');db.exec("CREATE TRIGGER fail_reconciliation BEFORE INSERT ON dispute_reconciliations WHEN NEW.dispute_id='rollback' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
    respond=async()=>new Response(JSON.stringify(details('rollback')));
    check((await post('rollback')).status===500 && read('rollback').status==='REQUIRED_ACTION' && !db.prepare("SELECT * FROM paypal_dispute_versions WHERE paypal_dispute_id='PP-rollback'").get(),'failed observation persistence rolls back lifecycle and provider version');
    check(notes.length===0,'rollback emits no reconciliation notification');
    db.exec('DROP TRIGGER fail_reconciliation');check((await post('rollback')).status===200,'database failure can be retried safely');
    check(notes.length===1 && notes[0].type==='DISPUTE_RECONCILED','successful state synchronization emits notification after commit');
    realtimeHub.off('system_event:sandbox:'+owner,listener);
    check(network.every(n=>n.method==='GET' || n.url.endsWith('/oauth2/token')),'reconciliation transport never calls a payment action');
    check(network.filter(n=>n.method==='GET').every(n=>n.url.startsWith('https://api-m.sandbox.paypal.com/v1/customer/disputes/')),'provider reads use fixed sandbox origin and dispute endpoint');
    process.env.APP_MODE='demo';
    check((await scoped(()=>paypalClient.getDisputeDetails('missing')).then(()=>false,()=>true)),'demo cannot query provider state');
  } finally {globalThis.fetch=originalFetch;}
  console.log(`\n${checks} reconciliation checks passed.`);
}
main().catch(error=>{console.error(error);process.exit(1);});
