// Command backup-database creates an online, verified SQLite backup. The source
// is opened read-only and the destination must not already exist.
package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}

func run() error {
	args := os.Args[1:]
	if len(args) != 2 {
		return errors.New("Usage: backup-database SOURCE.db NEW_BACKUP.db")
	}
	input, err := filepath.Abs(args[0])
	if err != nil {
		return err
	}
	output, err := filepath.Abs(args[1])
	if err != nil {
		return err
	}
	if input == output {
		return errors.New("Source and destination must differ")
	}
	if _, err := os.Stat(input); err != nil {
		return fmt.Errorf("Source database is not readable: %w", err)
	}
	if _, err := os.Stat(output); err == nil {
		return errors.New("Destination already exists; choose a new backup path")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	source, err := openReadOnly(input)
	if err != nil {
		return err
	}
	defer source.Close()

	// VACUUM INTO produces a consistent snapshot, including committed WAL pages.
	if _, err := source.Exec("VACUUM INTO " + quoteString(output)); err != nil {
		return err
	}
	if err := os.Chmod(output, 0o600); err != nil {
		_ = os.Remove(output)
		return err
	}

	if err := verify(output); err != nil {
		_ = os.Remove(output)
		return err
	}
	fmt.Println("Verified SQLite backup created: " + output)
	return nil
}

func openReadOnly(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func verify(path string) error {
	db, err := openReadOnly(path)
	if err != nil {
		return err
	}
	defer db.Close()

	var integrity string
	if err := db.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil {
		return err
	}
	if integrity != "ok" {
		return errors.New("Backup integrity check failed")
	}
	rows, err := db.Query("PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return errors.New("Backup integrity check failed")
	}
	return rows.Err()
}

func quoteString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
