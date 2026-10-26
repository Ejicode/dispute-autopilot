// Package httpapi wires the domain packages onto net/http, preserving the exact
// route contracts of the original Next.js API (paths, status codes, JSON shapes
// and caching headers).
package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/auth"
	"github.com/Ejicode/dispute-autopilot/internal/config"
	"github.com/Ejicode/dispute-autopilot/internal/httpx"
	"github.com/Ejicode/dispute-autopilot/internal/scope"
	"github.com/Ejicode/dispute-autopilot/internal/store"
	"github.com/Ejicode/dispute-autopilot/internal/types"
)

// API serves the JSON API and the statically exported frontend.
type API struct {
	webDir string
}

// New builds the routing handler. webDir is the Next.js static export directory.
func New(webDir string) http.Handler {
	api := &API{webDir: webDir}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", api.health)
	mux.HandleFunc("GET /api/auth", api.authSession)
	mux.HandleFunc("POST /api/auth", api.authRegister)
	mux.HandleFunc("DELETE /api/auth", api.authLogout)
	mux.HandleFunc("POST /api/auth/login", api.authLogin)

	mux.HandleFunc("GET /api/runtime", api.withMerchant(api.runtimeMode))
	mux.HandleFunc("GET /api/events/stream", api.withMerchant(api.eventsStream))

	mux.HandleFunc("GET /api/disputes", api.withMerchant(api.disputesList))
	mux.HandleFunc("POST /api/disputes", api.withMerchant(api.disputesCreate))
	mux.HandleFunc("GET /api/disputes/{id}", api.withMerchant(api.disputeDetail))
	mux.HandleFunc("GET /api/disputes/{id}/approve", api.withMerchant(api.approveReview))
	mux.HandleFunc("POST /api/disputes/{id}/approve", api.withMerchant(api.approveExecute))
	mux.HandleFunc("GET /api/disputes/{id}/reconcile", api.withMerchant(api.reconcileHistory))
	mux.HandleFunc("POST /api/disputes/{id}/reconcile", api.withMerchant(api.reconcileDispute))
	mux.HandleFunc("POST /api/disputes/{id}/verify-draft", api.withMerchant(api.verifyDraft))
	mux.HandleFunc("POST /api/disputes/{id}/regenerate-draft", api.withMerchant(api.regenerateDraft))
	mux.HandleFunc("GET /api/disputes/{id}/packet", api.withMerchant(api.disputePacket))

	mux.HandleFunc("GET /api/storefront/checkout", api.withMerchant(api.checkoutList))
	mux.HandleFunc("POST /api/storefront/checkout", api.withMerchant(api.checkoutCreate))
	mux.HandleFunc("POST /api/carrier/update", api.withMerchant(api.carrierUpdate))

	mux.HandleFunc("GET /api/search", api.withMerchant(api.search))
	mux.HandleFunc("GET /api/analytics", api.withMerchant(api.analytics))

	mux.HandleFunc("GET /api/trust-lab/run", api.withMerchant(api.trustLabList))
	mux.HandleFunc("POST /api/trust-lab/run", api.withMerchant(api.trustLabRun))
	mux.HandleFunc("GET /api/bench/run", api.withMerchant(api.benchList))
	mux.HandleFunc("POST /api/bench/run", api.withMerchant(api.benchRun))
	mux.HandleFunc("POST /api/demo/seed", api.withMerchant(api.demoSeed))

	mux.HandleFunc("GET /api/ai-assistant", api.withMerchant(api.assistantHistory))
	mux.HandleFunc("POST /api/ai-assistant", api.withMerchant(api.assistantSend))

	mux.HandleFunc("POST /api/webhooks/paypal", api.paypalWebhook)

	mux.HandleFunc("/", api.static)
	return mux
}

// merchantHandler is a handler that only runs inside an authenticated workspace.
type merchantHandler func(w http.ResponseWriter, r *http.Request, user *types.UserAccount) error

// rawResponse is a response a handler chooses to return directly (with an
// explicit status), matching Next's `NextResponse.json(..., {status})` returns
// that still receive the merchant headers.
type rawResponse struct {
	status int
	body   any
}

func (e *rawResponse) Error() string { return "raw response" }

// withMerchant authenticates, enforces same-origin, and enters the merchant
// scope before the handler runs.
func (a *API) withMerchant(handler merchantHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, err := auth.RequireUser(r)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		if err := auth.AssertSameOrigin(r); err != nil {
			httpx.Error(w, err)
			return
		}
		mode, err := config.ApplicationMode()
		if err != nil {
			httpx.Error(w, err)
			return
		}
		ctx, err := scope.With(r.Context(), user.ID, mode, user)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		mw := &modeWriter{ResponseWriter: w, mode: string(mode)}
		if err := handler(mw, r.WithContext(ctx), user); err != nil {
			var raw *rawResponse
			if errors.As(err, &raw) {
				httpx.JSON(mw, raw.status, raw.body)
				return
			}
			// Failures never carry the success-only merchant headers.
			httpx.Error(mw.ResponseWriter, err)
		}
	}
}

// modeWriter injects the merchant response headers on the first write.
type modeWriter struct {
	http.ResponseWriter
	mode     string
	injected bool
}

func (m *modeWriter) inject() {
	if m.injected {
		return
	}
	m.injected = true
	m.Header().Set("Cache-Control", "no-store")
	m.Header().Set("X-Application-Mode", m.mode)
}

func (m *modeWriter) WriteHeader(status int) {
	m.inject()
	m.ResponseWriter.WriteHeader(status)
}

func (m *modeWriter) Write(b []byte) (int, error) {
	if !m.injected {
		m.WriteHeader(http.StatusOK)
	}
	return m.ResponseWriter.Write(b)
}

func (m *modeWriter) Flush() {
	if !m.injected {
		m.WriteHeader(http.StatusOK)
	}
	if f, ok := m.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// queryMaps returns rows as loosely-typed maps (mirroring a JS row object).
func queryMaps(ctx context.Context, db *store.Store, query string, args ...any) ([]map[string]any, error) {
	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		record := make(map[string]any, len(columns))
		for i, column := range columns {
			if b, ok := values[i].([]byte); ok {
				record[column] = string(b)
			} else {
				record[column] = values[i]
			}
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

// queryMap returns one loosely-typed row, or nil when there is no match.
func queryMap(ctx context.Context, db *store.Store, query string, args ...any) (map[string]any, error) {
	rows, err := queryMaps(ctx, db, query, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// publicAccountColumns is the credential-free account projection.
const publicAccountColumns = `id, email, name, store_name, role, avatar_url, created_at`

// scanPublicUser scans a public account row.
func scanPublicUser(sc store.Scanner) (*types.UserAccount, error) {
	var (
		user   types.UserAccount
		avatar sql.NullString
	)
	if err := sc.Scan(&user.ID, &user.Email, &user.Name, &user.StoreName, &user.Role, &avatar, &user.CreatedAt); err != nil {
		return nil, err
	}
	if avatar.Valid {
		value := avatar.String
		user.AvatarURL = &value
	}
	return &user, nil
}

func intValue(value any) int64 {
	switch n := value.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case float64:
		return int64(n)
	case bool:
		if n {
			return 1
		}
	}
	return 0
}

func boolValue(value any) bool { return intValue(value) != 0 }

func stringValue(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

// parseISOMillis parses a stored timestamp into Unix milliseconds (0 on failure).
func parseISOMillis(value string) int64 {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UnixMilli()
		}
	}
	return 0
}

// decodeDetail parses a stored JSON detail column.
func decodeDetail(raw any) any {
	text := stringValue(raw)
	if text == "" {
		return map[string]any{}
	}
	var parsed any
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		return map[string]any{}
	}
	return parsed
}
