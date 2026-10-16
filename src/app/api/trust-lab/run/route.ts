import { requireDemo } from '@/lib/runtime/safety';
import { withMerchant } from '@/lib/auth/session';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runAllTrustLabAttacks } from '@/lib/trust-lab/attacks';

export const dynamic = 'force-dynamic';

async function handleGET() {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM attack_runs ORDER BY run_date DESC LIMIT 30').all();
  return NextResponse.json({ runs });
}

async function handlePOST() {
  requireDemo();
  try {
    const results = await runAllTrustLabAttacks();
    return NextResponse.json({ results, allBlocked: results.every((r) => r.blocked) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export const GET = withMerchant(handleGET);

export const POST = withMerchant(handlePOST);
