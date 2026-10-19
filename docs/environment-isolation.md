# Backend environment isolation

`APP_MODE` selects `demo`, `sandbox`, or `live` on the server. Missing configuration defaults to offline demo; unknown values fail closed. Request bodies, query parameters, cookies, and headers cannot select a mode. Restart the application after changing configuration.

| Mode | Simulated writes | PayPal transport | Business data |
| --- | --- | --- | --- |
| `demo` | Allowed for authenticated users | No network calls, even when credentials exist | `environments/demo/merchants/<account-id>.db` |
| `sandbox` | Disabled | Requires credentials, matching `PAYPAL_ENVIRONMENT=sandbox`, and integration owner | `environments/sandbox/merchants/<account-id>.db` |
| `live` | Disabled | Requires credentials, matching `PAYPAL_ENVIRONMENT=live`, and integration owner | `environments/live/merchants/<account-id>.db` |

Paths are relative to `DATA_DIR`. Authentication remains in `auth.db`; accounts and sessions can access their own workspace in each environment. Request context captures the mode before business work starts. Realtime channels include both environment and merchant identity.

## API behavior

The following authenticated POST endpoints return `403` outside demo mode, before parsing or mutation:

- `/api/disputes` (simulated dispute creation)
- `/api/storefront/checkout` (simulated checkout)
- `/api/carrier/update` (simulated carrier milestones)
- `/api/trust-lab/run`
- `/api/bench/run`

Reusable simulation services enforce the same restriction. CLI seed refuses operational modes before opening its database. In demo mode, seed still resets only the separate CLI `demo` workspace; it does not reset merchant accounts.

`GET /api/runtime` requires a session and returns `{mode, simulation_enabled, provider_environment}`. Successful authenticated responses include `X-Application-Mode`. Frontend clients can use this contract to label environments and hide simulation controls; presentation changes are separate work. The backend remains authoritative even if a client shows or submits an unavailable action.

Public PayPal webhooks return `503` in demo mode. In operational modes, verification requires the configured owner, matching provider environment, credentials, webhook ID, and signature headers. There is no HTTP option to choose a fake verifier.

## Database and provenance

Each new database has an immutable `environment_identity` marker. Opening a demo database copied into a sandbox/live path fails. An existing database without a marker is not silently classified.

Disputes, orders, and evidence have an immutable `provenance` column with values `DEMO`, `PAYPAL_SANDBOX`, `PAYPAL_LIVE`, or `UNKNOWN`. Demo inserts default to `DEMO`. Operational inserts default to `UNKNOWN`; verified webhook projection explicitly stamps the matching provider provenance. Order/capture correlation only uses records from the matching environment.

Approval review and provider transport both reject mismatched or unknown provenance. Reviewed action snapshots include their environment. Missing credentials in operational modes cause an error before approval reservation; they never select a mock success adapter. Demo acceptance is explicitly simulated and does not claim a completed refund or final dispute resolution.

These controls assume the application owns its database files. A privileged operator can rewrite a database and its triggers; provenance is not independent proof that an arbitrary external source is authentic. Future import/carrier adapters must validate their sources and stamp provenance deliberately. Do not relabel simulated records as provider records to enable submission.

## Existing installations

**This changes business database paths.** Existing `DATA_DIR/merchants/*.db` files remain untouched and are not automatically loaded or migrated. Existing authentication accounts remain available, but the new environment starts with an empty business workspace.

Before deployment, preserve a backup and plan a reviewed migration if historical business data is required. The old files may mix simulation, provider events, evidence, and operation history. Copying them into a new environment directory is rejected rather than assigning trust automatically. This feature does not supply a legacy-data migration tool. Preserve prior approval reservations and webhook receipts when designing that migration; never replay old operations blindly.

For sandbox use, configure `APP_MODE=sandbox`, `PAYPAL_ENVIRONMENT=sandbox`, sandbox credentials, the owner account ID, and webhook ID. Ingest genuine sandbox events; the local simulated storefront and dispute creator are disabled there. Live deployment still requires the outstanding Sandbox integration validation and operational readiness work.

The webhook retry command loads `.env.local` and uses the selected environment. Other existing CLI scripts use the shell environment; pass `APP_MODE=demo` explicitly for demo commands. Use separate deployments/data roots when running multiple environments concurrently.

## Validation

`go test ./internal/config/ ./internal/store/` uses temporary databases and a stubbed HTTP transport. It covers mode defaults, simulation guards, database separation, persistent provenance, approval/transport rejection, environment-specific provider URLs, copied databases, retry-compatible projection, request context, and realtime isolation. No real provider calls are made. Existing authentication, approval, webhook, and evidence suites remain in CI.
