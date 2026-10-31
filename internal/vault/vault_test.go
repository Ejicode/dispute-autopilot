package vault

import (
	"context"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// This file ports the evidence-vault integrity and PDF-packet sections of
// scripts/test-runner.ts (TEST 4 and TEST 5).

func testCtx(t *testing.T) context.Context {
	t.Helper()
	t.Setenv("APP_MODE", "demo")
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("PAYPAL_CLIENT_ID", "")
	t.Setenv("PAYPAL_CLIENT_SECRET", "")
	store.Close()
	t.Cleanup(store.Close)
	ctx, err := scope.With(context.Background(), "demo", config.ModeDemo, nil)
	if err != nil {
		t.Fatalf("scope.With: %v", err)
	}
	return ctx
}

// TestVaultSHA256Integrity ports test-runner.ts TEST 4: a freshly captured item
// verifies against its stored checksum.
func TestVaultSHA256Integrity(t *testing.T) {
	ctx := testCtx(t)

	item, err := AddToVault(ctx, AddParams{
		EvidenceType: "ORDER_CONFIRMATION",
		Source:       "TEST_GATEWAY",
		Title:        "Integrity Test Item",
		Content:      "Unmodified vault content",
	})
	if err != nil {
		t.Fatalf("AddToVault: %v", err)
	}
	if item.SHA256Hash != store.SHA256Hex([]byte("Unmodified vault content")) {
		t.Errorf("stored hash %q does not cover the content", item.SHA256Hash)
	}
	if item.Provenance != "DEMO" {
		t.Errorf("provenance = %q, want DEMO", item.Provenance)
	}

	integrity, err := VerifyIntegrity(ctx, item.ID)
	if err != nil {
		t.Fatalf("VerifyIntegrity: %v", err)
	}
	if !integrity.Valid {
		t.Error("calculated SHA-256 should match the stored checksum")
	}
	if integrity.CurrentHash != integrity.StoredHash {
		t.Errorf("current %q != stored %q", integrity.CurrentHash, integrity.StoredHash)
	}

	// Tampering with the stored content must fail the integrity check.
	db, err := store.Merchant(ctx)
	if err != nil {
		t.Fatalf("Merchant: %v", err)
	}
	if _, err := db.Exec(ctx, "UPDATE evidence_items SET content=? WHERE id=?", "Tampered content", item.ID); err != nil {
		t.Fatalf("tamper content: %v", err)
	}
	tampered, err := VerifyIntegrity(ctx, item.ID)
	if err != nil {
		t.Fatalf("VerifyIntegrity after tamper: %v", err)
	}
	if tampered.Valid {
		t.Error("tampered evidence must fail the integrity check")
	}
}

// TestGenerateDisputePDFPacket ports test-runner.ts TEST 5: the packet is a
// genuine binary PDF with meaningful content.
func TestGenerateDisputePDFPacket(t *testing.T) {
	dispute := types.Dispute{
		ID:               "dsp_test_1",
		PayPalDisputeID:  "PP-TEST-1",
		TransactionID:    "TXN-1",
		OrderID:          types.NullString("ord_1"),
		Reason:           "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
		AmountCents:      10000,
		Currency:         "USD",
		Status:           "REQUIRED_ACTION",
		ResponseDeadline: "2030-01-01T00:00:00Z",
		StrengthScore:    100,
		Recommendation:   "FIGHT",
	}
	evidence := []types.EvidenceItem{
		{ID: "ev_1", EvidenceType: "TRACKING_HISTORY", Source: "USPS", Title: "Tracking", Content: `{"tracking_number":"TRK-100","status":"DELIVERED"}`, SHA256Hash: store.SHA256Hex([]byte(`{"tracking_number":"TRK-100","status":"DELIVERED"}`)), CapturedAt: "2026-10-01"},
		{ID: "ev_2", EvidenceType: "PROOF_OF_DELIVERY", Source: "USPS", Title: "POD", Content: `{"delivered_at":"2026-10-04","signature_on_file":"SIGNATURE_VERIFIED"}`, SHA256Hash: store.SHA256Hex([]byte(`{"delivered_at":"2026-10-04","signature_on_file":"SIGNATURE_VERIFIED"}`)), CapturedAt: "2026-10-04"},
		{ID: "ev_3", EvidenceType: "ORDER_CONFIRMATION", Source: "STORE", Title: "Order", Content: `{"total_cents":10000}`, SHA256Hash: store.SHA256Hex([]byte(`{"total_cents":10000}`)), CapturedAt: "2026-10-01"},
	}

	pdfBytes, err := GenerateDisputePDFPacket(dispute, evidence)
	if err != nil {
		t.Fatalf("GenerateDisputePDFPacket: %v", err)
	}
	if len(pdfBytes) < 5 || string(pdfBytes[:5]) != "%PDF-" {
		t.Fatalf("packet must be a genuine binary PDF, got %d bytes", len(pdfBytes))
	}
	if len(pdfBytes) <= 1000 {
		t.Errorf("generated PDF should contain content, got %d bytes", len(pdfBytes))
	}
}

func TestGenerateVaultPDFDossier(t *testing.T) {
	evidence := []types.EvidenceItem{
		{ID: "ev_1", EvidenceType: "TRACKING_HISTORY", Source: "USPS", Title: "Tracking", Content: `{"tracking_number":"TRK-100","status":"DELIVERED"}`, SHA256Hash: store.SHA256Hex([]byte(`{"tracking_number":"TRK-100","status":"DELIVERED"}`)), CapturedAt: "2026-10-01"},
		{ID: "ev_2", EvidenceType: "PROOF_OF_DELIVERY", Source: "USPS", Title: "POD", Content: `{"delivered_at":"2026-10-04","signature_on_file":"SIGNATURE_VERIFIED"}`, SHA256Hash: store.SHA256Hex([]byte(`{"delivered_at":"2026-10-04","signature_on_file":"SIGNATURE_VERIFIED"}`)), CapturedAt: "2026-10-04"},
		{ID: "ev_3", EvidenceType: "ORDER_CONFIRMATION", Source: "STORE", Title: "Order", Content: `{"total_cents":10000}`, SHA256Hash: store.SHA256Hex([]byte(`{"total_cents":10000}`)), CapturedAt: "2026-10-01"},
	}

	pdfBytes, err := GenerateVaultPDFDossier("merchant_demo_1", evidence)
	if err != nil {
		t.Fatalf("GenerateVaultPDFDossier: %v", err)
	}
	if len(pdfBytes) < 5 || string(pdfBytes[:5]) != "%PDF-" {
		t.Fatalf("dossier must be a genuine binary PDF, got %d bytes", len(pdfBytes))
	}
	if len(pdfBytes) <= 1000 {
		t.Errorf("generated dossier should contain content, got %d bytes", len(pdfBytes))
	}
}

