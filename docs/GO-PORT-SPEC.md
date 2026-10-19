# Go Port Spec — shared conventions

This repository's backend was migrated from TypeScript to Go. The original
TypeScript backend (`src/lib/**` and `src/app/api/**`) has been removed; this
document records the conventions the Go code follows so the migration remains
faithful to the original contracts. Port behaviour faithfully; preserve every
JSON field name and every safety invariant.

## Foundation packages (already written — read them before porting)

| Package | Import path | Responsibility |
| --- | --- | --- |
| `config` | `github.com/Ejicode/dispute-autopilot/internal/config` | `Mode`, `Provenance`, `ApplicationMode()`, `ProvenanceFor(mode)`, `Production()`, `Origin()`, `NowISO()`, `FormatISO(t)` |
| `types` | `.../internal/types` | Domain structs with exact JSON tags. `NullableString` marshals to `null` or string and scans SQL NULL. Helpers: `types.NullString(s)`, `n.Ptr()`, `n.Str()`, `n.Valid` |
| `scope` | `.../internal/scope` | `Scope{MerchantID, Mode, User}` in context. `scope.With(ctx,...)`, `scope.From(ctx)`, `scope.MustFrom(ctx)` |
| `store` | `.../internal/store` | `store.Auth()`, `store.Merchant(ctx)`, `s.WithTx(ctx, fn)`, `s.Exec/Query/QueryRow(ctx,...)`, `store.Audit(ctx, actor, action, detail, disputeID) (id string, err error)`, `store.RandomHex(n)`, `store.RandomID(prefix,bytes)`, `store.SHA256Hex([]byte)`, `store.DataDir()` |
| `httpx` | `.../internal/httpx` | `httpx.HTTPError{Status,Message}`, `httpx.Errorf(status, format, ...)`, `httpx.JSON(w,status,v)`, `httpx.Marshal(v)`, `httpx.Error(w,err)`, `httpx.ReadJSONBody(r,max)` |
| `auth` | `.../internal/auth` | `auth.SessionUser(r)`, `auth.RequireUser(r)`, `auth.AssertSameOrigin(r)`, `auth.SetSession(w,r,userID)`, `auth.ClearSession(w)`, `auth.RevokeSession(r)`, `auth.HashPassword`, `auth.VerifyPassword`, `auth.ReadAuthBody(r,max)`, `auth.Field(body,key,max)`, `auth.Credentials(body,registration)`, `auth.Throttle(email)`, `auth.TokenHash(token)` |
| `realtime` | `.../internal/realtime` | `realtime.Default().Publish(ctx, eventType, payload)`; `realtime.Channel(mode, merchantID)`; `Event{Type,Payload,Timestamp}` |

## Rules

1. **Context threading.** Every business function takes `ctx context.Context` as its
   first argument (this replaces Node's `AsyncLocalStorage`). Per-merchant data must be
   read via `store.Merchant(ctx)`.
2. **Transactions.** Wrap units of work in `s.WithTx(ctx, func(ctx context.Context) error {...})`.
   Nested `WithTx` calls become SAVEPOINTs automatically. Inside the callback always use
   the `ctx` you were given (the store resolves the ambient transaction from it).
   **Never hold a transaction across network I/O** (PayPal/Gemini calls). Commit the
   state transition first, then perform the request, then record the outcome in a new
   transaction.
3. **IDs / timestamps.** Use `store.RandomID("prefix_", 8)` where the TS used
   `crypto.randomBytes(8).toString('hex')` with a prefix, and `config.NowISO()` for
   `new Date().toISOString()`. Match the original prefixes exactly (`dsp_`, `ev_`,
   `draft_`, `aud_`, `app_`, `op_`, `ord_`, etc.). When the TS used
   `crypto.randomUUID()`, use `store.RandomUUID()` (add it if missing — a 36-char v4 UUID).
4. **JSON shapes are a contract.** Field names, casing, nullability and array-vs-null
   must match the TypeScript exactly; the React frontend consumes them verbatim.
   `httpx.Marshal` disables HTML escaping like `NextResponse.json`.
5. **Errors.** Return `*httpx.HTTPError` for expected client errors so the router emits
   `{"error": "..."}` with the right status. Unexpected errors become 500.
6. **Audit.** Use `store.Audit(ctx, actor, action, detail, disputeID)`. The hash input is
   `id + ":" + disputeId + ":" + actor + ":" + action + ":" + detailJSON + ":" + timestamp`.
   `detail` must marshal to the same JSON object the TS used.
7. **Mode safety.** Demo-only operations call `runtime.RequireDemo(ctx)`; provenance
   checks use `runtime.RequireMatchingProvenance(ctx, expected)`.
8. **No new third-party deps** without checking with the coordinator (PDF is
   `github.com/go-pdf/fpdf`, already in go.mod).

## Build / test

```bash
go build ./...
go vet ./...
go test ./...
```

Everything must compile with `go build ./...` and pass `go vet ./...`.
