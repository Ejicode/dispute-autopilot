package store

import (
	"context"
	"errors"

	"github.com/Ejicode/dispute-autopilot/internal/config"
)

// Migration is a versioned, immutable schema change.
type Migration struct {
	Version int
	Name    string
	Up      func(context.Context, *Store) error
}

type migrationRow struct {
	version int
	name    string
}

// migrate applies pending migrations and their ledger entries in one transaction.
func migrate(ctx context.Context, s *Store, migrations []Migration) error {
	for i, m := range migrations {
		if m.Version != i+1 || m.Name == "" {
			return errors.New("invalid migration sequence")
		}
	}
	return s.WithTx(ctx, func(ctx context.Context) error {
		if _, err := s.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
		)`); err != nil {
			return err
		}
		rows, err := s.Query(ctx, "SELECT version,name FROM schema_migrations ORDER BY version")
		if err != nil {
			return err
		}
		var applied []migrationRow
		for rows.Next() {
			var r migrationRow
			if err := rows.Scan(&r.version, &r.name); err != nil {
				rows.Close()
				return err
			}
			applied = append(applied, r)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for i, row := range applied {
			if row.version != i+1 || i >= len(migrations) || migrations[i].Version != row.version || migrations[i].Name != row.name {
				return errors.New("database migration history is incompatible with this application version")
			}
		}
		for _, m := range migrations[len(applied):] {
			if err := m.Up(ctx, s); err != nil {
				return err
			}
			if _, err := s.Exec(ctx, "INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)",
				m.Version, m.Name, config.NowISO()); err != nil {
				return err
			}
		}
		var one int
		if err := s.QueryRow(ctx, "SELECT count(*) FROM pragma_foreign_key_check").Scan(&one); err != nil {
			// pragma_foreign_key_check is a virtual table; fall back to the classic form.
			rows, ferr := s.Query(ctx, "PRAGMA foreign_key_check")
			if ferr != nil {
				return ferr
			}
			defer rows.Close()
			if rows.Next() {
				return errors.New("database foreign key integrity check failed")
			}
			return nil
		}
		if one > 0 {
			return errors.New("database foreign key integrity check failed")
		}
		return nil
	})
}

func merchantMigrations(mode config.Mode) []Migration {
	return []Migration{{
		Version: 1,
		Name:    "environment-classified-baseline",
		Up: func(ctx context.Context, s *Store) error {
			return initSchema(ctx, s, mode)
		},
	}}
}

var authMigrations = []Migration{{
	Version: 1,
	Name:    "auth-baseline",
	Up: func(ctx context.Context, s *Store) error {
		_, err := s.Exec(ctx, authSQL)
		return err
	},
}}
