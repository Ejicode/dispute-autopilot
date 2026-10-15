import crypto from 'node:crypto';
import { HttpError } from './session';

const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const shared = globalThis as typeof globalThis & { disputePasswordWork?: { running: number } };
const work = shared.disputePasswordWork ??= { running: 0 };

async function derive(password: string, salt: string): Promise<Buffer> {
  if (work.running >= 2) throw new HttpError(429, 'Sign-in service is busy. Please try again shortly.');
  work.running++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, OPTIONS, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { work.running--; }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored?: string): Promise<boolean> {
  const parts = stored?.split(':');
  const valid = parts?.length === 3 && parts[0] === 'scrypt-v1' && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{128}$/.test(parts[2]);
  // Unknown accounts perform the same expensive operation to reduce enumeration.
  const actual = await derive(password, valid ? parts![1] : '00000000000000000000000000000000');
  const expected = valid ? Buffer.from(parts![2], 'hex') : Buffer.alloc(64);
  return crypto.timingSafeEqual(actual, expected) && Boolean(valid);
}
