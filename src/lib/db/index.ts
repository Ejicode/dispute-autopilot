import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { merchantScope } from '../auth/context';
import type { AppMode } from '../runtime/mode';
import { dataDirectory } from './storage';
import { initSchema } from './baseline';
import { migrate } from './migrations';

const runtime = globalThis as typeof globalThis & { disputeDatabases?: Map<string, Database.Database> };
const databases = runtime.disputeDatabases ??= new Map<string, Database.Database>();

export function getDb(): Database.Database {
  const { merchantId, user, mode } = merchantScope();
  const directory = path.join(dataDirectory(), 'environments', mode, 'merchants');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, `${merchantId}.db`);
  let db = databases.get(filename);
  if (!db) {
    db = new Database(filename);
    fs.chmodSync(filename, 0o600);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    try {
      db.transaction(() => bindEnvironment(db!, mode)).immediate();
      migrate(db, [{ version: 1, name: 'environment-classified-baseline', up: () => initSchema(db!, mode) }]);
    } catch (error) { db.close(); throw error; }
    databases.set(filename, db);
  }
  // Business queries receive only this merchant's public profile, never credentials.
  if (user) db.prepare(`INSERT OR IGNORE INTO users
    (id,name,email,store_name,role,avatar_url,created_at) VALUES(?,?,?,?,?,?,?)`)
    .run(user.id,user.name,user.email,user.store_name,user.role,user.avatar_url || null,user.created_at);
  return db;
}

function bindEnvironment(db: Database.Database, mode: AppMode) {
  const marker = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='environment_identity'").get();
  if (!marker) {
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get();
    if (existing) throw new Error('Unclassified database requires reviewed migration; refusing to assign an environment.');
    db.exec(`CREATE TABLE environment_identity (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('demo','sandbox','live')))`);
    db.prepare('INSERT INTO environment_identity VALUES(1,?)').run(mode);
    db.exec(`CREATE TRIGGER environment_identity_no_update BEFORE UPDATE ON environment_identity BEGIN SELECT RAISE(ABORT,'Environment identity is immutable'); END;
      CREATE TRIGGER environment_identity_no_delete BEFORE DELETE ON environment_identity BEGIN SELECT RAISE(ABORT,'Environment identity is immutable'); END;`);
  }
  const identity = db.prepare('SELECT mode FROM environment_identity WHERE id=1').get() as {mode:string}|undefined;
  if (identity?.mode !== mode) throw new Error('Database environment does not match APP_MODE.');
}


/**
 * Append an immutable audit log entry with SHA-256 hash
 */
export function recordAuditLog(
  actor: 'system' | 'ai' | 'user' | 'paypal',
  action: string,
  detail: Record<string, any>,
  disputeId: string | null = null
): string {
  const db = getDb();
  const id = 'aud_' + crypto.randomBytes(8).toString('hex');
  const timestamp = new Date().toISOString();
  const detailStr = JSON.stringify(detail);

  // Hash this entry for integrity checking (not a chained or externally anchored log).
  const hashInput = `${id}:${disputeId || ''}:${actor}:${action}:${detailStr}:${timestamp}`;
  const sha256_hash = crypto.createHash('sha256').update(hashInput).digest('hex');

  const stmt = db.prepare(`
    INSERT INTO audit_log (id, dispute_id, actor, action, detail, sha256_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, disputeId, actor, action, detailStr, sha256_hash, timestamp);

  return id;
}
