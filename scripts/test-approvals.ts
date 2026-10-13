import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

async function main() {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(),'approval-tests-'));
  process.env.APP_ORIGIN = 'http://localhost:3000';
  for (const key of ['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','GEMINI_API_KEY','OPENAI_API_KEY']) delete process.env[key];
  const { withMerchantScope } = await import('../src/lib/auth/context');
  const { authDb } = await import('../src/lib/auth/store');
  const { tokenHash } = await import('../src/lib/auth/session');
  const { getDb } = await import('../src/lib/db');
  const { calculateSha256 } = await import('../src/lib/vault/vault');
  const { paypalClient } = await import('../src/lib/paypal/client');
  const route = await import('../src/app/api/disputes/[id]/approve/route');
  const verify = await import('../src/app/api/disputes/[id]/verify-draft/route');
  const merchant = 'usr_'+'a'.repeat(32), foreign = 'usr_'+'b'.repeat(32);
  for (const [id,token] of [[merchant,'a'.repeat(64)],[foreign,'b'.repeat(64)]]) {
    authDb().prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(id,id+'@test.example','Test','Test Store','MERCHANT_ADMIN',null,'unused',new Date().toISOString());
    authDb().prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash(token),id,Date.now()+600000,Date.now());
  }
  const scoped = <T>(fn:()=>T) => withMerchantScope(merchant,fn);
  const request = (method:string,body?:unknown,query='',cookie='a'.repeat(64)) => new NextRequest('http://localhost:3000/api/approve'+query,{
    method,headers:{origin:process.env.APP_ORIGIN!,cookie:`dispute_session=${cookie}`,'content-type':'application/json'},
    ...(body !== undefined ? {body:JSON.stringify(body)} : {}),
  });
  const ctx=(id:string)=>({params:{id}});
  const post=(id:string,body:unknown)=>route.POST(request('POST',body),ctx(id));
  const preview=(id:string,action='PROVIDE_EVIDENCE')=>route.GET(request('GET',undefined,`?action_type=${action}`),ctx(id));
  const input=(review:any)=>({action_type:review.snapshot.action_type,snapshot_digest:review.snapshot_digest});
  let checks=0, calls=0;
  const check=(condition:unknown,label:string)=>{ assert.ok(condition,label); console.log('PASS '+label); checks++; };
  const readOp=(id:string)=>scoped(()=>getDb().prepare('SELECT * FROM approval_operations WHERE dispute_id=?').get(id)) as any;
  function fixture(id:string,draft=true) {
    scoped(()=>{
      const db=getDb(), now=new Date().toISOString();
      db.prepare(`INSERT INTO disputes(id,paypal_dispute_id,transaction_id,reason,amount_cents,status,response_deadline,created_at,updated_at)
        VALUES(?,?,?,'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',10000,'REQUIRED_ACTION',?,?,?)`)
        .run(id,'PP-'+id,'TX-'+id,new Date(Date.now()+3600000).toISOString(),now,now);
      if (!draft) return;
      const content=JSON.stringify({carrier:'USPS',tracking_number:'TRACK-'+id});
      db.prepare(`INSERT INTO evidence_items(id,dispute_id,evidence_type,source,title,content,sha256_hash,captured_at)
        VALUES(?,?,'TRACKING_HISTORY','TEST','Tracking',?,?,?)`).run('ev-'+id,id,content,calculateSha256(content),now);
      db.prepare(`INSERT INTO ai_drafts(id,dispute_id,classification,draft_text,claims,model_name,verified,created_at)
        VALUES(?,?,'INR',?,?,'test',1,?)`).run('draft-'+id,id,'Recorded tracking: TRACK-'+id,JSON.stringify([{claim_id:'c1',claim_type:'TRACKING_NUMBER',text:'Recorded tracking',expected_value:'TRACK-'+id,evidence_id:'ev-'+id}]),now);
    });
  }
  const originalProvide=paypalClient.provideEvidence.bind(paypalClient);
  const originalAccept=paypalClient.acceptClaim.bind(paypalClient);
  const acknowledge=async()=>{ calls++; return {success:true,result:{acknowledged:true}}; };
  paypalClient.provideEvidence=acknowledge;
  paypalClient.acceptClaim=acknowledge;
  fixture('strict');
  for (const body of [{},{action_type:'TYPO'},{action_type:null},{action_type:['ACCEPT_CLAIM']},null,[],{action_type:'ACCEPT_CLAIM'}]) {
    check((await post('strict',body)).status===400,'invalid approval body rejected');
  }
  const malformed=new NextRequest('http://localhost:3000/api/approve',{method:'POST',headers:{origin:process.env.APP_ORIGIN!,'content-type':'application/json',cookie:'dispute_session='+'a'.repeat(64)},body:'{'});
  check((await route.POST(malformed,ctx('strict'))).status===400,'malformed JSON cannot fall through to execution');
  const strictReview=await (await preview('strict')).json();
  for (const field of ['notes','evidence_ids','amount_cents','approver','idempotency_key']) {
    check((await post('strict',{...input(strictReview),[field]:'override'})).status===400,`client ${field} override rejected`);
  }
  check(calls===0 && !readOp('strict'),'invalid input never reserves or calls provider');
  check((await route.GET(request('GET',undefined,'?action_type=ACCEPT_CLAIM','b'.repeat(64)),ctx('strict'))).status===404,'foreign merchant cannot review action');
  check((await route.POST(request('POST',input(strictReview),'','b'.repeat(64)),ctx('strict'))).status===404,'foreign merchant cannot approve action');
  const before=scoped(()=>getDb().prepare('SELECT claims FROM ai_drafts WHERE id=?').get('draft-strict'));
  check((await verify.POST(request('POST',{claims:[]}),ctx('strict'))).status===400,'claims cannot be replaced independently of narrative');
  assert.deepEqual(scoped(()=>getDb().prepare('SELECT claims FROM ai_drafts WHERE id=?').get('draft-strict')),before);
  check((await verify.POST(request('POST',{}),ctx('strict'))).status===200,'stored draft can be reverified');

  for (const [id,sql,value] of [
    ['draft-change','UPDATE ai_drafts SET draft_text=? WHERE dispute_id=?','Edited after review'],
    ['amount-change','UPDATE disputes SET amount_cents=? WHERE id=?',12000],
    ['evidence-change','UPDATE evidence_items SET title=? WHERE dispute_id=?','Changed evidence metadata'],
    ['deadline-change','UPDATE disputes SET response_deadline=? WHERE id=?',new Date(Date.now()+7200000).toISOString()],
  ] as const) {
    fixture(id); const review=await (await preview(id)).json();
    scoped(()=>getDb().prepare(sql).run(value,id));
    check((await post(id,input(review))).status===409 && !readOp(id),`${id} invalidates reviewed digest`);
  }
  fixture('latest'); const latest=await (await preview('latest')).json();
  scoped(()=>getDb().prepare(`INSERT INTO ai_drafts SELECT 'new-draft',dispute_id,classification,draft_text,claims,schema_valid,model_name,verified,verification_errors,created_at FROM ai_drafts WHERE id='draft-latest'`).run());
  check((await post('latest',input(latest))).status===409,'new draft with equal timestamp invalidates review');
  fixture('corrupt'); scoped(()=>getDb().prepare("UPDATE evidence_items SET content='changed' WHERE dispute_id='corrupt'").run());
  check((await preview('corrupt')).status===422,'stale evidence checksum blocks approval');
  fixture('unverified'); scoped(()=>getDb().prepare("UPDATE ai_drafts SET verified=0 WHERE dispute_id='unverified'").run());
  check((await preview('unverified')).status===422,'unverified evidence submission blocked');
  for (const deadline of ['invalid','2000-01-01T00:00:00Z']) {
    scoped(()=>getDb().prepare("UPDATE disputes SET response_deadline=? WHERE id='strict'").run(deadline));
    check((await preview('strict','ACCEPT_CLAIM')).status===422,'expired or unknown deadline blocks execution');
  }
  fixture('resolved'); scoped(()=>getDb().prepare("UPDATE disputes SET status='RESOLVED' WHERE id='resolved'").run());
  check((await preview('resolved','ACCEPT_CLAIM')).status===409,'resolved dispute cannot start operation');
  fixture('no-draft',false); const acceptance=await (await preview('no-draft','ACCEPT_CLAIM')).json();
  check(acceptance.snapshot.draft_id===null,'acceptance can be reviewed without an evidence draft');
  check((await post('no-draft',input(acceptance))).status===200,'acceptance without a draft executes');
  check(readOp('no-draft').executed_at && readOp('no-draft').approver===merchant,'execution time and actor recorded after acknowledgement');
  check(scoped(()=>(getDb().prepare("SELECT status FROM disputes WHERE id='no-draft'").get() as any).status)==='UNDER_REVIEW','acceptance awaits authoritative resolution');

  fixture('concurrent'); const concurrent=await (await preview('concurrent')).json();
  let entered!:()=>void, release!:(result:any)=>void;
  const started=new Promise<void>(resolve=>entered=resolve);
  const gate=new Promise<any>(resolve=>release=resolve);
  let sent:any;
  paypalClient.provideEvidence=async (_id,snapshot,key)=>{calls++; sent={snapshot:structuredClone(snapshot),key}; entered(); return gate;};
  const callCount=calls;
  const first=post('concurrent',input(concurrent)); await started;
  check(readOp('concurrent').state==='SUBMITTING' && readOp('concurrent').executed_at===null,'reservation precedes provider call without claiming execution');
  check((await post('concurrent',input(concurrent))).status===202,'concurrent duplicate sees existing in-progress operation');
  check((await post('concurrent',{action_type:'ACCEPT_CLAIM',snapshot_digest:concurrent.snapshot_digest})).status===409,'competing action cannot bypass dispute reservation');
  check(calls===callCount+1,'concurrent requests call provider exactly once');
  assert.deepEqual(sent.snapshot,concurrent.snapshot);
  check(sent.key===readOp('concurrent').idempotency_key,'provider receives persisted snapshot and stable operation identity');
  scoped(()=>getDb().prepare("UPDATE disputes SET status='RESOLVED',outcome='RESOLVED_BUYER_FAVOUR',updated_at=? WHERE id='concurrent'").run(new Date().toISOString()));
  release({success:true,result:{acknowledged:true}});
  const success=await first; const successBody=await success.json();
  check(success.status===200 && successBody.dispute.status==='RESOLVED','submission cannot overwrite resolution received while awaiting provider');
  const retry=await post('concurrent',input(concurrent));
  assert.deepEqual(await retry.json(),successBody);
  check(retry.status===200 && calls===callCount+1,'completed retry returns saved result without new provider call');
  assert.throws(()=>scoped(()=>getDb().prepare("UPDATE approval_operations SET snapshot='{}' WHERE dispute_id='concurrent'").run()),/immutable/);
  check(true,'database rejects snapshot mutation');

  fixture('timeout'); const timeout=await (await preview('timeout')).json();
  paypalClient.provideEvidence=async()=>{calls++;throw new Error('simulated connection loss after sending');};
  const timeoutBefore=calls;
  const failed=await post('timeout',input(timeout));
  check(failed.status===409 && (await failed.json()).state==='UNCERTAIN','provider exception persists uncertain outcome');
  check(readOp('timeout').executed_at===null,'uncertain operation is not marked executed');
  check((await post('timeout',input(timeout))).status===409 && calls===timeoutBefore+1,'uncertain operation cannot automatically resubmit');
  const uncertain=await (await preview('timeout')).json();
  check(uncertain.operation.state==='UNCERTAIN','status remains visible after reloading review');

  // Exercise real client serialization with transport replaced; no network or credentials.
  const originalFetch=globalThis.fetch, originalToken=paypalClient.getAccessToken, originalConfigured=paypalClient.isConfigured;
  const requests: any[]=[];
  paypalClient.getAccessToken=async()=> 'test-token'; paypalClient.isConfigured=()=>true;
  globalThis.fetch=async (url,options)=>{ requests.push({url,options}); return new Response('{}',{status:200}); };
  try {
    await scoped(()=>originalProvide('concurrent',concurrent.snapshot,'stable-test'));
    await scoped(()=>originalAccept('no-draft',acceptance.snapshot,'stable-accept'));
    assert.equal(requests[0].options.body,JSON.stringify(concurrent.snapshot.provider_payload));
    assert.equal(requests[1].options.body,JSON.stringify(acceptance.snapshot.provider_payload));
    check(requests[0].options.headers['PayPal-Request-Id']==='stable-test','provider transport sends exactly the reviewed body and stable key');
    check(!requests[0].options.body.includes('TRK-98214-USPS') && !requests[1].options.body.includes('DID_NOT_SHIP_ITEM'),'provider does not invent tracking or a reason for accepting');
  } finally { globalThis.fetch=originalFetch; paypalClient.getAccessToken=originalToken; paypalClient.isConfigured=originalConfigured; }
  console.log(`\n${checks} approval safety checks passed.`);
}
main().catch(error=>{ console.error(error); process.exit(1); });
