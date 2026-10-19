package types

import (
	"database/sql"
	"encoding/json"
	"testing"
)

func TestNullableStringJSONShape(t *testing.T) {
	valid, err := json.Marshal(struct {
		V NullableString `json:"v"`
	}{V: NullString("hello")})
	if err != nil {
		t.Fatalf("marshal valid: %v", err)
	}
	if string(valid) != `{"v":"hello"}` {
		t.Fatalf("valid null-string shape = %s", valid)
	}

	empty, err := json.Marshal(struct {
		V NullableString `json:"v"`
	}{})
	if err != nil {
		t.Fatalf("marshal empty: %v", err)
	}
	if string(empty) != `{"v":null}` {
		t.Fatalf("absent null-string must serialize to null, got %s", empty)
	}
}

func TestNullableStringHelpers(t *testing.T) {
	absent := NullableString{sql.NullString{}}
	if absent.Ptr() != nil {
		t.Fatal("absent Ptr should be nil")
	}
	if absent.Str() != "" {
		t.Fatalf("absent Str should be empty, got %q", absent.Str())
	}
	if v, err := absent.Value(); err != nil || v != nil {
		t.Fatalf("absent Value should be nil,nil, got %v,%v", v, err)
	}

	present := NullString("value")
	if ptr := present.Ptr(); ptr == nil || *ptr != "value" {
		t.Fatalf("present Ptr = %v", ptr)
	}
	if present.Str() != "value" {
		t.Fatalf("present Str = %q", present.Str())
	}
}

func TestNullableStringScan(t *testing.T) {
	var v NullableString
	if err := v.Scan("scanned"); err != nil || v.Str() != "scanned" || !v.Valid {
		t.Fatalf("scan string: %+v err=%v", v, err)
	}
	if err := v.Scan(nil); err != nil || v.Valid {
		t.Fatalf("scan nil should be invalid: %+v err=%v", v, err)
	}
}
