// Package store owns SQLite access. It reproduces the semantics of the original
// better-sqlite3 layer: one serialized connection per database file, per-request
// transactions with savepoints for nesting, and environment-classified files.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/types"

	_ "modernc.org/sqlite"
)

// Querier is satisfied by both *sql.DB and *sql.Tx.
type Querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type txCtxKey int

const (
	merchantTxKey txCtxKey = iota
	authTxKey
)

var savepointSeq int64

// Store wraps a single serialized SQLite database.
type Store struct {
	db    *sql.DB
	path  string
	txKey txCtxKey
}

var (
	merchantMu sync.Mutex
	merchants  = map[string]*Store{}

	authMu    sync.Mutex
	authStore *Store
)

// DataDir resolves and creates the persistent data directory.
func DataDir() string {
	dir := os.Getenv("DATA_DIR")
	if dir == "" {
		wd, err := os.Getwd()
		if err != nil {
			wd = "."
		}
		dir = filepath.Join(wd, "data")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		abs = dir
	}
	_ = os.MkdirAll(abs, 0o700)
	return abs
}

func openStore(path string, key txCtxKey) (*Store, error) {
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// Serialize access on one connection, exactly like better-sqlite3.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db, path: path, txKey: key}, nil
}

// Auth returns the singleton authentication database.
func Auth() (*Store, error) {
	authMu.Lock()
	defer authMu.Unlock()
	if authStore != nil {
		return authStore, nil
	}
	filename := filepath.Join(DataDir(), "auth.db")
	s, err := openStore(filename, authTxKey)
	if err != nil {
		return nil, err
	}
	if err := migrate(context.Background(), s, authMigrations); err != nil {
		_ = s.db.Close()
		return nil, err
	}
	authStore = s
	return s, nil
}

// Merchant returns the environment-classified database for the scoped merchant.
func Merchant(ctx context.Context) (*Store, error) {
	sc, err := scope.From(ctx)
	if err != nil {
		return nil, err
	}
	directory := filepath.Join(DataDir(), "environments", string(sc.Mode), "merchants")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, err
	}
	merchantID := sc.MerchantID
	if sc.Mode == config.ModeDemo && (merchantID == "usr_demo_buyer_shopper" || strings.Contains(strings.ToLower(merchantID), "buyer")) {
		merchantID = "usr_demo_da_admin"
	}
	filename := filepath.Join(directory, merchantID+".db")

	merchantMu.Lock()
	s, ok := merchants[filename]
	if !ok {
		opened, err := openStore(filename, merchantTxKey)
		if err != nil {
			merchantMu.Unlock()
			return nil, err
		}
		initCtx := context.Background()
		if err := opened.WithTx(initCtx, func(txCtx context.Context) error {
			return bindEnvironment(txCtx, opened, sc.Mode)
		}); err != nil {
			_ = opened.db.Close()
			merchantMu.Unlock()
			return nil, err
		}
		if err := migrate(initCtx, opened, merchantMigrations(sc.Mode)); err != nil {
			_ = opened.db.Close()
			merchantMu.Unlock()
			return nil, err
		}
		merchants[filename] = opened
		s = opened
	}
	merchantMu.Unlock()

	// Business queries receive only this merchant's public profile.
	if sc.User != nil {
		if err := s.mirrorUser(ctx, sc.User); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func (s *Store) mirrorUser(ctx context.Context, user *types.UserAccount) error {
	var avatar any
	if user.AvatarURL != nil {
		avatar = *user.AvatarURL
	}
	_, err := s.Exec(ctx, `INSERT OR IGNORE INTO users
		(id,name,email,store_name,role,avatar_url,created_at) VALUES(?,?,?,?,?,?,?)`,
		user.ID, user.Name, user.Email, user.StoreName, user.Role, avatar, user.CreatedAt)
	return err
}

func bindEnvironment(ctx context.Context, s *Store, mode config.Mode) error {
	var name string
	err := s.QueryRow(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name='environment_identity'").Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		var existing string
		err := s.QueryRow(ctx, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1").Scan(&existing)
		if err == nil {
			return errors.New("unclassified database requires reviewed migration; refusing to assign an environment")
		}
		if _, err := s.Exec(ctx, `CREATE TABLE environment_identity (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('demo','sandbox','live')))`); err != nil {
			return err
		}
		if _, err := s.Exec(ctx, "INSERT INTO environment_identity VALUES(1,?)", string(mode)); err != nil {
			return err
		}
		if _, err := s.Exec(ctx, `CREATE TRIGGER environment_identity_no_update BEFORE UPDATE ON environment_identity BEGIN SELECT RAISE(ABORT,'Environment identity is immutable'); END;
			CREATE TRIGGER environment_identity_no_delete BEFORE DELETE ON environment_identity BEGIN SELECT RAISE(ABORT,'Environment identity is immutable'); END;`); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	var identity string
	if err := s.QueryRow(ctx, "SELECT mode FROM environment_identity WHERE id=1").Scan(&identity); err != nil {
		return err
	}
	if identity != string(mode) {
		return errors.New("database environment does not match APP_MODE")
	}
	return nil
}

// Exec runs a statement inside the ambient transaction when one is present.
func (s *Store) Exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return s.conn(ctx).ExecContext(ctx, query, args...)
}

// Query runs a query inside the ambient transaction when one is present.
func (s *Store) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return s.conn(ctx).QueryContext(ctx, query, args...)
}

// QueryRow runs a query inside the ambient transaction when one is present.
func (s *Store) QueryRow(ctx context.Context, query string, args ...any) *sql.Row {
	return s.conn(ctx).QueryRowContext(ctx, query, args...)
}

func (s *Store) conn(ctx context.Context) Querier {
	if tx := txFrom(ctx, s.txKey); tx != nil {
		return tx
	}
	return s.db
}

func txFrom(ctx context.Context, key txCtxKey) *sql.Tx {
	if tx, ok := ctx.Value(key).(*sql.Tx); ok {
		return tx
	}
	return nil
}

// WithTx runs fn in a transaction. Nested calls create savepoints so an inner
// failure can roll back without discarding the outer unit of work.
func (s *Store) WithTx(ctx context.Context, fn func(context.Context) error) error {
	if tx := txFrom(ctx, s.txKey); tx != nil {
		name := "sp_" + strconv.FormatInt(atomic.AddInt64(&savepointSeq, 1), 10)
		if _, err := tx.ExecContext(ctx, "SAVEPOINT "+name); err != nil {
			return err
		}
		if err := fn(ctx); err != nil {
			_, _ = tx.ExecContext(ctx, "ROLLBACK TO "+name)
			_, _ = tx.ExecContext(ctx, "RELEASE "+name)
			return err
		}
		_, err := tx.ExecContext(ctx, "RELEASE "+name)
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	txCtx := context.WithValue(ctx, s.txKey, tx)
	if err := fn(txCtx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// Close releases every cached database handle (used on shutdown).
func Close() {
	merchantMu.Lock()
	for _, s := range merchants {
		_ = s.db.Close()
	}
	merchants = map[string]*Store{}
	merchantMu.Unlock()

	authMu.Lock()
	if authStore != nil {
		_ = authStore.db.Close()
		authStore = nil
	}
	authMu.Unlock()
}

// Path exposes the backing file path (diagnostics/tests).
func (s *Store) Path() string { return s.path }

// Raw exposes the underlying handle for maintenance helpers.
func (s *Store) Raw() *sql.DB { return s.db }

// Placeholder is a convenience for building parenthesized parameter lists.
func Placeholder(n int) string {
	if n <= 0 {
		return ""
	}
	out := "?"
	for i := 1; i < n; i++ {
		out += ",?"
	}
	return fmt.Sprintf("(%s)", out)
}
