package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func runBackup(t *testing.T, args ...string) error {
	t.Helper()
	saved := os.Args
	t.Cleanup(func() { os.Args = saved })
	os.Args = append([]string{"backup-database"}, args...)
	return run()
}

// TestBackupRetainsCommittedDataAndRefusesOverwrite ports the readiness backup
// checks: an online backup of an open WAL database keeps committed rows, the
// destination is 0600, and an existing destination is refused.
func TestBackupRetainsCommittedDataAndRefusesOverwrite(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "backup-source.db")
	destination := filepath.Join(dir, "backup.db")

	original, err := sql.Open("sqlite", "file:"+source)
	if err != nil {
		t.Fatalf("open source: %v", err)
	}
	original.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = original.Close() })
	if _, err := original.Exec("PRAGMA journal_mode = WAL"); err != nil {
		t.Fatalf("journal_mode: %v", err)
	}
	if _, err := original.Exec("CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES('committed')"); err != nil {
		t.Fatalf("seed source: %v", err)
	}

	if err := runBackup(t, source, destination); err != nil {
		t.Fatalf("online backup: %v", err)
	}

	restored, err := sql.Open("sqlite", "file:"+destination+"?mode=ro")
	if err != nil {
		t.Fatalf("open backup: %v", err)
	}
	defer restored.Close()
	var value string
	if err := restored.QueryRow("SELECT value FROM retained").Scan(&value); err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if value != "committed" {
		t.Fatalf("backup value = %q, want committed", value)
	}
	info, err := os.Stat(destination)
	if err != nil {
		t.Fatalf("stat backup: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("backup permissions = %o, want 0600", perm)
	}

	if err := runBackup(t, source, destination); err == nil {
		t.Fatalf("backup must refuse to overwrite an existing destination")
	}
}

func TestBackupArgumentValidation(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.db")
	if _, err := os.Create(source); err != nil {
		t.Fatalf("create source: %v", err)
	}

	if err := runBackup(t); err == nil {
		t.Fatalf("missing arguments should be rejected")
	}
	if err := runBackup(t, source, source); err == nil {
		t.Fatalf("identical source and destination should be rejected")
	}
	if err := runBackup(t, filepath.Join(dir, "missing.db"), filepath.Join(dir, "out.db")); err == nil {
		t.Fatalf("unreadable source should be rejected")
	}
}
