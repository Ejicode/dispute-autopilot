import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { UserAccount } from '../types';
import { authDb } from './store';
import { merchantScope, withMerchantScope } from './context';

export const SESSION_COOKIE = 'dispute_session';
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const PUBLIC_ACCOUNT_FIELDS = 'id, email, name, store_name, role, avatar_url, created_at';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function sessionUser(req: NextRequest): UserAccount | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = authDb().prepare(`SELECT ${PUBLIC_ACCOUNT_FIELDS.split(', ').map(f => `a.${f}`).join(', ')}
    FROM accounts a JOIN sessions s ON s.user_id = a.id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(tokenHash(token), Date.now()) as UserAccount | undefined;
  return row || null;
}

export function requireUser(req: NextRequest): UserAccount {
  const user = sessionUser(req);
  if (!user) throw new HttpError(401, 'Sign in to continue.');
  return user;
}

export function assertSameOrigin(req: NextRequest): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const expected = process.env.APP_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : req.nextUrl.origin);
  if (!expected) throw new HttpError(503, 'APP_ORIGIN must be configured.');
  if (req.headers.get('origin') !== new URL(expected).origin) throw new HttpError(403, 'Request origin is not allowed.');
}

export function revokeSession(req: NextRequest): void {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) authDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' });

export function setSession(req: NextRequest, response: NextResponse, userId: string): void {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  authDb().transaction(() => {
    revokeSession(req);
    authDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    authDb().prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .run(tokenHash(token), userId, now + SESSION_DURATION_MS, now);
  })();
  response.cookies.set(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_DURATION_MS / 1000 });
}

export function clearSession(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
}

export function routeError(error: unknown): NextResponse {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  console.error('Request failed:', error);
  return NextResponse.json({ error: 'Unable to complete the request.' }, { status: 500 });
}

type RouteContext = { params: { id: string } };
type MerchantHandler = (req: NextRequest, context: RouteContext, user: UserAccount) => Promise<Response>;

/** Enter business services only with an authenticated, server-selected workspace. */
export function withMerchant(handler: MerchantHandler) {
  return async (req: NextRequest, context: RouteContext) => {
    try {
      const user = requireUser(req);
      assertSameOrigin(req);
      const { response, mode } = await withMerchantScope(user.id, async () => ({
        response: await handler(req, context, user), mode: merchantScope().mode,
      }), user);
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Application-Mode', mode);
      return response;
    } catch (error) { return routeError(error); }
  };
}
