import { loadEnvConfig } from '@next/env';
import { withMerchantScope } from '../src/lib/auth/context';
import { authDb } from '../src/lib/auth/store';
import { PUBLIC_ACCOUNT_FIELDS } from '../src/lib/auth/session';
import { getDb } from '../src/lib/db';
import { retryWebhookEvents } from '../src/lib/paypal/webhooks';
import type { UserAccount } from '../src/lib/types';

loadEnvConfig(process.cwd());

function main() {
  const args=process.argv.slice(2);
  let eventId: string|undefined, force=false, list=false, limit=100;
  for (let index=0;index<args.length;index++) {
    switch (args[index]) {
      case '--event-id': eventId=args[++index]; if (!eventId) throw new Error('--event-id requires a value'); break;
      case '--limit': limit=Number(args[++index]); break;
      case '--force': force=true; break;
      case '--list': list=true; break;
      default: throw new Error('Usage: npm run webhooks:retry -- [--list] [--limit 100] [--event-id EVENT_ID --force]');
    }
  }
  if (!Number.isInteger(limit)||limit<1||limit>1000) throw new Error('--limit must be between 1 and 1000');
  if (force && !eventId) throw new Error('--force requires --event-id');
  const owner=process.env.PAYPAL_MERCHANT_USER_ID;
  if (!owner || !/^usr_[a-f0-9]{32}$/.test(owner)) throw new Error('Set PAYPAL_MERCHANT_USER_ID to the configured integration owner.');
  const user=authDb().prepare(`SELECT ${PUBLIC_ACCOUNT_FIELDS} FROM accounts WHERE id=?`).get(owner) as UserAccount|undefined;
  if (!user) throw new Error('Configured merchant account does not exist in this DATA_DIR.');
  withMerchantScope(owner,()=>{
    if (list) {
      console.table(getDb().prepare(`SELECT event_id,event_type,state,attempts,next_attempt_at,last_error FROM webhook_inbox
        WHERE state NOT IN ('PROCESSED','IGNORED') ORDER BY received_at LIMIT ?`).all(limit));
      return;
    }
    const results=retryWebhookEvents({limit,eventId,force});
    console.table(results);
    const states=getDb().prepare('SELECT state,COUNT(*) AS count FROM webhook_inbox GROUP BY state').all() as {state:string;count:number}[];
    console.table(states);
    if (results.some(result=>result.statusCode>=400)||states.some(row=>row.state==='DEAD_LETTER' && row.count>0)) process.exitCode=1;
  },user);
}
try { main(); } catch (error) { console.error(error instanceof Error?error.message:error); process.exitCode=1; }
