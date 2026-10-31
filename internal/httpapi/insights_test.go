package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

func TestWinStatsUsesPayPalOutcomesOnly(t *testing.T) {
	disputes := []map[string]any{
		{"outcome": "RESOLVED_SELLER_FAVOUR", "recommendation": "ACCEPT"},
		{"outcome": "CANCELED_BY_BUYER"},
		{"outcome": "RESOLVED_BUYER_FAVOUR", "recommendation": "FIGHT"},
		{"outcome": "RESOLVED_WITH_PAYOUT"},
		{"outcome": "PENDING", "recommendation": "FIGHT"},
		{"recommendation": "FIGHT"},
	}
	won, decided, rate := winStats(disputes)
	if won != 2 || decided != 4 || rate == nil || *rate != 50 {
		t.Fatalf("got won=%d decided=%d rate=%v, want 2/4 = 50%%", won, decided, rate)
	}
}

func TestWinStatsWithoutDecidedOutcomes(t *testing.T) {
	_, decided, rate := winStats([]map[string]any{{"outcome": "PENDING", "recommendation": "FIGHT"}})
	if decided != 0 || rate != nil {
		t.Fatalf("a FIGHT recommendation must not produce a win rate, got decided=%d rate=%v", decided, rate)
	}
}

func TestVaultDossierEndpoints(t *testing.T) {
	t.Setenv("APP_MODE", "demo")
	t.Setenv("DATA_DIR", t.TempDir())
	store.Close()
	t.Cleanup(store.Close)

	api := &API{}
	merchantID := "usr_demo_dossier"
	account := &types.UserAccount{
		ID:   "usr_dossier",
		Role: "MERCHANT",
	}
	ctx, err := scope.With(context.Background(), merchantID, config.ModeDemo, account)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("store.Merchant: %v", err)
	}

	// Insert an evidence item
	_, err = db.Exec(ctx, `INSERT INTO evidence_items (id, evidence_type, source, title, content, sha256_hash, captured_at, provenance)
		VALUES ('ev_dos_1', 'ORDER_CONFIRMATION', 'STOREFRONT', 'Order Confirmation', '{"order_id":"123"}', 'hash123', '2026-10-01T00:00:00Z', 'DEMO')`)
	if err != nil {
		t.Fatalf("insert evidence item: %v", err)
	}

	// 1. Test PDF dossier
	req := httptest.NewRequest("GET", "/api/vault/dossier", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	if err := api.vaultDossier(rec, req, account); err != nil {
		t.Fatalf("vaultDossier PDF: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "application/pdf" {
		t.Errorf("expected application/pdf, got %s", rec.Header().Get("Content-Type"))
	}
	body := rec.Body.Bytes()
	if len(body) < 5 || string(body[:5]) != "%PDF-" {
		t.Errorf("expected genuine PDF output, got %q", string(body[:20]))
	}

	// 2. Test JSON dossier
	reqJSON := httptest.NewRequest("GET", "/api/vault/dossier?format=json", nil).WithContext(ctx)
	recJSON := httptest.NewRecorder()
	if err := api.vaultDossier(recJSON, reqJSON, account); err != nil {
		t.Fatalf("vaultDossier JSON: %v", err)
	}
	if recJSON.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", recJSON.Code)
	}
	var data map[string]any
	if err := json.Unmarshal(recJSON.Body.Bytes(), &data); err != nil {
		t.Fatalf("decode JSON dossier: %v", err)
	}
	if data["dossier_type"] != "CONSOLIDATED_EVIDENCE_VAULT_DOSSIER" {
		t.Errorf("unexpected dossier_type: %v", data["dossier_type"])
	}
	if data["total_records"] != float64(1) {
		t.Errorf("expected total_records = 1, got %v", data["total_records"])
	}
}

