import { NextRequest, NextResponse } from 'next/server';
import { authDb } from '@/lib/auth/store';
import { verifyPassword } from '@/lib/auth/password';
import { credentials, readAuthBody, throttle } from '@/lib/auth/validation';
import { assertSameOrigin, HttpError, PUBLIC_ACCOUNT_FIELDS, routeError, setSession } from '@/lib/auth/session';
import type { UserAccount } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { email, password } = credentials(await readAuthBody(req));
    throttle(email);
    const row = authDb().prepare(`SELECT ${PUBLIC_ACCOUNT_FIELDS}, password_hash FROM accounts WHERE email=?`)
      .get(email) as (UserAccount & { password_hash: string }) | undefined;
    if (!await verifyPassword(password, row?.password_hash) || !row) throw new HttpError(401, 'Invalid email or password.');
    const { password_hash: _, ...user } = row;
    const response = NextResponse.json({ success: true, user }, { headers: { 'Cache-Control': 'no-store' } });
    setSession(req, response, user.id);
    return response;
  } catch (error) { return routeError(error); }
}
