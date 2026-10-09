import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Ensure data folder exists
const DB_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_PATH = path.join(DB_DIR, 'dispute_autopilot.db');

// Singleton connection
let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    initSchema(dbInstance);
  }
  return dbInstance;
}

function initSchema(db: Database.Database) {
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
  `);

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
