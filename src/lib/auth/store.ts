import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { dataDirectory } from '../db/storage';

const runtime = globalThis as typeof globalThis & { disputeAuthDatabases?: Map<string, Database.Database> };
const databases = runtime.disputeAuthDatabases ??= new Map<string, Database.Database>();

export function authDb(): Database.Database {
  const filename = path.join(dataDirectory(), 'auth.db');
  const cached = databases.get(filename);
  if (cached) return cached;
  const db = new Database(filename);
  fs.chmodSync(filename, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, store_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role = 'MERCHANT_ADMIN'), avatar_url TEXT,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS auth_attempts (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL
    );
  `);
  databases.set(filename, db);
  return db;
}
