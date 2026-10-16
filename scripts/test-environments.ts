import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { spawnSync } from 'node:child_process';

async function main() {
  process.env.DATA_DIR=mkdtempSync(path.join(tmpdir(),'environment-tests-'));
  process.env.APP_MODE='demo'; process.env.APP_ORIGIN='http://localhost:3000';
  process.env.PAYPAL_ENVIRONMENT='sandbox'; process.env.PAYPAL_CLIENT_ID='test-id'; process.env.PAYPAL_CLIENT_SECRET='test-secret';
  const merchant='usr_'+'e'.repeat(32);
  process.env.PAYPAL_MERCHANT_USER_ID=merchant; process.env.PAYPAL_WEBHOOK_ID='test-webhook';
  const {withMerchantScope,merchantScope}=await import('../src/lib/auth/context');
  const {applicationMode}=await import('../src/lib/runtime/mode');
  const {getDb}=await import('../src/lib/db');
  const {authDb}=await import('../src/lib/auth/store');
  const {tokenHash}=await import('../src/lib/auth/session');
  const {PayPalClient}=await import('../src/lib/paypal/client');
  const {reviewAction,executeApproval}=await import('../src/lib/approvals/service');
  const {realtimeHub}=await import('../src/lib/realtime/hub');
  const {advanceCarrierStatus}=await import('../src/lib/carrier/simulator');
  const {runDisputeBench}=await import('../src/lib/bench/runner');
  const {runAllTrustLabAttacks}=await import('../src/lib/trust-lab/attacks');
  const {processPayPalWebhook}=await import('../src/lib/paypal/webhooks');
  const runtime=await import('../src/app/api/runtime/route');
  const webhook=await import('../src/app/api/webhooks/paypal/route');
  const routes=await Promise.all(['disputes','storefront/checkout','carrier/update','trust-lab/run','bench/run'].map(name=>import('../src/app/api/'+name+'/route')));
  const now=new Date().toISOString();
  authDb().prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?)').run(merchant,'mode@example.test','Mode Test','Store','MERCHANT_ADMIN',null,'unused',now);
  const user=authDb().prepare('SELECT * FROM accounts WHERE id=?').get(merchant) as any;
  const token='e'.repeat(64);
  authDb().prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash(token),merchant,Date.now()+600000,Date.now());
  const scoped=<T>(work:()=>T)=>withMerchantScope(merchant,work,user);
  const request=(method='POST',body:unknown={},cookie=token)=>new NextRequest('http://localhost:3000/api/test?mode=demo',{
    method,headers:{origin:'http://localhost:3000','content-type':'application/json',cookie:'dispute_session='+cookie,'x-application-mode':'demo'},
    ...(method==='POST'?{body:JSON.stringify(body)}:{}),
  });
  let checks=0;
  const check=(condition:unknown,label:string)=>{assert.ok(condition,label);checks++;console.log('PASS '+label);};
  const rejects=async(work:()=>unknown,label:string)=>{await assert.rejects(async()=>await work());check(true,label);};
  function fixture(id:string,provenance?:string) {
    const db=getDb();
    db.prepare(`INSERT INTO disputes(id,paypal_dispute_id,transaction_id,reason,amount_cents,status,response_deadline,created_at,updated_at${provenance?',provenance':''})
      VALUES(?,?,?,'OTHER',1000,'REQUIRED_ACTION',?,?,?${provenance?',?':''})`)
      .run(id,'PP-'+id,'TX-'+id,new Date(Date.now()+3600000).toISOString(),now,now,...(provenance?[provenance]:[]));
  }
  const snapshot=(id:string)=>({environment:merchantScope().mode,action_type:'ACCEPT_CLAIM' as const,dispute_id:id,paypal_dispute_id:'PP-'+id,amount_cents:1000,currency:'USD',evidence_ids:[],notes:'Seller accepted buyer claim.',timestamp:now,provider_payload:{note:'Seller accepted buyer claim.'}});
  let calls:{url:string;body:unknown}[]=[];
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    calls.push({url:String(url),body:options?.body});
    return new Response(JSON.stringify(String(url).endsWith('/token')?{access_token:'token',expires_in:3600}:{}),{status:200});
  };
  try {
    delete process.env.APP_MODE; check(applicationMode()==='demo','missing APP_MODE is offline demo');
    process.env.APP_MODE='typo'; assert.throws(applicationMode,/APP_MODE/); check(true,'unknown mode fails closed');
    process.env.APP_MODE='demo';
    const demo=scoped(()=>{fixture('demo');return getDb();});
    const demoClient=new PayPalClient();
    const demoSnapshot=scoped(()=>snapshot('demo'));
    const result=await scoped(()=>demoClient.acceptClaim('demo',demoSnapshot,'demo-operation'));
    check(result.result.simulation===true && !result.result.refund_completed && calls.length===0,'demo credentials never cause provider calls or claim completed refunds');
    await rejects(()=>scoped(()=>demoClient.getAccessToken()),'demo cannot acquire provider tokens');
    check((await webhook.POST(request())).status===503,'public webhook is disabled in demo even with credentials');
    check((demo.prepare("SELECT provenance FROM disputes WHERE id='demo'").get() as any).provenance==='DEMO','demo provenance is persisted');
    assert.throws(()=>demo.prepare("UPDATE disputes SET provenance='PAYPAL_LIVE' WHERE id='demo'").run(),/immutable/);
    assert.throws(()=>demo.prepare("UPDATE environment_identity SET mode='live'").run(),/immutable/);
    check(true,'record and database environment identities cannot be updated');
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>release=resolve);
    const delayed=scoped(async()=>{await gate;return {mode:merchantScope().mode,db:getDb()};});
    process.env.APP_MODE='sandbox';release();
    const captured=await delayed;
    check(captured.mode==='demo' && captured.db===demo,'in-flight requests retain their original environment');
    const sandbox=scoped(()=>getDb());
    check(sandbox!==demo && !sandbox.prepare("SELECT id FROM disputes WHERE id='demo'").get(),'sandbox cannot read demo records for the same merchant');
    const config=await runtime.GET(request('GET'),{params:{id:''}});
    const configBody=await config.json();
    check(configBody.mode==='sandbox' && !configBody.simulation_enabled && config.headers.get('x-application-mode')==='sandbox','runtime API ignores client-selected mode');
    check((await runtime.GET(request('GET',{},'invalid'),{params:{id:''}})).status===401,'runtime metadata requires authentication');
    for (const [index,route] of routes.entries()) check((await route.POST(request(),{params:{id:'unused'}})).status===403,'sandbox blocks simulation route '+index);
    await rejects(()=>scoped(()=>advanceCarrierStatus('missing')),'direct carrier simulator is blocked in sandbox');
    await rejects(()=>scoped(()=>runDisputeBench()),'direct benchmark writes are blocked in sandbox');
    await rejects(()=>scoped(()=>runAllTrustLabAttacks()),'direct Trust Lab writes are blocked in sandbox');
    check(!sandbox.prepare('SELECT id FROM disputes LIMIT 1').get(),'blocked simulations leave operational database unchanged');
    scoped(()=>{fixture('unknown');fixture('foreign-demo','DEMO');fixture('sandbox','PAYPAL_SANDBOX');});
    check((sandbox.prepare("SELECT provenance FROM disputes WHERE id='unknown'").get() as any).provenance==='UNKNOWN','unclassified operational inserts default to UNKNOWN');
    for (const id of ['unknown','foreign-demo']) {
      await rejects(()=>scoped(()=>reviewAction(id,'ACCEPT_CLAIM')),'approval rejects incorrect provenance '+id);
      await rejects(()=>scoped(()=>demoClient.acceptClaim(id,snapshot(id),'blocked')),'transport rejects incorrect provenance '+id);
    }
    await rejects(()=>scoped(()=>demoClient.acceptClaim('sandbox',{...snapshot('sandbox'),environment:'demo'},'blocked')),'transport rejects cross-environment reviewed snapshots');
    await rejects(()=>scoped(()=>executeApproval('foreign-demo','ACCEPT_CLAIM','0'.repeat(64))),'invalid provenance cannot reserve an approval operation');
    check(!sandbox.prepare("SELECT id FROM approval_operations WHERE dispute_id='foreign-demo'").get(),'rejected approval leaves no operation reservation');
    sandbox.prepare(`INSERT INTO evidence_items(id,dispute_id,evidence_type,source,title,content,sha256_hash,captured_at,provenance)
      VALUES('demo-evidence','sandbox','TRACKING_HISTORY','CARRIER_SIMULATOR','Demo','{}','unused',?,'DEMO')`).run(now);
    await rejects(()=>scoped(()=>reviewAction('sandbox','PROVIDE_EVIDENCE')),'operational evidence review rejects demo evidence');
    await rejects(()=>scoped(()=>demoClient.acceptClaim('sandbox',{...snapshot('sandbox'),evidence_ids:['demo-evidence']},'blocked')),'provider transport rejects demo evidence in a reviewed action');
    check(calls.length===0,'all provenance rejections happen before network access');
    const missingId=process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_ID;
    const missingClient=new PayPalClient();process.env.PAYPAL_CLIENT_ID=missingId;
    await rejects(()=>scoped(()=>missingClient.acceptClaim('sandbox',snapshot('sandbox'),'blocked')),'sandbox missing credentials cannot silently simulate success');
    const savedOwner=process.env.PAYPAL_MERCHANT_USER_ID;process.env.PAYPAL_MERCHANT_USER_ID='usr_'+'f'.repeat(32);
    await rejects(()=>scoped(()=>demoClient.acceptClaim('sandbox',snapshot('sandbox'),'blocked')),'provider credentials cannot cross merchant ownership');
    process.env.PAYPAL_MERCHANT_USER_ID=savedOwner;
    const sandboxResult=await scoped(()=>demoClient.acceptClaim('sandbox',snapshot('sandbox'),'sandbox-op'));
    check(sandboxResult.success && calls.length===2 && calls.every(call=>call.url.startsWith('https://api-m.sandbox.paypal.com/')),'sandbox adapter uses only sandbox endpoints');
    const headers={authAlgo:'SHA256withRSA',certUrl:'https://example.test/cert',transmissionId:'test',transmissionSig:'test',transmissionTime:now};
    const providerEvent={id:'mode-event',event_type:'CUSTOMER.DISPUTE.CREATED',resource_type:'dispute',create_time:now,resource:{dispute_id:'PP-WEBHOOK',status:'WAITING_FOR_SELLER_RESPONSE',reason:'OTHER',dispute_amount:{value:'10.00',currency_code:'USD'},disputed_transactions:[{seller_transaction_id:'TX-WEBHOOK'}]}};
    const received=await scoped(()=>processPayPalWebhook(headers,providerEvent,async()=>true));
    check(received.status==='PROCESSED' && (sandbox.prepare("SELECT provenance FROM disputes WHERE paypal_dispute_id='PP-WEBHOOK'").get() as any).provenance==='PAYPAL_SANDBOX','verified sandbox projection stamps sandbox provenance');
    const countBefore=calls.length;
    let demoNotes=0,sandboxNotes=0;
    const onDemo=()=>demoNotes++,onSandbox=()=>sandboxNotes++;
    realtimeHub.on('system_event:demo:'+merchant,onDemo);realtimeHub.on('system_event:sandbox:'+merchant,onSandbox);
    scoped(()=>realtimeHub.publish('DISPUTE_OPENED',{}));
    realtimeHub.off('system_event:demo:'+merchant,onDemo);realtimeHub.off('system_event:sandbox:'+merchant,onSandbox);
    check(demoNotes===0 && sandboxNotes===1,'realtime notifications are isolated by environment');
    process.env.APP_MODE='live';
    const live=scoped(()=>getDb());
    check(!live.prepare('SELECT id FROM disputes LIMIT 1').get(),'live cannot read sandbox or demo cases');
    scoped(()=>fixture('live','PAYPAL_LIVE'));
    await rejects(()=>scoped(()=>demoClient.acceptClaim('live',snapshot('live'),'blocked')),'live mode rejects sandbox-configured client');
    check(calls.length===countBefore,'environment mismatch fails before network access');
    process.env.PAYPAL_ENVIRONMENT='live';const liveClient=new PayPalClient();
    await scoped(()=>liveClient.acceptClaim('live',snapshot('live'),'live-op'));
    check(calls.slice(countBefore).length===2 && calls.slice(countBefore).every(call=>call.url.startsWith('https://api-m.paypal.com/')),'live adapter uses live endpoints only with matching explicit settings and provenance');
    for (const route of routes) check((await route.POST(request(),{params:{id:'unused'}})).status===403,'live mode rejects simulation writes');
    // A copied database cannot be silently reclassified by moving it to another mode path.
    const copiedMerchant='usr_'+'1'.repeat(32);
    const copiedPath=path.join(process.env.DATA_DIR!,'environments','sandbox','merchants',copiedMerchant+'.db');
    await demo.backup(copiedPath);
    process.env.APP_MODE='sandbox';
    assert.throws(()=>withMerchantScope(copiedMerchant,()=>getDb()),/environment does not match/);
    check(true,'copied demo database cannot be opened as sandbox');
    const legacyMerchant='usr_'+'2'.repeat(32);
    const legacyPath=path.join(process.env.DATA_DIR!,'environments','sandbox','merchants',legacyMerchant+'.db');
    const legacy=new Database(legacyPath);legacy.exec('CREATE TABLE old_records(id TEXT)');legacy.close();
    assert.throws(()=>withMerchantScope(legacyMerchant,()=>getDb()),/Unclassified database/);
    check(true,'unclassified databases require reviewed migration');
    const seed=spawnSync(process.execPath,['--import','tsx','scripts/seed.ts'],{env:process.env,encoding:'utf8',timeout:30000});
    check(seed.status!==0 && !existsSync(path.join(process.env.DATA_DIR!,'environments','sandbox','merchants','demo.db')),'seed command refuses operational mode before opening a database');
    check(calls.length===countBefore+2,'tests used only the controlled HTTP transport');
  } finally {globalThis.fetch=originalFetch;}
  console.log(`\n${checks} environment isolation checks passed.`);
}
main().catch(error=>{console.error(error);process.exit(1);});
