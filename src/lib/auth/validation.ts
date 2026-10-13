import { NextRequest } from 'next/server';
import { authDb } from './store';
import { HttpError, tokenHash } from './session';

export async function readAuthBody(req: NextRequest): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'JSON is required.');
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new HttpError(413, 'Request is too large.'); }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new HttpError(400, 'Invalid JSON object.'); }
}

export function field(body: Record<string, unknown>, key: string, max: number): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `Invalid ${key}.`);
  return value.trim();
}

export function credentials(body: Record<string, unknown>, registration = false) {
  const email = field(body, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const password = body.password;
  if (typeof password !== 'string' || password.length > 128 || password.length < (registration ? 15 : 1)) {
    throw new HttpError(400, registration ? 'Use a password between 15 and 128 characters.' : 'Invalid password.');
  }
  return { email, password };
}

export function throttle(email: string): void {
  const db = authDb();
  const now = Date.now();
  const limits = [{ key: 'global', max: 120, window: 60000 }, { key: tokenHash(email), max: 8, window: 900000 }];
  const allowed = db.transaction(() => {
    db.prepare('DELETE FROM auth_attempts WHERE resets_at <= ?').run(now);
    for (const limit of limits) {
      const row = db.prepare('SELECT count FROM auth_attempts WHERE key=?').get(limit.key) as {count:number} | undefined;
      if (row && row.count >= limit.max) return false;
    }
    for (const limit of limits) db.prepare(`INSERT INTO auth_attempts(key,count,resets_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1`).run(limit.key, now + limit.window);
    return true;
  })();
  if (!allowed) throw new HttpError(429, 'Too many attempts. Please try again later.');
}
