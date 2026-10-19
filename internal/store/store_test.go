package store

import (
	"context"
	"database/sql"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
)

func testCtx(t *testing.T) context.Context {
	t.Helper()
	t.Setenv("DATA_DIR", t.TempDir())
	ctx, err := scope.With(context.Background(), "demo", config.ModeDemo, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	return ctx
}

func TestMerchantSchemaAndFTS(t *testing.T) {
	ctx := testCtx(t)
	s, err := Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}

	// Baseline tables must exist.
	for _, table := range []string{"disputes", "demo_orders", "evidence_items", "ai_drafts", "approvals", "audit_log", "webhook_inbox", "disputes_fts", "orders_fts", "environment_identity"} {
		var name string
		if err := s.QueryRow(ctx, "SELECT name FROM sqlite_master WHERE name=?", table).Scan(&name); err != nil {
			t.Fatalf("table %s missing: %v", table, err)
		}
	}

	// FTS5 must be operational.
	if _, err := s.Exec(ctx, "INSERT INTO disputes_fts(disputes_fts) VALUES('rebuild')"); err != nil {
		t.Fatalf("fts rebuild: %v", err)
	}

	// Environment identity is immutable.
	if _, err := s.Exec(ctx, "UPDATE environment_identity SET mode='live' WHERE id=1"); err == nil {
		t.Fatalf("environment identity update should have been rejected")
	}
}

func TestNestedTransactionsSavepoint(t *testing.T) {
	ctx := testCtx(t)
	s, err := Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}

	err = s.WithTx(ctx, func(ctx context.Context) error {
		if _, err := s.Exec(ctx, `INSERT INTO users(id,name,email,store_name,role,created_at) VALUES('u1','A','a@b.c','S','MERCHANT_ADMIN','2026-01-01T00:00:00.000Z')`); err != nil {
			return err
		}
		inner := s.WithTx(ctx, func(ctx context.Context) error {
			return sql.ErrNoRows
		})
		if inner == nil {
			t.Fatalf("inner transaction should have failed")
		}
		// Outer transaction must survive the inner rollback.
		if _, err := s.Exec(ctx, `INSERT INTO users(id,name,email,store_name,role,created_at) VALUES('u2','B','b@b.c','S','MERCHANT_ADMIN','2026-01-01T00:00:00.000Z')`); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		t.Fatalf("outer transaction: %v", err)
	}

	var count int
	if err := s.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 users after savepoint rollback, got %d", count)
	}
}

func TestProvenanceCanary(t *testing.T) {
	ctx := testCtx(t)
	s, err := Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}
	if _, err := s.Exec(ctx, `INSERT INTO disputes(id,paypal_dispute_id,transaction_id,reason,amount_cents,status,response_deadline,created_at,updated_at)
		VALUES('d1','PP-1','TX-1','OTHER',100,'REQUIRED_ACTION','2026-02-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`); err != nil {
		t.Fatalf("insert dispute: %v", err)
	}
	var provenance string
	if err := s.QueryRow(ctx, "SELECT provenance FROM disputes WHERE id='d1'").Scan(&provenance); err != nil {
		t.Fatalf("select provenance: %v", err)
	}
	if provenance != "DEMO" {
		t.Fatalf("expected DEMO provenance, got %s", provenance)
	}
	if _, err := s.Exec(ctx, "UPDATE disputes SET provenance='PAYPAL_LIVE' WHERE id='d1'"); err == nil {
		t.Fatalf("provenance update should have been rejected")
	}
}

func TestCrossStoreIsolation(t *testing.T) {
	ctx := testCtx(t)
	auth, err := Auth()
	if err != nil {
		t.Fatalf("Auth: %v", err)
	}
	if _, err := auth.Exec(ctx, `INSERT INTO accounts(id,email,name,store_name,role,password_hash,created_at)
		VALUES('a1','x@y.z','X','S','MERCHANT_ADMIN','hash','2026-01-01T00:00:00.000Z')`); err != nil {
		t.Fatalf("insert account: %v", err)
	}
	// An auth transaction must not bleed into the merchant database.
	err = auth.WithTx(ctx, func(ctx context.Context) error {
		merchant, err := Merchant(ctx)
		if err != nil {
			return err
		}
		var count int
		if err := merchant.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatalf("merchant database polluted by auth transaction")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("auth tx: %v", err)
	}
}
