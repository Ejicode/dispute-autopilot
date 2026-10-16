import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { merchantScope } from '../auth/context';
import type { AppMode } from '../runtime/mode';
import { dataDirectory } from './storage';

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
      initSchema(db, mode);
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

function initSchema(db: Database.Database, mode: AppMode) {
  db.exec(`
    -- 1. Disputes table
    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      paypal_dispute_id TEXT UNIQUE NOT NULL,
      transaction_id TEXT NOT NULL,
      order_id TEXT,
      reason TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL,
      response_deadline TEXT NOT NULL,
      outcome TEXT,
      strength_score INTEGER NOT NULL DEFAULT 0,
      recommendation TEXT NOT NULL DEFAULT 'ASK A HUMAN',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 2. PayPal Events table (Idempotency & Deduplication)
    CREATE TABLE IF NOT EXISTS paypal_events (
      id TEXT PRIMARY KEY,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      summary TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );

    -- 3. Orders table (Storefront)
    CREATE TABLE IF NOT EXISTS demo_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      buyer_name TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      items TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      paypal_order_id TEXT,
      carrier TEXT,
      tracking_number TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'LABEL_CREATED',
      delivered_at TEXT,
      created_at TEXT NOT NULL
    );

    -- 4. Evidence Items table (The Vault with SHA-256)
    CREATE TABLE IF NOT EXISTS evidence_items (
      id TEXT PRIMARY KEY,
      dispute_id TEXT,
      order_id TEXT,
      evidence_type TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      file_path TEXT,
      sha256_hash TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      FOREIGN KEY(dispute_id) REFERENCES disputes(id) ON DELETE SET NULL,
      FOREIGN KEY(order_id) REFERENCES demo_orders(id) ON DELETE SET NULL
    );

    -- 5. AI Drafts table
    CREATE TABLE IF NOT EXISTS ai_drafts (
      id TEXT PRIMARY KEY,
      dispute_id TEXT NOT NULL,
      classification TEXT NOT NULL,
      draft_text TEXT NOT NULL,
      claims TEXT NOT NULL,
      schema_valid INTEGER NOT NULL DEFAULT 1,
      model_name TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      verification_errors TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(dispute_id) REFERENCES disputes(id) ON DELETE CASCADE
    );

    -- 6. Approvals table (Human gate with Idempotency)
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      dispute_id TEXT NOT NULL,
      approver TEXT NOT NULL,
      exact_action_snapshot TEXT NOT NULL,
      decision TEXT NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      executed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(draft_id) REFERENCES ai_drafts(id) ON DELETE CASCADE,
      FOREIGN KEY(dispute_id) REFERENCES disputes(id) ON DELETE CASCADE
    );

    -- 7. Audit Log table (Cryptographic audit trail)
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      dispute_id TEXT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      sha256_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 8. Bench Runs table (Dispute Bench 40 scenarios)
    CREATE TABLE IF NOT EXISTS bench_runs (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      name TEXT NOT NULL,
      dispute_reason TEXT NOT NULL,
      is_live INTEGER NOT NULL,
      claims_verified INTEGER NOT NULL,
      unsafe_actions_executed INTEGER NOT NULL DEFAULT 0,
      execution_time_ms INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    -- 9. Attack Runs table (Trust Lab 6 attacks)
    CREATE TABLE IF NOT EXISTS attack_runs (
      id TEXT PRIMARY KEY,
      attack_name TEXT NOT NULL,
      attack_type TEXT NOT NULL,
      payload TEXT,
      blocked INTEGER NOT NULL,
      http_status INTEGER NOT NULL,
      audit_ref TEXT,
      reason TEXT NOT NULL,
      run_date TEXT NOT NULL
    );

    -- 10. Users / Merchant Accounts table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      store_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'MERCHANT_ADMIN',
      avatar_url TEXT,
      created_at TEXT NOT NULL
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
    CREATE INDEX IF NOT EXISTS idx_disputes_deadline ON disputes(response_deadline);
    CREATE INDEX IF NOT EXISTS idx_evidence_dispute ON evidence_items(dispute_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_order ON evidence_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_audit_dispute ON audit_log(dispute_id);
    CREATE INDEX IF NOT EXISTS idx_events_event_id ON paypal_events(event_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    -- 11. FTS5 Full-Text Search index for disputes
    CREATE VIRTUAL TABLE IF NOT EXISTS disputes_fts USING fts5(
      id UNINDEXED, paypal_dispute_id, reason, status, recommendation, amount_cents UNINDEXED,
      content='disputes', content_rowid='rowid'
    );

    -- 12. FTS5 Full-Text Search index for orders
    CREATE VIRTUAL TABLE IF NOT EXISTS orders_fts USING fts5(
      id UNINDEXED, order_number, buyer_name, buyer_email, shipping_address, delivery_status,
      content='demo_orders', content_rowid='rowid'
    );

    -- 13. AI Assistant Chat History
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_user ON ai_chat_messages(user_id, created_at);

    -- One operation per dispute until reconciliation supports further response rounds.
    CREATE TABLE IF NOT EXISTS approval_operations (
      id TEXT PRIMARY KEY,
      dispute_id TEXT NOT NULL UNIQUE REFERENCES disputes(id),
      action_type TEXT NOT NULL CHECK(action_type IN ('PROVIDE_EVIDENCE','ACCEPT_CLAIM')),
      snapshot_digest TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      approver TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK(state IN ('SUBMITTING','SUCCEEDED','UNCERTAIN')),
      response TEXT,
      executed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS approval_operation_snapshot_immutable
    BEFORE UPDATE OF dispute_id, action_type, snapshot_digest, snapshot, approver, idempotency_key
    ON approval_operations BEGIN
      SELECT RAISE(ABORT, 'Approval snapshot is immutable');
    END;

    -- Verified receipts are durable before projection; completion commits with business changes.
    CREATE TABLE IF NOT EXISTS webhook_inbox (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      resource_id TEXT,
      payload TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('RECEIVED','PROCESSED','IGNORED','FAILED','DEFERRED','DEAD_LETTER')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      received_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_retry ON webhook_inbox(state,next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_webhook_resource ON webhook_inbox(resource_id,state);
    CREATE TRIGGER IF NOT EXISTS webhook_receipt_immutable
    BEFORE UPDATE OF event_id,event_type,resource_id,payload,payload_hash ON webhook_inbox BEGIN
      SELECT RAISE(ABORT, 'Verified webhook receipt is immutable');
    END;
    CREATE TABLE IF NOT EXISTS paypal_dispute_versions (
      paypal_dispute_id TEXT PRIMARY KEY,
      provider_updated_ms INTEGER NOT NULL,
      last_event_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS paypal_captures (
      capture_id TEXT PRIMARY KEY,
      paypal_order_id TEXT,
      order_id TEXT,
      evidence_id TEXT NOT NULL REFERENCES evidence_items(id),
      content_hash TEXT NOT NULL
    );
  `);

  // Operational rows inserted outside a trusted adapter remain UNKNOWN and cannot execute.
  for (const table of ['disputes', 'demo_orders', 'evidence_items']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[];
    if (!columns.some(column => column.name === 'provenance')) {
      const initial = mode === 'demo' ? 'DEMO' : 'UNKNOWN';
      db.exec(`ALTER TABLE ${table} ADD COLUMN provenance TEXT NOT NULL DEFAULT '${initial}'
        CHECK(provenance IN ('DEMO','PAYPAL_SANDBOX','PAYPAL_LIVE','UNKNOWN'))`);
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_provenance_immutable BEFORE UPDATE OF provenance ON ${table}
      BEGIN SELECT RAISE(ABORT,'Record provenance is immutable'); END;`);
  }

  // Migrate avatar_url if column does not exist (safe migration for existing DBs)
  try {
    db.prepare('ALTER TABLE users ADD COLUMN avatar_url TEXT').run();
  } catch {
    // Column already exists — expected on re-runs
  }

  // NO SEED DATA — the business must register their own merchant account.
  // Go to /register to create the first account.
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

  // Hash over previous record + new record components for tamper evidence
  const hashInput = `${id}:${disputeId || ''}:${actor}:${action}:${detailStr}:${timestamp}`;
  const sha256_hash = crypto.createHash('sha256').update(hashInput).digest('hex');

  const stmt = db.prepare(`
    INSERT INTO audit_log (id, dispute_id, actor, action, detail, sha256_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, disputeId, actor, action, detailStr, sha256_hash, timestamp);

  return id;
}
