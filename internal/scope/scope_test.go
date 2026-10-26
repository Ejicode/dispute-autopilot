package scope

import (
	"context"
	"testing"

	"github.com/Ejicode/dispute-autopilot/internal/config"
)

func TestWithAndFrom(t *testing.T) {
	ctx, err := With(context.Background(), "usr_0123456789abcdef0123456789abcdef", config.ModeSandbox, nil)
	if err != nil {
		t.Fatalf("With: %v", err)
	}
	sc, err := From(ctx)
	if err != nil {
		t.Fatalf("From: %v", err)
	}
	if sc.MerchantID != "usr_0123456789abcdef0123456789abcdef" || sc.Mode != config.ModeSandbox {
		t.Fatalf("unexpected scope: %+v", sc)
	}
	if got := MustFrom(ctx); got.MerchantID != sc.MerchantID {
		t.Fatalf("MustFrom mismatch: %+v", got)
	}
}

func TestWithRejectsUnscopedWorkspace(t *testing.T) {
	for _, id := range []string{"", "demo2", "usr_short", "usr_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", "merchant-1"} {
		if _, err := With(context.Background(), id, config.ModeDemo, nil); err == nil {
			t.Fatalf("invalid merchant id %q accepted", id)
		}
	}
	// The CLI-only demo workspace and real account ids are allowed.
	for _, id := range []string{"demo", "usr_00000000000000000000000000000000", "usr_demo_da_admin"} {
		if _, err := With(context.Background(), id, config.ModeDemo, nil); err != nil {
			t.Fatalf("valid merchant id %q rejected: %v", id, err)
		}
	}
}

func TestFromFailsClosed(t *testing.T) {
	if _, err := From(context.Background()); err != ErrNoScope {
		t.Fatalf("expected ErrNoScope, got %v", err)
	}
	defer func() {
		if recover() == nil {
			t.Fatal("MustFrom should panic without a scope")
		}
	}()
	MustFrom(context.Background())
}
