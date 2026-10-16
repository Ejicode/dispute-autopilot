# Approval safety

Approval now requires an explicit action and a digest obtained from a server-generated review. Missing or unknown actions, malformed JSON, and client overrides of notes, evidence, approver, amount, or idempotency keys are rejected before execution. Both endpoints require a merchant session; POST also requires the configured Origin.

## Review and approve

1. Request `GET /api/disputes/{id}/approve?action_type=PROVIDE_EVIDENCE` or `action_type=ACCEPT_CLAIM`.
2. Present the returned `snapshot` for review. It includes the action, provider dispute ID, amount/currency, notes, supporting evidence IDs, draft ID, deadline, and frozen `provider_payload`.
3. Submit only `{ "action_type": "PROVIDE_EVIDENCE", "snapshot_digest": "<64-character digest from review>" }` to `POST /api/disputes/{id}/approve`.

The server recomputes the review inside an immediate SQLite transaction before reserving execution. A different draft, changed text, claims, evidence, amount, deadline, or dispute update invalidates the digest. Review again after a `409` stale-review response. The snapshot's `timestamp` identifies the reviewed dispute update; the operation's `created_at` records the actual approval time.

Evidence submission requires a verified stored draft, successful re-verification, intact content hashes, and recorded carrier/tracking fields. Acceptance does not require a draft and uses server-owned acceptance notes. `POST /verify-draft` now accepts only `{}` and rechecks stored claims; editing claims independently of narrative is no longer supported. A future draft editor must create a new draft version with matching narrative and claims.

## Execution and retries

`approval_operations` is created additively for existing merchant databases. It stores the immutable reviewed snapshot and digest, session-derived approver, stable provider request ID, execution state, and saved acknowledgement. Database triggers reject updates to the snapshot and operation identity. Existing approval history is preserved; legacy approved actions require reconciliation before a new operation can be created.

| State | Meaning | Duplicate POST |
| --- | --- | --- |
| `SUBMITTING` | Operation reserved; provider acknowledgement has not been recorded | `202`, existing operation ID; no additional provider call |
| `SUCCEEDED` | Provider acknowledgement persisted | `200`, saved original result; no additional provider call |
| `UNCERTAIN` | Execution raised an error; whether the provider acted is not established | `409`, reconciliation required; no additional provider call |

A competing action or digest returns `409`. Reservation is unique per dispute, including across processes using the same SQLite file. The current scope permits one submitted operation per dispute. Further provider response rounds need an explicit reconciled workflow; they cannot be enabled by changing the digest. This is a conservative application-level duplicate-call guard, not a claim of exactly-once delivery by PayPal.

`executed_at` stays null until acknowledgement. OAuth and action requests have bounded timeouts. Provider errors, including timeouts and rejected responses, are conservatively held for reconciliation rather than automatically retried. A process crash can leave `SUBMITTING` indefinitely: the review endpoint and case detail expose that state, and retries remain blocked. The authenticated [reconciliation endpoint](dispute-reconciliation.md) inspects provider state and recovers stale submissions to UNCERTAIN. It never removes reservations or authorizes blind replay. There is no automatic recovery worker.

Acknowledged evidence submission and acceptance move an unchanged `REQUIRED_ACTION` dispute to `UNDER_REVIEW`. They do not establish final resolution. Conditional updates preserve a resolution or other update received during the provider call. A saved success response describes the original acknowledgement; retrieve case detail for the latest dispute state.

## Provider scope and remaining limitations

The provider client serializes the frozen `provider_payload` instead of reconstructing it from client notes. Tracking is taken from recorded tracking evidence; fabricated fallback tracking and the hardcoded acceptance reason were removed. The review UI explicitly states that no PDF documents are uploaded. The supported evidence request is structured tracking plus notes; additional evidence types and document uploads remain separate work.

The provider payload structure follows the [PayPal dispute API reference](https://developer.paypal.com/api/customer-disputes/v1/disputes-provide-evidence). Real Sandbox contract testing, provider-supported action/link discovery, carrier enum normalization, and broader evidence formats remain outstanding. Typed evidence and complete narrative validation are now enforced; see [evidence verification](evidence-verification.md). This work freezes and protects the reviewed content; it does not certify that every factual statement in existing drafts is true. Operational/demo separation is enforced by [environment isolation](environment-isolation.md); durable webhook processing is covered in [webhook reliability](webhook-reliability.md).

## Verification

Run `npm run test:approvals`, `npm run test:auth`, `npm test`, and `npm run build`. The approval suite uses fresh temporary databases, real authenticated route handlers, controlled concurrent provider promises, injected failures, and a stubbed HTTP transport. It asserts provider call counts, immutable request bodies, stale-review rejection, cross-merchant denial, execution timestamps, and preservation of a concurrent resolution. No real money or provider credentials are used.
