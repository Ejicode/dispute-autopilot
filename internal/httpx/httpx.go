// Package httpx provides HTTP error types and JSON helpers shared by handlers.
package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
)

// HTTPError carries an explicit status code and safe client message.
type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return e.Message }

// Errorf builds a new HTTPError.
func Errorf(status int, format string, args ...any) *HTTPError {
	return &HTTPError{Status: status, Message: fmt.Sprintf(format, args...)}
}

// JSON writes a JSON response without HTML escaping (matching NextResponse.json).
func JSON(w http.ResponseWriter, status int, v any) {
	data, err := Marshal(v)
	if err != nil {
		log.Printf("response marshal failed: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"Unable to complete the request."}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

// Marshal encodes v without HTML escaping and without a trailing newline.
func Marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// Error writes the standard error envelope for an error.
func Error(w http.ResponseWriter, err error) {
	var he *HTTPError
	if errors.As(err, &he) {
		w.Header().Set("Cache-Control", "no-store")
		JSON(w, he.Status, map[string]string{"error": he.Message})
		return
	}
	log.Printf("request failed: %v", err)
	JSON(w, http.StatusInternalServerError, map[string]string{"error": "Unable to complete the request."})
}

// ReadJSONBody reads and validates a bounded JSON object body.
func ReadJSONBody(r *http.Request, maxBytes int) (map[string]any, error) {
	ct := r.Header.Get("Content-Type")
	if len(ct) < len("application/json") || ct[:len("application/json")] != "application/json" {
		return nil, Errorf(http.StatusUnsupportedMediaType, "JSON is required.")
	}
	if r.Body == nil {
		return nil, Errorf(http.StatusBadRequest, "A request body is required.")
	}
	limited := io.LimitReader(r.Body, int64(maxBytes)+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, Errorf(http.StatusBadRequest, "A request body is required.")
	}
	if len(data) > maxBytes {
		return nil, Errorf(http.StatusRequestEntityTooLarge, "Request is too large.")
	}
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, Errorf(http.StatusBadRequest, "Invalid JSON object.")
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return nil, Errorf(http.StatusBadRequest, "Invalid JSON object.")
	}
	return obj, nil
}

// Context is a tiny helper to thread request context through handlers.
type Context = context.Context
