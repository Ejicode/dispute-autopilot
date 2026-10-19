package store

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
)

func useTempDataDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("DATA_DIR", dir)
	Close()
	t.Cleanup(Close)
	return dir
}

func envContext(t *testing.T, merchant string, mode config.Mode) context.Context {
	t.Helper()
	ctx, err := scope.With(context.Background(), merchant, mode, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	return ctx
}

func insertEnvDispute(t *testing.T, ctx context.Context, s *Store, id string) {
	t.Helper()
	const now = "2026-10-14T10:00:00.000Z"
	if _, err := s.Exec(ctx, `INSERT INTO disputes
		(id,paypal_dispute_id,transaction_id,reason,amount_cents,status,response_deadline,created_at,updated_at)
		VALUES(?,?,?,'OTHER',1000,'REQUIRED_ACTION',?,?,?)`,
		id, "PP-"+id, "TX-"+id, now, now, now); err != nil {
		t.Fatalf("insert dispute %s: %v", id, err)
	}
}

func tableExists(t *testing.T, ctx context.Context, s *Store, name string) bool {
	t.Helper()
	var found string
	err := s.QueryRow(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", name).Scan(&found)
	if err != nil {
		if err == sql.ErrNoRows {
			return false
		}
		t.Fatalf("table lookup %s: %v", name, err)
	}
	return found == name
}

// TestFreshMerchantDatabase ports the readiness environment checks: a brand new
// merchant database is created under DATA_DIR/environments/<mode>/merchants,
// carries the full baseline, binds its environment immutably, and uses WAL with
// restricted permissions.
func TestFreshMerchantDatabase(t *testing.T) {
	dir := useTempDataDir(t)
	ctx := envContext(t, "demo", config.ModeDemo)

	s, err := Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}
	wantPath := filepath.Join(dir, "environments", "demo", "merchants", "demo.db")
	if s.Path() != wantPath {
		t.Fatalf("store path = %q, want %q", s.Path(), wantPath)
	}

	for _, table := range []string{
		"disputes", "paypal_events", "demo_orders", "evidence_items", "ai_drafts",
		"approvals", "audit_log", "users", "ai_chat_messages", "approval_operations",
		"dispute_reconciliations", "reconciliation_leases", "webhook_inbox",
		"paypal_dispute_versions", "paypal_captures", "schema_migrations",
		"environment_identity", "disputes_fts", "orders_fts",
	} {
		if !tableExists(t, ctx, s, table) {
			t.Errorf("baseline table %s missing", table)
		}
	}

	var identity string
	if err := s.QueryRow(ctx, "SELECT mode FROM environment_identity WHERE id=1").Scan(&identity); err != nil {
		t.Fatalf("read environment identity: %v", err)
	}
	if identity != string(config.ModeDemo) {
		t.Fatalf("environment identity = %q, want demo", identity)
	}

	var journal string
	if err := s.QueryRow(ctx, "SELECT * FROM pragma_journal_mode").Scan(&journal); err != nil {
		t.Fatalf("journal_mode: %v", err)
	}
	if journal != "wal" {
		t.Fatalf("journal_mode = %q, want wal", journal)
	}

	info, err := os.Stat(s.Path())
	if err != nil {
		t.Fatalf("stat merchant db: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("merchant db permissions = %o, want 0600", perm)
	}

	// The handle is cached: the same workspace resolves to the same store.
	again, err := Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant (second call): %v", err)
	}
	if again != s {
		t.Fatalf("Merchant should cache the open store")
	}
}

// TestMerchantEnvironmentIsolation ports "sandbox cannot read demo records for
// the same merchant", "live cannot read sandbox or demo cases" and the
// in-flight-request scoping guarantee.
func TestMerchantEnvironmentIsolation(t *testing.T) {
	useTempDataDir(t)
	const merchant = "usr_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

	demoCtx := envContext(t, merchant, config.ModeDemo)
	demo, err := Merchant(demoCtx)
	if err != nil {
		t.Fatalf("demo Merchant: %v", err)
	}
	insertEnvDispute(t, demoCtx, demo, "demo")

	sandboxCtx := envContext(t, merchant, config.ModeSandbox)
	sandbox, err := Merchant(sandboxCtx)
	if err != nil {
		t.Fatalf("sandbox Merchant: %v", err)
	}
	if sandbox == demo {
		t.Fatalf("sandbox and demo stores must differ")
	}
	if tableExists(t, sandboxCtx, sandbox, "disputes") {
		var n int
		if err := sandbox.QueryRow(sandboxCtx, "SELECT COUNT(*) FROM disputes WHERE id='demo'").Scan(&n); err != nil {
			t.Fatalf("sandbox count: %v", err)
		}
		if n != 0 {
			t.Fatalf("sandbox can read %d demo records", n)
		}
	}

	insertEnvDispute(t, sandboxCtx, sandbox, "sandbox")
	liveCtx := envContext(t, merchant, config.ModeLive)
	live, err := Merchant(liveCtx)
	if err != nil {
		t.Fatalf("live Merchant: %v", err)
	}
	var n int
	if err := live.QueryRow(liveCtx, "SELECT COUNT(*) FROM disputes").Scan(&n); err != nil {
		t.Fatalf("live count: %v", err)
	}
	if n != 0 {
		t.Fatalf("live database can read %d sandbox/demo records", n)
	}

	// A request that already carries a scope keeps its original environment even
	// if APP_MODE changes mid-flight (context replaces AsyncLocalStorage).
	delayed := func() (*Store, error) {
		t.Setenv("APP_MODE", "sandbox")
		return Merchant(demoCtx)
	}
	captured, err := delayed()
	if err != nil {
		t.Fatalf("delayed Merchant: %v", err)
	}
	if captured != demo {
		t.Fatalf("in-flight request did not retain its original environment")
	}
}

func TestMerchantIsolationAcrossMerchants(t *testing.T) {
	useTempDataDir(t)
	ctxA := envContext(t, "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", config.ModeDemo)
	ctxB := envContext(t, "usr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", config.ModeDemo)

	dbA, err := Merchant(ctxA)
	if err != nil {
		t.Fatalf("merchant A: %v", err)
	}
	dbB, err := Merchant(ctxB)
	if err != nil {
		t.Fatalf("merchant B: %v", err)
	}
	if dbA.Path() == dbB.Path() {
		t.Fatalf("distinct merchants must have distinct database files")
	}
	insertEnvDispute(t, ctxA, dbA, "priv-a")

	var n int
	if err := dbB.QueryRow(ctxB, "SELECT COUNT(*) FROM disputes WHERE id='priv-a'").Scan(&n); err != nil {
		t.Fatalf("merchant B count: %v", err)
	}
	if n != 0 {
		t.Fatalf("merchant B can read merchant A records")
	}
}

// TestCopiedDatabaseCannotChangeEnvironment ports
// "copied demo database cannot be opened as sandbox".
func TestCopiedDatabaseCannotChangeEnvironment(t *testing.T) {
	dir := useTempDataDir(t)
	const merchant = "usr_11111111111111111111111111111111"

	demoCtx := envContext(t, merchant, config.ModeDemo)
	demo, err := Merchant(demoCtx)
	if err != nil {
		t.Fatalf("demo Merchant: %v", err)
	}
	if _, err := demo.Raw().ExecContext(demoCtx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		t.Fatalf("checkpoint: %v", err)
	}
	source := filepath.Join(dir, "environments", "demo", "merchants", merchant+".db")
	Close()

	destination := filepath.Join(dir, "environments", "sandbox", "merchants", merchant+".db")
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		t.Fatalf("mkdir sandbox: %v", err)
	}
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatalf("read demo db: %v", err)
	}
	if err := os.WriteFile(destination, data, 0o600); err != nil {
		t.Fatalf("write copied db: %v", err)
	}

	sandboxCtx := envContext(t, merchant, config.ModeSandbox)
	if _, err := Merchant(sandboxCtx); err == nil {
		t.Fatalf("copied demo database should not open as sandbox")
	} else if !strings.Contains(err.Error(), "environment does not match") {
		t.Fatalf("unexpected error: %v", err)
	}
}

// TestUnclassifiedDatabaseRequiresMigration ports
// "unclassified databases require reviewed migration".
func TestUnclassifiedDatabaseRequiresMigration(t *testing.T) {
	dir := useTempDataDir(t)
	const merchant = "usr_22222222222222222222222222222222"
	path := filepath.Join(dir, "environments", "sandbox", "merchants", merchant+".db")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	legacy, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("open legacy: %v", err)
	}
	if _, err := legacy.Exec("CREATE TABLE old_records(id TEXT)"); err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatalf("close legacy: %v", err)
	}

	ctx := envContext(t, merchant, config.ModeSandbox)
	_, err = Merchant(ctx)
	if err == nil {
		t.Fatalf("unclassified database should have been rejected")
	}
	// The Go guard message is lowercased relative to the TS ("Unclassified
	// database requires reviewed migration"); the refusal behaviour is identical.
	if !strings.Contains(strings.ToLower(err.Error()), "unclassified") {
		t.Fatalf("unexpected error: %v", err)
	}
	// The rejected database must not be cached as a bound workspace.
	if _, err := Merchant(ctx); err == nil {
		t.Fatalf("unclassified database should keep failing")
	}
}

// TestOperationalRecordsDefaultToUnknown ports
// "unclassified operational inserts default to UNKNOWN": rows written by a
// sandbox/live workspace start UNKNOWN and cannot be reclassified in place.
func TestOperationalRecordsDefaultToUnknown(t *testing.T) {
	useTempDataDir(t)
	ctx := envContext(t, "usr_33333333333333333333333333333333", config.ModeSandbox)
	s, err := Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}
	insertEnvDispute(t, ctx, s, "unknown")

	var provenance string
	if err := s.QueryRow(ctx, "SELECT provenance FROM disputes WHERE id='unknown'").Scan(&provenance); err != nil {
		t.Fatalf("read provenance: %v", err)
	}
	if provenance != string(config.ProvenanceUnknown) {
		t.Fatalf("operational default provenance = %q, want UNKNOWN", provenance)
	}
	if _, err := s.Exec(ctx, "UPDATE disputes SET provenance='PAYPAL_LIVE' WHERE id='unknown'"); err == nil {
		t.Fatalf("record provenance must be immutable")
	}
}

// TestAuthDatabase ports the readiness reliance on a separate auth database:
// it is a single cached file with the auth baseline and no merchant tables.
func TestAuthDatabase(t *testing.T) {
	dir := useTempDataDir(t)
	ctx := context.Background()

	first, err := Auth()
	if err != nil {
		t.Fatalf("Auth: %v", err)
	}
	second, err := Auth()
	if err != nil {
		t.Fatalf("Auth (second call): %v", err)
	}
	if first != second {
		t.Fatalf("Auth should be cached")
	}
	wantPath := filepath.Join(dir, "auth.db")
	if first.Path() != wantPath {
		t.Fatalf("auth path = %q, want %q", first.Path(), wantPath)
	}
	for _, table := range []string{"accounts", "sessions", "auth_attempts", "schema_migrations"} {
		if !tableExists(t, ctx, first, table) {
			t.Errorf("auth table %s missing", table)
		}
	}
	if tableExists(t, ctx, first, "disputes") {
		t.Errorf("auth database must not contain merchant tables")
	}
	info, err := os.Stat(first.Path())
	if err != nil {
		t.Fatalf("stat auth db: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("auth db permissions = %o, want 0600", perm)
	}
}
