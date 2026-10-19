# Evidence verification

Draft generation and approval now use the same typed evidence verifier. Every claim must identify a unique available evidence item linked to the dispute or its order. Its SHA-256 must match its JSON content, and its evidence type and source must be supported. Missing, malformed, partial, or unsupported facts fail closed. Hashes detect content changes; they do not independently establish that a source told the truth.

## Supported facts

- Tracking numbers: the complete `tracking_number` field in carrier tracking or delivery evidence. Label creation supports a recorded tracking number, not a claim that goods shipped.
- Shipping dates: a `PICKED_UP` or `SHIPPED` event timestamp. Label creation and vault capture time do not count.
- Delivery dates: `delivered_at` or a delivery event in proof-of-delivery or tracking marked `DELIVERED`. Conflicting dates and contradictory proof-of-delivery statuses fail.
- Delivery addresses: the complete `delivered_address` in dated delivery evidence. A checkout shipping address does not establish delivery.
- Amounts: positive integer `total_cents` or `amount_cents` plus an explicit currency in order evidence. The claim describes the recorded amount; it need not equal a partially disputed amount. Missing currency is not inferred from the dispute.
- Buyer names: the complete `buyer_name` in order evidence.

Text comparisons trim and collapse whitespace, preserve case, and match whole fields. Dates must be valid ISO calendar dates or timestamps; comparisons use the recorded calendar day. Currency support retains the existing integer-cent model.

Carrier sources currently include USPS, UPS, FEDEX, DHL, CARRIER_INTEGRATION and CARRIER_SIMULATOR. Order sources are the existing storefront/capture adapters implemented in `internal/ai/facts.go`. Unknown source labels and plain text cannot supply these claims. Adding an adapter requires a reviewed mapping and tests. Simulation labels remain supported for demonstration: approval now also enforces the [environment provenance boundary](environment-isolation.md).

## Narrative binding

Claim text uses fixed factual templates, and the complete narrative is rendered from those same claims with evidence citations. Free-form sentences cannot acquire verification from an unrelated valid claim list. Buyer messages do not affect this deterministic generator. The model label is `DisputeAutopilot-Deterministic-v2`; configuring an AI key does not activate a live LLM integration.

Verification means these recorded facts match their cited fields. It does not establish evidence completeness, successful delivery from an order receipt, a winning defense, or eligibility for a PayPal action. Triage scoring remains a separate implementation.

Persistence, explicit rechecking, case detail, benchmarks, and approval all use full narrative validation. Approval checks again regardless of a stored verified flag and constructs tracking payloads only from cited, checked tracking records. Existing immutable submitted operation snapshots are preserved.

## Existing drafts and regeneration

Legacy drafts with unsupported narrative templates cannot be approved. Case detail rechecks the displayed draft so an old stored flag does not appear as current verification. Rechecking never removes malformed claims to make a draft pass later.

Use **Regenerate from current evidence** on the case page, or authenticated `POST /api/disputes/{id}/regenerate-draft` with `{}` and the configured Origin. The endpoint creates a new draft and audit record atomically, preserves history, and invalidates earlier reviews. It returns `201` with `{draft}`; a draft with no usable evidence remains unverified. Client-supplied content is rejected (`400`), unknown/foreign cases return `404`, and cases no longer awaiting action or with any submitted/reserved approval return `409`. Anonymous requests return `401`.

Regeneration is explicit. Automatic refresh after every carrier update, broader evidence association changes, provider document uploads, and Sandbox contract validation remain separate work.

## Validation

Run `go test ./internal/ai/ ./internal/approvals/ ./internal/paypal/ ./internal/httpapi/ -count=1`, `go test ./...`, and `npm run build`. Tests cover exact fields, unsupported facts, hashes, ownership, malformed claims, narrative tampering, draft history, and the authenticated approval/regeneration routes. They do not make real provider calls.

The synthetic benchmark now verifies 40/40 generated drafts because the in-transit case no longer invents delivery facts. This measures the claims actually included, not completeness or a successful defense. Its existing live labels and safety/speedup metrics still require separate correction. No Sandbox calls occur in that benchmark.
