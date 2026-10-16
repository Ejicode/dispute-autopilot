import { requireDemo } from '@/lib/runtime/safety';
import { withMerchant } from '@/lib/auth/session';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runDisputeBench } from '@/lib/bench/runner';

export const dynamic = 'force-dynamic';

async function handleGET() {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM bench_runs ORDER BY created_at DESC LIMIT 50').all();
  return NextResponse.json({ runs });
}

async function handlePOST() {
  requireDemo();
  try {
    const summary = await runDisputeBench();
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export const GET = withMerchant(handleGET);

export const POST = withMerchant(handlePOST);
