package httpapi

import "testing"

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
