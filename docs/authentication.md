# Authentication and merchant workspaces

This version gives each registered account one merchant workspace. Registration and sign-in establish a server-side session; a browser-selected user ID never grants access. Shared team membership, invitations, password recovery, and email verification are not implemented.

## Local setup

1. Copy `.env.example` to `.env.local`, build the frontend with `npm ci && npm run build`, and run the Go server with `make dev` (or `./bin/server`).
2. Open `/register` and supply a name, store name, email, and password of 15–128 characters. Email matching is case-insensitive. Passwords preserve whitespace.
3. Use `/login` to return to that account. Sign out using the account menu.
4. Create sample orders in the demo storefront. New accounts have empty workspaces.

## HTTP contract

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /api/auth` | JSON `name`, `email`, `store_name`, `password`; optional HTTPS `avatar_url` | `201`, public `user`, session cookie |
| `POST /api/auth/login` | JSON `email`, `password` | `200`, public `user`, rotated session cookie |
| `GET /api/auth` | Session cookie | `200`, current `user`; otherwise `401` |
| `DELETE /api/auth` | Session cookie and matching Origin | Revokes the current session and clears its cookie |

All business endpoints, including analytics, search, diagnostic runners, evidence packets, chat, and SSE, require a session. Authentication errors return `401`. Foreign workspace resource IDs return `404` on resource lookups. Chat authors and approval actors come from the authenticated account, even if callers send another user ID. `GET /api/auth` no longer lists registered accounts.

Browser mutations require an `Origin` header matching `APP_ORIGIN`. API clients must send that header and the session cookie as well. Auth bodies must be JSON and cannot exceed 8 KiB. Registration with an existing email returns `409`; failed sign-in uses the same `401` message for unknown accounts and incorrect passwords. Auth attempts are limited per normalized email and globally; exceeding a limit returns `429`.

## Storage and sessions

- `DATA_DIR` defaults to `./data` and must be persistent and writable.
- `auth.db` stores accounts, salted scrypt password hashes, session token digests, and rate-limit counters.
- `environments/<mode>/merchants/<account-id>.db` holds that account's business tables. Account IDs are generated on the server. Database access without a merchant context fails closed.
- Password hashing uses scrypt with N=131072, r=8, p=1, a random 16-byte salt, and a process-wide limit of two concurrent derivations.
- Sessions use random 32-byte tokens, stored only as SHA-256 digests on the server. Cookies are HttpOnly, SameSite=Lax, Path=/, and Secure in production. Sessions expire after seven days without sliding renewal. Signing in revokes the incoming session; signing out revokes the current session, not sessions on other devices.
- SSE channels are per merchant and check session validity before every event and every 20-second heartbeat. Client workspace state remounts on account changes. Other tabs refresh identity on a storage signal, focus, or a 60-second interval.

## PayPal ownership

The environment-configured PayPal integration belongs to exactly one account. After registering that merchant, obtain its `user.id` from authenticated `GET /api/auth` and set `PAYPAL_MERCHANT_USER_ID` alongside `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID`.

Public webhooks use that server-configured owner, never cookies, query parameters, or submitted user IDs. Missing integration configuration or an unknown owner returns `503`; failed provider signature verification returns `401`. Browser requests from another account cannot use the configured PayPal credentials. Per-merchant OAuth onboarding is a separate feature.

With no PayPal credentials, existing browser simulation actions use the application's mock provider behavior. The public webhook endpoint still fails closed. Automated auth tests stub signature verification to test routing; they do not certify PayPal's live verification service.

## Deployment and legacy data

Set `APP_ORIGIN` to the exact public origin, for example `https://disputes.example.com`, and serve production over HTTPS. In production, missing `APP_ORIGIN` causes mutations to return `503`. Proxy headers do not override the configured origin. Use one long-running Go process with persistent local SQLite storage: realtime events are process-local, and this implementation is not designed for multiple replicas or ephemeral serverless filesystems. Back up both auth and merchant databases consistently, including SQLite WAL state; restrict filesystem access and add upstream request limits.

The old `data/dispute_autopilot.db` is left untouched and is no longer opened by web requests. Old profile records had no passwords and cannot safely establish account ownership. There is intentionally no automatic email-based claim or migration. For installations with legacy data, an administrator must first verify ownership, take a consistent backup, and perform a reviewed, explicit import into the intended account's database. Do not copy a mixed-merchant database into an account. No legacy migration tool is included in this feature.

CLI seed, test, attack, and benchmark commands run in `data/environments/demo/merchants/demo.db`, which web accounts cannot select. The authentication suite instead uses a fresh temporary data directory and disables provider credentials. Run `go test ./internal/httpapi/ -run TestHTTPApiEndToEnd -count=1`, `go test ./...`, and `npm run build` to validate the feature; CI runs the authentication suite too. Remaining unrelated audit findings are tracked in `AUDIT.md`.

Environment namespaces and legacy-data migration boundaries are documented in [environment isolation](environment-isolation.md).
