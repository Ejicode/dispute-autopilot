package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
)

// rawStore opens a Store directly (bypassing the environment binding/migrations)
// so the migration ledger can be exercised in isolation.
func rawStore(t *testing.T) *Store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "migrate.db"), merchantTxKey)
	if err != nil {
		t.Fatalf("openStore: %v", err)
	}
	t.Cleanup(func() { _ = s.db.Close() })
	return s
}

func migrateCount(t *testing.T, s *Store, ctx context.Context) int {
	t.Helper()
	var n int
	if err := s.QueryRow(ctx, "SELECT COUNT(*) FROM schema_migrations").Scan(&n); err != nil {
		t.Fatalf("count schema_migrations: %v", err)
	}
	return n
}

// TestMigrateAppliesOnce ports the readiness checks "migration applies once"
// (running migrate twice must not duplicate ledger rows or re-run DDL).
func TestMigrateAppliesOnce(t *testing.T) {
	ctx := context.Background()
	s := rawStore(t)

	runs := 0
	migrations := []Migration{{
		Version: 1,
		Name:    "first",
		Up: func(ctx context.Context, s *Store) error {
			runs++
			_, err := s.Exec(ctx, "CREATE TABLE sample(id INTEGER)")
			return err
		},
	}}

	if err := migrate(ctx, s, migrations); err != nil {
		t.Fatalf("first migrate: %v", err)
	}
	if err := migrate(ctx, s, migrations); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	if n := migrateCount(t, s, ctx); n != 1 {
		t.Fatalf("expected 1 ledger row, got %d", n)
	}
	if runs != 1 {
		t.Fatalf("migration Up ran %d times, want 1", runs)
	}
}

// TestMigrateRollsBackFailedDDL ports "failed migration rolls back DDL": the
// versioned change and its ledger entry must commit atomically.
func TestMigrateRollsBackFailedDDL(t *testing.T) {
	ctx := context.Background()
	s := rawStore(t)

	base := []Migration{{
		Version: 1,
		Name:    "first",
		Up: func(ctx context.Context, s *Store) error {
			_, err := s.Exec(ctx, "CREATE TABLE sample(id INTEGER)")
			return err
		},
	}}
	if err := migrate(ctx, s, base); err != nil {
		t.Fatalf("base migrate: %v", err)
	}

	failing := append(append([]Migration{}, base...), Migration{
		Version: 2,
		Name:    "failure",
		Up: func(ctx context.Context, s *Store) error {
			if _, err := s.Exec(ctx, "CREATE TABLE rolled_back(id INTEGER)"); err != nil {
				return err
			}
			return errors.New("injected")
		},
	})
	if err := migrate(ctx, s, failing); err == nil {
		t.Fatalf("failing migration should have returned an error")
	}

	var name string
	err := s.QueryRow(ctx, "SELECT name FROM sqlite_master WHERE name='rolled_back'").Scan(&name)
	if err == nil {
		t.Fatalf("rolled_back table should not survive a failed migration")
	}
	if n := migrateCount(t, s, ctx); n != 1 {
		t.Fatalf("failed migration must not record a ledger row, got %d", n)
	}
}

// TestMigrateRejectsIncompatibleHistory ports "downgrade and changed migration
// identity rejected".
func TestMigrateRejectsIncompatibleHistory(t *testing.T) {
	ctx := context.Background()

	noop := func(m Migration) Migration { return m }
	first := Migration{Version: 1, Name: "first", Up: func(context.Context, *Store) error { return nil }}

	t.Run("downgrade with empty list", func(t *testing.T) {
		s := rawStore(t)
		if err := migrate(ctx, s, []Migration{first}); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		if err := migrate(ctx, s, []Migration{}); err == nil {
			t.Fatalf("downgrade to an empty history should have been rejected")
		}
	})

	t.Run("removed applied migration", func(t *testing.T) {
		s := rawStore(t)
		second := Migration{Version: 2, Name: "second", Up: func(context.Context, *Store) error { return nil }}
		if err := migrate(ctx, s, []Migration{first, second}); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		if err := migrate(ctx, s, []Migration{first}); err == nil {
			t.Fatalf("history shorter than applied should have been rejected")
		}
	})

	t.Run("changed migration name", func(t *testing.T) {
		s := rawStore(t)
		if err := migrate(ctx, s, []Migration{first}); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		changed := noop(first)
		changed.Name = "changed"
		if err := migrate(ctx, s, []Migration{changed}); err == nil {
			t.Fatalf("changed migration identity should have been rejected")
		}
	})

	t.Run("invalid sequence", func(t *testing.T) {
		s := rawStore(t)
		bad := Migration{Version: 2, Name: "second", Up: func(context.Context, *Store) error { return nil }}
		if err := migrate(ctx, s, []Migration{bad}); err == nil {
			t.Fatalf("out-of-order migration version should have been rejected")
		}
		unnamed := Migration{Version: 1, Up: func(context.Context, *Store) error { return nil }}
		if err := migrate(ctx, s, []Migration{unnamed}); err == nil {
			t.Fatalf("unnamed migration should have been rejected")
		}
	})
}

// TestBaselineAdoptionPreservesRecords ports the readiness check "baseline
// adoption preserves pre-ledger records": a database created by the baseline
// before the migration ledger existed is adopted without dropping its rows.
func TestBaselineAdoptionPreservesRecords(t *testing.T) {
	ctx := context.Background()
	s := rawStore(t)

	if err := initSchema(ctx, s, config.ModeDemo); err != nil {
		t.Fatalf("initSchema: %v", err)
	}
	if _, err := s.Exec(ctx, `INSERT INTO users(id,name,email,store_name,role,created_at)
		VALUES('retained','Test','retained@test.example','Store','MERCHANT_ADMIN','2026-10-14T10:00:00.000Z')`); err != nil {
		t.Fatalf("insert pre-ledger user: %v", err)
	}

	if err := migrate(ctx, s, merchantMigrations(config.ModeDemo)); err != nil {
		t.Fatalf("adopt baseline: %v", err)
	}
	var id string
	if err := s.QueryRow(ctx, "SELECT id FROM users WHERE id='retained'").Scan(&id); err != nil {
		t.Fatalf("pre-ledger record was dropped: %v", err)
	}
	if id != "retained" {
		t.Fatalf("unexpected retained id %q", id)
	}
	if n := migrateCount(t, s, ctx); n != 1 {
		t.Fatalf("expected baseline ledger row, got %d", n)
	}

	// Re-running the adoption is idempotent.
	if err := migrate(ctx, s, merchantMigrations(config.ModeDemo)); err != nil {
		t.Fatalf("re-adopt baseline: %v", err)
	}
	if n := migrateCount(t, s, ctx); n != 1 {
		t.Fatalf("re-adoption duplicated the ledger: %d", n)
	}
}

// TestOpenStorePragmas verifies the better-sqlite3-compatible connection setup:
// WAL journaling, foreign key enforcement and 0600 file permissions.
func TestOpenStorePragmas(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "pragmas.db")
	s, err := openStore(path, merchantTxKey)
	if err != nil {
		t.Fatalf("openStore: %v", err)
	}
	t.Cleanup(func() { _ = s.db.Close() })

	var journal string
	if err := s.QueryRow(ctx, "PRAGMA journal_mode").Scan(&journal); err != nil {
		t.Fatalf("journal_mode: %v", err)
	}
	if journal != "wal" {
		t.Fatalf("expected journal_mode=wal, got %q", journal)
	}
	var foreignKeys int
	if err := s.QueryRow(ctx, "PRAGMA foreign_keys").Scan(&foreignKeys); err != nil {
		t.Fatalf("foreign_keys: %v", err)
	}
	if foreignKeys != 1 {
		t.Fatalf("expected foreign_keys=1, got %d", foreignKeys)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("expected 0600 permissions, got %o", perm)
	}
}
