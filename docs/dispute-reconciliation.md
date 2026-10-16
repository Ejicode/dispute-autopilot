# Dispute reconciliation

Authenticated reconciliation records PayPal's current state for an unresolved approval. It can synchronize the local dispute lifecycle and recover a stale SUBMITTING operation to UNCERTAIN. It never submits evidence, accepts a claim, deletes an operation reservation, or authorizes another action.

The provider adapter uses [Show dispute details](https://developer.paypal.com/api/customer-disputes/v1/disputes-get): GET /v1/customer/disputes/{id}. The origin and dispute identity come from server configuration and stored data. Redirects and arbitrary response links are not followed. OAuth and lookup calls have 15-second timeouts; details are limited to 1 MiB. Real Sandbox integration validation remains pending.

## API

Both endpoints require the merchant session and use its environment-scoped database. POST also requires the configured Origin and JSON content type.

- GET /api/disputes/{id}/reconcile returns operation state, stable provider request ID, execution timestamp, retry_allowed: false, and up to 20 recent observations. It makes no provider call.
- POST /api/disputes/{id}/reconcile accepts exactly {}. Provider status, outcomes, URLs, and overrides cannot be supplied by the caller.

POST requires sandbox/live mode, matching provenance, and an unresolved operation. SUBMITTING must be unchanged for at least two minutes. Acknowledged operations are not reclassified. A persisted 90-second lease serializes lookups; expired leases can be replaced after a process crash. A superseded worker cannot commit or release its replacement. Completed attempts have a 30-second cooldown.

## Results

| Result | Meaning |
| --- | --- |
| APPLIED | Valid provider lifecycle fields were synchronized. |
| UNCHANGED | Observed fields already match. |
| STALE | A newer provider version is already recorded. |
| CONFLICT | Equal-version fields or terminal states conflict; manual review is required. |
| SUPERSEDED | Local state or acknowledgement changed during lookup and was preserved. |
| ERROR | Lookup failed or returned incomplete/inconsistent data; lifecycle was not changed. |

Completed observations return 200, except ERROR, which returns 502 and records the failure. A 200 does not mean the original provider action succeeded. The response includes reconciliation_id, result, message, normalized observation, current dispute, operation_state, and retry_allowed: false.

Input/authentication/Origin checks use 400/401/403. Unknown or foreign disputes return 404. Missing/completed operations, demo mode, active submissions, and lease conflicts return 409. Size and content-type checks return 413/415. Provenance/operation mismatch returns 422, cooldown returns 429, and unavailable or mismatched configuration returns 503.

## Lifecycle and execution

Provider identity, status, and update timestamp must be valid. Any supplied amount/currency must match the case. Missing outcomes remain unknown. Terminal disputes cannot reopen automatically. Older observations and conflicting equal-time updates cannot overwrite newer webhook state. Local changes during lookup also prevent overwrite. Changed lifecycle fields invalidate stored drafts for rechecking/regeneration.

Webhook processing and reconciliation share paypal_dispute_versions. Its existing last_event_id column identifies either a webhook receipt or a rec_ observation. Reconciliation does not create synthetic webhook receipts.

UNDER_REVIEW, WAITING_FOR_SELLER_RESPONSE, or a terminal status does not prove whether our specific request executed. Reconciliation therefore does not set executed_at, mark an operation SUCCEEDED, or remove duplicate-execution protection. A late acknowledgement from the original sender is preserved.

Use the saved provider request ID and observation for operator investigation. Further response rounds and manual replay require a separate reviewed workflow with provider-specific proof. This endpoint has no force-retry switch or automatic polling worker.

## Persistence and integration

The additive schema introduces dispute_reconciliations and reconciliation_leases. Final observations are immutable and retain actor, environment, normalized lifecycle fields, their hash, result, and timestamp. Raw provider messages, attachments, tokens, and error bodies are not retained.

Lifecycle changes, provider version, observation, and completion audit commit atomically. Database errors roll them back. Start audits and leases identify interrupted work; lease expiry allows another lookup. DISPUTE_RECONCILED notifications publish only after commit. Frontend consumers can refresh case detail on that event; this feature changes no frontend files.

These controls protect application-level history, not against a privileged administrator rewriting database files and triggers.

Run npm run test:reconciliation and the existing authentication, approval, webhook, and environment suites. Tests use actual routes, temporary databases, controlled transport/races, and database fault injection. They make no real PayPal calls.
