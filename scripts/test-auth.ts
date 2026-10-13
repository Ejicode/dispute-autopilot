import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

async function main() {
  // These tests never open the development database or use provider credentials.
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dispute-auth-test-'));
  process.env.APP_ORIGIN = 'http://localhost:3000';
  for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_USER_ID', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) delete process.env[key];
  const auth = await import('../src/app/api/auth/route');
  const login = await import('../src/app/api/auth/login/route');
  const { authDb } = await import('../src/lib/auth/store');
  const { withMerchantScope } = await import('../src/lib/auth/context');
  const { getDb } = await import('../src/lib/db');
  const { SESSION_COOKIE, tokenHash, withMerchant } = await import('../src/lib/auth/session');
  const { realtimeHub } = await import('../src/lib/realtime/hub');
  const { paypalClient } = await import('../src/lib/paypal/client');
  const routes = {
    disputes: await import('../src/app/api/disputes/route'),
    detail: await import('../src/app/api/disputes/[id]/route'),
    approval: await import('../src/app/api/disputes/[id]/approve/route'),
    verify: await import('../src/app/api/disputes/[id]/verify-draft/route'),
    packet: await import('../src/app/api/disputes/[id]/packet/route'),
    checkout: await import('../src/app/api/storefront/checkout/route'),
    carrier: await import('../src/app/api/carrier/update/route'),
    analytics: await import('../src/app/api/analytics/route'),
    search: await import('../src/app/api/search/route'),
    chat: await import('../src/app/api/ai-assistant/route'),
    bench: await import('../src/app/api/bench/run/route'),
    attacks: await import('../src/app/api/trust-lab/run/route'),
    stream: await import('../src/app/api/events/stream/route'),
  };
  const context = (id = 'unknown') => ({ params: { id } });
  const request = (method = 'GET', cookie = '', body?: unknown, url = '/api/test', origin = 'http://localhost:3000') => new NextRequest(`http://localhost:3000${url}`, {
    method, headers: { origin, cookie, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let checks = 0;
  function check(condition: unknown, label: string) { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); }

  assert.throws(() => getDb(), /Merchant context/);
  check(true, 'unscoped business database access fails closed');
  for (const [name, route] of Object.entries(routes)) {
    for (const method of ['GET', 'POST'] as const) {
      const handler = (route as any)[method];
      if (handler) check((await handler(request(method, '', method === 'POST' ? {} : undefined), context())).status === 401, `${method} ${name} rejects anonymous callers`);
    }
  }
  check((await auth.GET(request())).status === 401, 'account enumeration requires a session');
  check((await auth.GET(request('GET', `${SESSION_COOKIE}=forged`))).status === 401, 'forged session rejected');
  const registration = { name: 'Merchant A', email: 'a@example.test', store_name: 'Store A', password: 'a sufficiently long test passphrase' };
  check((await auth.POST(request('POST', '', { ...registration, password: 'short' }))).status === 400, 'short password rejected');
  check((await auth.POST(request('POST', '', registration, '/api/auth', 'https://attacker.example'))).status === 403, 'cross-origin registration rejected');
  check((await auth.POST(request('POST', '', registration, '/api/auth', ''))).status === 403, 'missing origin rejected');
  const malformed = new NextRequest('http://localhost:3000/api/auth', {method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:'{'});
  check((await auth.POST(malformed)).status === 400, 'invalid JSON rejected');
  check((await auth.POST(request('POST', '', { ...registration, name: 'x'.repeat(9000) }))).status === 413, 'oversized auth request rejected');

  const registeredA = await auth.POST(request('POST', '', registration));
  check(registeredA.status === 201, 'merchant A registered');
  let cookieA = registeredA.headers.get('set-cookie')!.split(';')[0];
  const userA = (await registeredA.json()).user;
  check(/HttpOnly/i.test(registeredA.headers.get('set-cookie')!) && /SameSite=lax/i.test(registeredA.headers.get('set-cookie')!), 'session cookie has HttpOnly and SameSite');
  check(!('password_hash' in userA), 'registration does not disclose password hash');
  const stored = authDb().prepare('SELECT password_hash FROM accounts WHERE id=?').get(userA.id) as any;
  check(stored.password_hash.startsWith('scrypt-v1:') && !stored.password_hash.includes(registration.password), 'password stored as salted scrypt hash');
  const token = cookieA.split('=')[1];
  check(Boolean(authDb().prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(tokenHash(token))), 'session token stored only as a digest');
  check((await auth.POST(request('POST', '', { ...registration, email: 'A@EXAMPLE.TEST' }))).status === 409, 'duplicate normalized email rejected');

  const registeredB = await auth.POST(request('POST', '', { ...registration, name:'Merchant B',email:'b@example.test',store_name:'Store B' }));
  check(registeredB.status === 201, 'merchant B registered');
  const cookieB = registeredB.headers.get('set-cookie')!.split(';')[0];
  const userB = (await registeredB.json()).user;
  const current = await (await auth.GET(request('GET', cookieA, undefined, `/api/auth?user_id=${userB.id}`))).json();
  check(current.user.id === userA.id && !current.users, 'session endpoint returns only authenticated identity');
  const wrong = await login.POST(request('POST', '', { email:registration.email,password:'incorrect password' }));
  const unknown = await login.POST(request('POST', '', { email:'unknown@example.test',password:'incorrect password' }));
  check(wrong.status === 401 && unknown.status === 401 && (await wrong.json()).error === (await unknown.json()).error, 'invalid and unknown credentials have the same response');
  const signedIn = await login.POST(request('POST', cookieA, {email:'A@EXAMPLE.TEST',password:registration.password}));
  check(signedIn.status === 200, 'correct credentials sign in with normalized email');
  check((await auth.GET(request('GET',cookieA))).status === 401, 'sign-in rotates and revokes previous session');
  cookieA = signedIn.headers.get('set-cookie')!.split(';')[0];
  const originalMode = process.env.NODE_ENV;
  Object.assign(process.env, {NODE_ENV:'production'});
  const secureLogin = await login.POST(request('POST', '', {email:registration.email,password:registration.password}));
  Object.assign(process.env, {NODE_ENV:originalMode || 'test'});
  check(/; Secure/i.test(secureLogin.headers.get('set-cookie')!), 'production session cookie is Secure');
  const expiringCookie = secureLogin.headers.get('set-cookie')!.split(';')[0];
  authDb().prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').run(tokenHash(expiringCookie.split('=')[1]));
  check((await auth.GET(request('GET',expiringCookie))).status === 401, 'expired session rejected');

  const orderInput = { buyer_name:'Private A Buyer',buyer_email:'buyer-a@example.test',shipping_address:'1 Test Street',items:[{name:'Test',sku:'test',quantity:1,unit_price_cents:10000}] };
  check((await routes.checkout.POST(request('POST',cookieA,orderInput,'/api/storefront/checkout','https://attacker.example'),context())).status === 403, 'cross-origin business mutation rejected');
  const orderA = (await (await routes.checkout.POST(request('POST',cookieA,orderInput),context())).json()).order;
  const orderB = (await (await routes.checkout.POST(request('POST',cookieB,{...orderInput,buyer_name:'Private B Buyer',buyer_email:'buyer-b@example.test'}),context())).json()).order;
  const ordersB = await (await routes.checkout.GET(request('GET',cookieB),context())).json();
  check(ordersB.orders.length === 1 && ordersB.orders[0].id === orderB.id, 'merchant B cannot list A orders');
  const disputeA = (await (await routes.disputes.POST(request('POST',cookieA,{order_id:orderA.id,amount_cents:10000}),context())).json()).dispute;
  check(Boolean(disputeA.id), 'merchant A creates its own dispute');
  check((await routes.disputes.POST(request('POST',cookieB,{order_id:orderA.id}),context())).status === 404, 'foreign order cannot be attached to a dispute');
  check((await routes.carrier.POST(request('POST',cookieB,{order_id:orderA.id,target_status:'DELIVERED'}),context())).status === 404, 'foreign order cannot be mutated');
  for (const [name, method] of [['detail','GET'],['packet','GET'],['verify','POST'],['approval','POST']] as const) {
    const handler = (routes[name] as any)[method];
    check((await handler(request(method,cookieB,method==='POST'?{}:undefined),context(disputeA.id))).status === 404, `${name} conceals a foreign dispute`);
  }
  const listB = await (await routes.disputes.GET(request('GET',cookieB),context())).json();
  check(listB.disputes.length === 0, 'merchant B cannot list A disputes');
  const analyticsB = await (await routes.analytics.GET(request('GET',cookieB),context())).json();
  check(analyticsB.kpis.totalDisputes === 0 && analyticsB.kpis.orderCount === 1, 'analytics contains only current merchant data');
  const searchB = await (await routes.search.GET(request('GET',cookieB,undefined,`/api/search?q=${disputeA.paypal_dispute_id}`),context())).json();
  check(searchB.results.length === 0, 'search cannot reveal another merchant dispute');
  const sourceIsConfigured = paypalClient.isConfigured;
  paypalClient.isConfigured = () => true;
  process.env.PAYPAL_MERCHANT_USER_ID = userB.id;
  check((await routes.approval.POST(request('POST',cookieA,{action_type:'ACCEPT_CLAIM'}),context(disputeA.id))).status === 403, 'merchant cannot use another workspace PayPal credentials');
  paypalClient.isConfigured = sourceIsConfigured;
  delete process.env.PAYPAL_MERCHANT_USER_ID;
  const approval = await routes.approval.POST(request('POST',cookieA,{action_type:'ACCEPT_CLAIM',approver:userB.id}),context(disputeA.id));
  check(approval.status === 200, 'authenticated owner can execute a mocked action');
  const approved = withMerchantScope(userA.id,()=>getDb().prepare('SELECT approver FROM approvals WHERE dispute_id=?').get(disputeA.id)) as any;
  check(approved.approver === userA.id, 'audit approver comes from session, not request body');

  withMerchantScope(userB.id,()=>getDb().prepare("INSERT INTO ai_chat_messages VALUES('private-b',?,'user','Private B conversation',?)").run(userB.id,new Date().toISOString()));
  const chatA = await (await routes.chat.GET(request('GET',cookieA,undefined,`/api/ai-assistant?user_id=${userB.id}`),context())).json();
  check(chatA.messages.length === 0, 'chat history cannot select another user');
  await routes.chat.POST(request('POST',cookieA,{user_id:userB.id,message:'hello'}),context());
  const chatOwner = withMerchantScope(userA.id,()=>getDb().prepare('SELECT DISTINCT user_id FROM ai_chat_messages').all()) as any[];
  check(chatOwner.length === 1 && chatOwner[0].user_id === userA.id, 'chat writes use session identity');

  const interleaved = withMerchant(async (_req,_ctx,user) => {
    await new Promise(resolve => setTimeout(resolve,10));
    return NextResponse.json({id:user.id,order:(getDb().prepare('SELECT id FROM demo_orders LIMIT 1').get() as any).id});
  });
  const [a,b] = await Promise.all([interleaved(request('GET',cookieA),context()),interleaved(request('GET',cookieB),context())]);
  check((await a.json()).order === orderA.id && (await b.json()).order === orderB.id, 'interleaved async requests keep distinct workspaces');
  const webhook = await import('../src/app/api/webhooks/paypal/route');
  check((await webhook.POST(request('POST','',{id:'fake',event_type:'PAYMENT.CAPTURE.COMPLETED'}))).status === 503, 'unconfigured public webhook fails closed');
  const sourceVerify = paypalClient.verifyWebhookSignature;
  const sourceWebhookId = process.env.PAYPAL_WEBHOOK_ID;
  paypalClient.isConfigured = () => true;
  process.env.PAYPAL_WEBHOOK_ID = 'test-webhook';
  process.env.PAYPAL_MERCHANT_USER_ID = userA.id;
  const providerEvent = {id:'owned-event',event_type:'PAYMENT.CAPTURE.COMPLETED',resource_type:'capture',resource:{id:'private-capture',amount:{value:'12.00',currency_code:'USD'}}};
  paypalClient.verifyWebhookSignature = async () => false;
  check((await webhook.POST(request('POST','',providerEvent))).status === 401, 'configured webhook rejects failed signature verification');
  paypalClient.verifyWebhookSignature = async () => true;
  check((await webhook.POST(request('POST',cookieB,providerEvent,`/api/webhooks/paypal?user_id=${userB.id}`))).status === 200, 'verified webhook accepts configured owner despite foreign browser identity');
  const countProviderEvents = (id: string) => withMerchantScope(id,()=> (getDb().prepare('SELECT COUNT(*) AS n FROM paypal_events WHERE event_id=?').get(providerEvent.id) as any).n);
  check(countProviderEvents(userA.id) === 1 && countProviderEvents(userB.id) === 0, 'webhook persists only in server-configured merchant workspace');
  paypalClient.isConfigured = sourceIsConfigured;
  paypalClient.verifyWebhookSignature = sourceVerify;
  delete process.env.PAYPAL_MERCHANT_USER_ID;
  if (sourceWebhookId === undefined) delete process.env.PAYPAL_WEBHOOK_ID;
  else process.env.PAYPAL_WEBHOOK_ID = sourceWebhookId;

  const streamA = await routes.stream.GET(request('GET',cookieA),context());
  const streamB = await routes.stream.GET(request('GET',cookieB),context());
  const readerA = streamA.body!.getReader(); const readerB = streamB.body!.getReader();
  await readerA.read(); await readerB.read();
  withMerchantScope(userA.id,()=>realtimeHub.publish('ORDER_CAPTURED',{secret:'A-only'}));
  withMerchantScope(userB.id,()=>realtimeHub.publish('ORDER_CAPTURED',{secret:'B-only'}));
  const eventA = new TextDecoder().decode((await readerA.read()).value);
  const eventB = new TextDecoder().decode((await readerB.read()).value);
  check(eventA.includes('A-only') && !eventA.includes('B-only') && eventB.includes('B-only') && !eventB.includes('A-only'), 'SSE events are isolated by merchant');
  check((await auth.DELETE(request('DELETE',cookieA,undefined,'/api/auth','https://attacker.example'))).status === 403, 'cross-origin logout rejected');
  const logout = await auth.DELETE(request('DELETE',cookieA));
  check(logout.status === 200 && /Max-Age=0/i.test(logout.headers.get('set-cookie')!), 'logout clears cookie');
  check((await auth.GET(request('GET',cookieA))).status === 401, 'logout revokes server-side session');
  withMerchantScope(userA.id,()=>realtimeHub.publish('ORDER_CAPTURED',{secret:'after logout'}));
  check((await readerA.read()).done, 'revoked session stops existing SSE stream before further delivery');
  await readerB.cancel();
  check(realtimeHub.listenerCount(`system_event:${userA.id}`) === 0 && realtimeHub.listenerCount(`system_event:${userB.id}`) === 0, 'SSE disconnect cleans listeners');
  authDb().prepare('INSERT OR REPLACE INTO auth_attempts VALUES(?,8,?)').run(tokenHash('rate@example.test'),Date.now()+900000);
  check((await login.POST(request('POST','',{email:'rate@example.test',password:registration.password}))).status === 429, 'repeated sign-in attempts are rate limited');
  console.log(`\n${checks} authentication and isolation checks passed. Temporary data: ${process.env.DATA_DIR}`);
}

main().catch(error => { console.error(error); process.exit(1); });
