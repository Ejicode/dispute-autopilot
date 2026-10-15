# Durable PayPal webhooks

Verified PayPal events are now stored in a merchant-scoped `webhook_inbox` before business processing. Projection runs synchronously inside an immediate SQLite transaction. A savepoint covers dispute changes, capture evidence, deterministic draft persistence, audit entries, and the completion marker. If any write fails, those changes roll back together and the outer transaction records retry metadata. No network or asynchronous LLM work runs in this transaction.

The public route retains server-configured merchant ownership and requires all five PayPal verification headers. It accepts JSON objects up to 256 KiB. Missing credentials or owner configuration returns `503`; missing or rejected verification returns `401`; verification service errors return `503`. Unverified events never enter the inbox. The provider client's old implicit mock-signature acceptance has been removed. Tests inject explicit verification adapters; HTTP callers cannot select an adapter.

## Event states and responses

| Inbox state | Meaning | HTTP response |
| --- | --- | --- |
| `RECEIVED` | Verification passed and receipt is durable; projection may still be pending after a crash | Process on delivery or via retry command |
| `PROCESSED` | Business projection and completion committed together | `200`; repeat deliveries return `DUPLICATE` |
| `IGNORED` | Unsupported event type, stale update, or already represented capture | `200`; repeat deliveries return `DUPLICATE` |
| `FAILED` | Projection failed without committing partial business changes | `503`, scheduled retry |
| `DEFERRED` | An update or resolution is waiting for dispute creation | `503`, scheduled retry |
| `DEAD_LETTER` | Invalid signed resource, conflicting provider facts, or exhausted attempts | `422`, operator review required |

The same event ID with different content returns `409`. Hashing canonicalizes object key order, so reordering JSON properties does not create a false conflict. A trigger protects stored receipt contents from normal updates; the retry worker also checks their hashes. This is not protection against a privileged database administrator modifying both data and integrity controls.

The retry delay starts at 30 seconds, doubles after each failed attempt, and caps at one hour. Ten failed/deferred attempts exhaust automatic retries. Deliveries before the scheduled time do not increase the attempt count. PayPal retries non-2xx responses up to 25 times over three days, but local recovery should not depend on that delivery window. See [PayPal webhook delivery behavior](https://developer.paypal.com/api/rest/webhooks).

## Run the recovery command

The CLI loads `.env.local` through Next's environment loader and targets only `PAYPAL_MERCHANT_USER_ID` in the configured `DATA_DIR`. That account must exist. It processes only receipts that already passed verification and never sends payment actions.

```bash
# Inspect pending, failed, deferred, and dead-letter events without replaying them
npm run webhooks:retry -- --list

# Retry up to 100 due events
npm run webhooks:retry

# Limit work per invocation
npm run webhooks:retry -- --limit 25

# After reviewing/fixing the cause, retry one stored receipt immediately
npm run webhooks:retry -- --event-id WH-EXAMPLE --force
```

Schedule the due-event command approximately once per minute using your deployment's scheduler, with the project working directory and the same persistent data directory as the application. This repository supplies the command, not a deployed scheduler. Overlapping workers serialize through SQLite; completed receipts are not reprojected. The command exits nonzero when attempted processing fails or dead letters remain, so monitoring can alert operators. `--list` is read-only and exits successfully even when it lists failures.

Before forcing a retry, inspect the cause, repair temporary infrastructure or code failures, and verify any missing provider event. A forced retry does not replace the verified payload or bypass integrity/lifecycle checks. Request redelivery of missing creation events through PayPal when appropriate. Invalid or conflicting signed facts need investigation; repeatedly forcing the same invalid receipt will not repair them. Preserve the inbox and event history rather than deleting records to retry.

## Dispute ordering and capture identity

- Created events insert by unique PayPal dispute identity; another creation cannot overwrite an existing case or a local approval.
- Updated events apply recognized provider statuses, amounts, reasons, and deadlines. Version ordering uses resource `update_time`, falling back to the event's `create_time`.
- Older updates are ignored. Terminal disputes do not automatically reopen. Conflicting updates or terminal outcomes at the same provider timestamp become dead letters.
- Updates and resolutions arriving before creation remain deferred. Creation applies those retained events in the same transaction before notifications are emitted, including dependency-related dead letters whose retry budget was exhausted.
- Missing outcomes remain null; missing deadlines remain the empty string for compatibility with the existing non-null column. Approval policy blocks unknown deadlines; the UI/PDF display them as unavailable. No fallback seller victory, deadline, transaction ID, or buyer identity is invented.
- Capture evidence is deduplicated by capture ID even when PayPal sends different event IDs. Known provider order IDs are persisted separately and used to link capture evidence and disputes. A later capture can repair a dispute whose order mapping was previously absent. Orders created locally after both events still need a future reconciliation path.

Realtime notifications emit after commit. Delivery to SSE listeners is advisory; listener failure does not change the inbox result. A crash after commit can lose a notification, so clients retain polling as a fallback. There is no durable notification outbox in this change.

## Migration and boundaries

Schema creation is additive: existing disputes, evidence, and legacy `paypal_events` records are preserved. The new inbox is authoritative for retry state. An old `PROCESSED` receipt does not prove that older code finished projection; a newly verified redelivery may repair it. Capture projection reuses compatible legacy capture evidence rather than duplicating it. Legacy events are not bulk-imported as verified or replayed automatically.

This remains a SQLite deployment using persistent local storage. There is no provider polling/reconciliation API, automatic support for reopened disputes, or approval-operation recovery based solely on a resolution webhook. The current amount model uses integer cents and accepts up to two decimal places; broader currency exponent handling remains separate work. Existing deterministic drafting and analytics limitations are not fixed here. Real PayPal Sandbox delivery and signature verification still need integration validation.

## Validation

`npm run test:webhooks` exercises actual processor and HTTP route code with explicit fake verifiers, temporary databases, transaction fault injection, concurrent delivery, changed payload detection, out-of-order events, legacy repair, capture correlation, and a separate recovery process. `npm run test:auth` and `npm run test:approvals` cover ownership and approval regressions. No real provider calls or payment actions are made by these tests.
