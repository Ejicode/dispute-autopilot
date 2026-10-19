package httpx

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMarshalMatchesNextResponseJSON(t *testing.T) {
	data, err := Marshal(map[string]any{"html": "<b>&</b>", "n": 1})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	got := string(data)
	if strings.HasSuffix(got, "\n") {
		t.Fatalf("Marshal must not append a newline: %q", got)
	}
	// NextResponse.json does not HTML-escape.
	if !strings.Contains(got, "<b>&</b>") {
		t.Fatalf("Marshal HTML-escaped the payload: %q", got)
	}
}

func TestJSONEnvelope(t *testing.T) {
	recorder := httptest.NewRecorder()
	JSON(recorder, http.StatusCreated, map[string]any{"ok": true})
	res := recorder.Result()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type = %q", ct)
	}
}

func TestErrorWritesHTTPErrorAndFailsClosed(t *testing.T) {
	recorder := httptest.NewRecorder()
	Error(recorder, Errorf(http.StatusForbidden, "Request origin is not allowed."))
	res := recorder.Result()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("error responses must not be cached")
	}
	if body := recorder.Body.String(); !strings.Contains(body, "Request origin is not allowed.") {
		t.Fatalf("missing error message: %s", body)
	}

	// Unexpected errors are hidden behind a generic 500.
	unknown := httptest.NewRecorder()
	Error(unknown, errors.New("secret database detail"))
	if unknown.Code != http.StatusInternalServerError {
		t.Fatalf("unexpected error status = %d", unknown.Code)
	}
	if body := unknown.Body.String(); strings.Contains(body, "secret database detail") {
		t.Fatalf("internal detail leaked: %s", body)
	}
}

func TestReadJSONBody(t *testing.T) {
	makeReq := func(contentType, body string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		return req
	}

	body, err := ReadJSONBody(makeReq("application/json", `{"a":1}`), 1024)
	if err != nil || body["a"] != float64(1) {
		t.Fatalf("valid body rejected: body=%v err=%v", body, err)
	}
	// A charset suffix is allowed.
	if _, err := ReadJSONBody(makeReq("application/json; charset=utf-8", `{}`), 1024); err != nil {
		t.Fatalf("charset suffix rejected: %v", err)
	}

	if _, err := ReadJSONBody(makeReq("", `{}`), 1024); code(err) != http.StatusUnsupportedMediaType {
		t.Fatalf("missing content-type should be 415, got %v", err)
	}
	if _, err := ReadJSONBody(makeReq("application/json", `{`), 1024); code(err) != http.StatusBadRequest {
		t.Fatal("malformed JSON should be 400")
	}
	if _, err := ReadJSONBody(makeReq("application/json", `[1,2]`), 1024); code(err) != http.StatusBadRequest {
		t.Fatal("non-object JSON should be 400")
	}
	oversized := `{"x":"` + strings.Repeat("x", 4096) + `"}`
	if _, err := ReadJSONBody(makeReq("application/json", oversized), 1024); code(err) != http.StatusRequestEntityTooLarge {
		t.Fatal("oversized body should be 413")
	}
}

func code(err error) int {
	he, ok := err.(*HTTPError)
	if !ok {
		return 0
	}
	return he.Status
}
