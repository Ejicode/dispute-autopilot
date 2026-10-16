import { NextResponse } from 'next/server';
import { authDb } from '@/lib/auth/store';
import { applicationMode } from '@/lib/runtime/mode';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    applicationMode();
    authDb().prepare('SELECT 1').get();
    return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
