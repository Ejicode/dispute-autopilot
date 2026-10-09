import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runDisputeBench } from '@/lib/bench/runner';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM bench_runs ORDER BY created_at DESC LIMIT 50').all();
  return NextResponse.json({ runs });
}

export async function POST() {
  try {
    const summary = await runDisputeBench();
    return NextResponse.json(summary);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
