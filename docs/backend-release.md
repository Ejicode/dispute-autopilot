# Backend release handoff

Scope: API endpoints, SQLite schema, single-account authentication and dispute lifecycle. Each account owns its own isolated merchant workspace. Shared staff accounts and email password recovery are not implemented. This release does not add either feature.

## Changes in this branch

- Auth and environment-classified merchant databases use an ordered `schema_migrations` ledger. Pending upgrades commit together; a failed upgrade rolls back, and newer or mismatched migration histories stop startup. Existing data is retained. Baselines are frozen: add a new sequential migration rather than editing an applied baseline. The ledger checks version/name identity, not code checksums.
- Checkout requires catalog SKUs and positive integer quantities, combines duplicate SKUs, checks the demo catalog quantity limit, and always uses server prices and USD. Legacy client name/price fields are ignored. This is a demo catalog, not a live stock reservation system.
- Checkout and simulated dispute creation validate bounded JSON and atomically store related evidence, drafts and audit entries. Notifications follow commit.
- Carrier simulator updates move forward, allow deliberate forward skips for demonstrations, reject regressions, and treat repeated status as a no-op. Fresh evidence refreshes drafts on every eligible required-action dispute for that order; terminal cases and reserved/approved actions retain their drafts. Provider mutations still require a fresh human review.
- `GET /api/health` returns minimal readiness information without account data. It checks the auth database and application mode, not PayPal availability or every merchant file.
- `test:readiness` is included in CI. Test provider calls are mocked; passing tests does not establish real Sandbox compatibility.

## Render deployment

The supplied `render.yaml` creates one paid web service with a persistent disk at `/var/data`; `DATA_DIR=/var/data/dispute-autopilot`. It starts in demo mode. Set `APP_ORIGIN` to the exact HTTPS origin, without a trailing slash. Set provider variables in Render's secret environment configuration, never in Git.

Render's default filesystem is ephemeral. Free web services cannot attach persistent disks. A disk is accessible only to its owning service instance, not to cron jobs or a separate worker. Therefore `npm run start:render` runs Next.js and invokes the bounded webhook retry CLI every minute in the same service, without overlapping retries. Keep one instance. The supervisor forwards shutdown signals; failed/dead-letter processing is logged for operator review. A separate process does not publish SSE events to Next.js; reload the dispute view after background recovery.

Sources: https://render.com/docs/disks and https://render.com/docs/cronjobs

1. Merge the prerequisite reconciliation PR before merging this branch (this branch includes its commits).
2. Deploy the blueprint and verify `/api/health` returns 200. Register the merchant account. Obtain its ID from authenticated `GET /api/auth`.
3. Set `APP_MODE=sandbox`, `PAYPAL_ENVIRONMENT=sandbox`, Sandbox client ID/secret, webhook ID and `PAYPAL_MERCHANT_USER_ID` to that account ID. Configure the PayPal webhook URL as `https://YOUR_HOST/api/webhooks/paypal`. Restart after configuration changes.
4. Confirm login works and account/order data survives a service restart. Demo records must remain absent in Sandbox mode. Simulated checkout, dispute creation and carrier mutations must return 403 in Sandbox.
5. Exercise an actual Sandbox transaction/dispute and verified webhook; confirm the configured merchant receives it. Review and execute one supported action, recording provider request ID and response. Confirm provider status/deadline/outcome converge through verified webhook updates.
6. Check logs and run `npm run webhooks:retry -- --list` in the service shell. Investigate dead letters; do not blindly force replay or repeat an uncertain provider action. Reconciliation reads provider state but never authorizes another submission.

Steps 2–6 require deployment access and real Sandbox configuration. They have not been performed by this branch. The one-PayPal-integration-owner restriction remains; other accounts cannot use those credentials. Automatic additional response rounds and resubmission of uncertain operations remain intentionally blocked.

## Backup and recovery

Run `npm run db:backup -- /var/data/dispute-autopilot/auth.db /var/data/auth-backup-UNIQUE.db` in the owning service shell. Repeat for every required `environments/<mode>/merchants/<account-id>.db`, using a new destination each time. This uses SQLite's online backup API (including committed WAL data), creates mode-0600 files, refuses overwrite and verifies integrity/foreign keys. Copy verified backups off the disk to restricted backup storage; a backup on the same disk alone is insufficient.

For a consistent multi-file recovery point, stop writes and retry processing before backing up all files. To restore, stop the service and retry worker, preserve the current files including WAL/SHM, and restore verified backups to their original paths in a fresh data directory with restrictive permissions. Never overlay an active database or leave old WAL/SHM files beside a restored database. Revoke restored sessions (`DELETE FROM sessions` in the restored auth DB) before reopening traffic. Validate the environment markers, health, login and merchant isolation; restart with the restored DATA_DIR. Reconcile provider state before any further actions: a backup can predate an already submitted payment operation.

Pre-environment legacy databases are still rejected until their environment/provenance has been reviewed. Do not move mixed demo/live data into an operational directory or manually relabel provenance to bypass this guard. No legacy data was migrated by this branch.
