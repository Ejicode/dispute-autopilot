import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { authDb } from '@/lib/auth/store';
import { hashPassword } from '@/lib/auth/password';
import { credentials, field, readAuthBody, throttle } from '@/lib/auth/validation';
import { assertSameOrigin, clearSession, HttpError, PUBLIC_ACCOUNT_FIELDS, requireUser, revokeSession, routeError, setSession } from '@/lib/auth/session';
import type { UserAccount } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({ user: requireUser(req) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeError(error); }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const body = await readAuthBody(req);
    const { email, password } = credentials(body, true);
    const name = field(body, 'name', 100);
    const storeName = field(body, 'store_name', 120);
    let avatar: string | null = null;
    if (body.avatar_url) {
      avatar = field(body, 'avatar_url', 2048);
      try { if (new URL(avatar).protocol !== 'https:') throw new Error(); }
      catch { throw new HttpError(400, 'Avatar must use an HTTPS URL.'); }
    }
    throttle(email);
    const passwordHash = await hashPassword(password);
    const id = 'usr_' + crypto.randomBytes(16).toString('hex');
    const db = authDb();
    const result = db.prepare(`INSERT OR IGNORE INTO accounts
      (id,email,name,store_name,role,avatar_url,password_hash,created_at) VALUES(?,?,?,?,'MERCHANT_ADMIN',?,?,?)`)
      .run(id, email, name, storeName, avatar, passwordHash, new Date().toISOString());
    if (!result.changes) throw new HttpError(409, 'Unable to register this email. Try signing in.');
    const user = db.prepare(`SELECT ${PUBLIC_ACCOUNT_FIELDS} FROM accounts WHERE id=?`).get(id) as UserAccount;
    const response = NextResponse.json({ success: true, user }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    setSession(req, response, id);
    return response;
  } catch (error) { return routeError(error); }
}

export async function DELETE(req: NextRequest) {
  try {
    assertSameOrigin(req);
    revokeSession(req);
    const response = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
    clearSession(response);
    return response;
  } catch (error) { return routeError(error); }
}
