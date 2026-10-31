package rag

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"github.com/Ejicode/dispute-autopilot/internal/ai"
	"github.com/Ejicode/dispute-autopilot/internal/store"
)

type Document struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Category  string   `json:"category"`
	Section   string   `json:"section"`
	Content   string   `json:"content"`
	Keywords  []string `json:"keywords"`
	Reference string   `json:"reference"`
}

type SearchResult struct {
	Doc   Document
	Score float64
}

type RAGContext struct {
	ContextText   string
	CitedSources  []string
	EvidenceCount int
	PolicyCount   int
}

var staticCorpus = []Document{
	{
		ID:        "pol_inr_11_3",
		Title:     "PayPal Seller Protection — Item Not Received (INR) Proof of Delivery",
		Category:  "PAYPAL_POLICY",
		Section:   "PayPal Seller Protection: proof of delivery",
		Content:   "For physical items disputed under Merchandise or Service Not Received (INR), PayPal Seller Protection covers the full transaction amount if the seller provides valid Proof of Delivery. Valid Proof of Delivery must be online viewable tracking documentation from an accepted shipping company (USPS, FedEx, UPS, DHL) showing: (1) Date of delivery and delivery status DELIVERED, (2) An address for the recipient that matches the shipping address on the Transaction Details page, or at least the city/state or ZIP code. Physical delivery coordinates and carrier timestamp verify compliance.",
		Keywords:  []string{"inr", "not received", "item not received", "delivery", "tracking", "carrier", "proof of delivery", "usps", "fedex", "ups", "address", "shipping", "11.3"},
		Reference: "PayPal Seller Protection (Proof of Delivery)",
	},
	{
		ID:        "pol_signature_11_3b",
		Title:     "PayPal Signature Confirmation Threshold for Items $750.00+",
		Category:  "PAYPAL_POLICY",
		Section:   "PayPal Seller Protection: signature confirmation",
		Content:   "If the total transaction amount (including taxes and shipping) is $750.00 USD or greater, PayPal Seller Protection MANDATES signature confirmation of delivery. The online viewable documentation from the carrier must show a physical or electronic signature confirmation from the recipient at the delivery address. If the order is $750 or more and lacks signature confirmation, Seller Protection is voided regardless of standard tracking.",
		Keywords:  []string{"signature", "750", "$750", "threshold", "expensive", "drone", "high value", "signed", "recipient signature", "11.3b"},
		Reference: "PayPal Seller Protection (Signature Confirmation, $750+)",
	},
	{
		ID:        "pol_snad_11_4",
		Title:     "Significantly Not As Described (SNAD) Defense Standards",
		Category:  "PAYPAL_POLICY",
		Section:   "Not-as-described disputes: evidence guidance",
		Content:   "For disputes alleging Merchandise or Service Not As Described (SNAD), the seller must submit indisputable evidence that the item delivered matched the product description at the time of purchase. Essential evidence includes: (1) The order receipt captured at checkout with specifications, (2) Manufacturer serial numbers or IMEI tied to the shipped unit, (3) High-resolution pre-shipment condition photos, and (4) The buyers acknowledgment of return policy. If the buyer damaged or altered the item, photographic inspection proof rebuts the claim.",
		Keywords:  []string{"snad", "not as described", "different", "damaged", "condition", "photos", "serial", "specifications", "description", "return policy", "11.4"},
		Reference: "Evidence guidance (Significantly Not As Described)",
	},
	{
		ID:        "pol_unauth_11_2",
		Title:     "Unauthorized Transaction & Chargeback Safe Harbor",
		Category:  "PAYPAL_POLICY",
		Section:   "PayPal Seller Protection: unauthorized transactions",
		Content:   "When a dispute or chargeback is filed under Unauthorized Transaction (claims that the cardholder or PayPal account holder did not authorize the charge), PayPal Seller Protection protects the merchant if: (1) The transaction was completed with PayPal account authorization, (2) The item was shipped to the verified address on the Transaction Details page, and (3) The merchant provides valid proof of shipment within the required response window.",
		Keywords:  []string{"unauthorized", "unauth", "fraud", "stolen", "account takeover", "safe harbor", "3ds", "ip", "telemetry", "chargeback", "11.2"},
		Reference: "PayPal Seller Protection (Unauthorized Transactions)",
	},
	{
		ID:        "pol_deadlines_11_5",
		Title:     "PayPal Resolution Center Timelines & Escalation Deadlines",
		Category:  "PAYPAL_POLICY",
		Section:   "PayPal Resolution Center: response deadlines",
		Content:   "Merchants have 10 calendar days to respond to an Inquiry or Dispute. If escalated to a Claim, PayPal sets a strict deadline (typically 3 to 10 days) for evidence submission. Missing this deadline results in automatic forfeiture of funds in favor of the buyer with an additional non-refundable $15-$20 dispute fee.",
		Keywords:  []string{"deadline", "time", "hours", "urgent", "resolution center", "inquiry", "claim", "forfeiture", "fee", "10 days", "48h"},
		Reference: "PayPal Resolution Center (Response Deadlines)",
	},
	{
		ID:        "da_standouts",
		Title:     "Dispute Autopilot (DA) 5 Standout Features",
		Category:  "DA_ARCHITECTURE",
		Section:   "DA System Specification",
		Content:   "1. Pre-Dispute Evidence Vault: Hashes (SHA-256) receipts, carrier tracking and delivery proof when the order is captured, so the evidence exists before a dispute arrives. 2. Cited Drafts Verified by Plain Code: the drafter returns claims citing specific vault evidence IDs; a plain Go verifier checks each fact before approval is allowed. 3. Money-and-Clock Triage (AG Grid): ranks disputes by money at risk and hours remaining, and a deterministic Evidence Strength Score recommends FIGHT, ACCEPT, or ASK A HUMAN. 4. Trust Lab: runs six attacks against the real defenses (forged webhook signatures, replays, prompt injection in buyer notes, tampered amounts, expired actions, double submits) and records each result. 5. Dispute Bench: a 40-scenario evaluation whose measured results are recorded when it runs. Quote Trust Lab and Bench results only from live state.",
		Keywords:  []string{"standout", "features", "architecture", "evidence vault", "plain code", "triage", "trust lab", "bench", "why da", "hackathon", "win", "5 standout"},
		Reference: "DA Technical Specification",
	},
	{
		ID:        "da_safety_invariants",
		Title:     "DA 7 Non-Negotiable Safety Invariants",
		Category:  "DA_SECURITY",
		Section:   "DA Security Specification",
		Content:   "1. AI never submits anything: Merchant approval is strictly required prior to PayPal Resolution API submission. 2. Webhooks are the truth: Dispute status transitions only occur via cryptographically verified PayPal webhooks. 3. Duplicates do nothing: Database enforces unique event_id idempotency. 4. Untrusted text stays data: Buyer notes and external strings are sanitized in <DATA_BLOCK_UNTRUSTED> fences to prevent prompt injection. 5. No claim without a source: Pure deterministic code verifies every cited fact against stored hash before submission. 6. Secrets stay on server: API keys and credentials never enter client bundles. 7. Everything is audited: an audit log, with a SHA-256 hash per entry, records system transitions.",
		Keywords:  []string{"safety", "invariants", "security", "never submits", "human in the loop", "approval", "prompt injection", "audit", "secrets", "7 invariants"},
		Reference: "DA Security Invariants & Audit Manual",
	},
	{
		ID:        "da_executive_summary",
		Title:     "Dispute Autopilot Core Value & Defense Architecture",
		Category:  "EXECUTIVE_SUMMARY",
		Section:   "Dispute Autopilot Value Proposition & Defense Architecture",
		Content:   "Dispute Autopilot helps PayPal sellers answer disputes with evidence they already hold. It provides: (1) SHA-256 hashed evidence captured before any dispute, (2) answers grounded in PayPal Seller Protection rules, (3) plain-code verification of every factual claim before approval, (4) a Trust Lab that attacks its own defenses and records the result, and (5) a 40-scenario benchmark. A human approves every action sent to PayPal.",
		Keywords:  []string{"why win", "hackathon", "pitch", "competition", "winner", "executive summary", "value", "roi", "savings", "problem", "solution", "architecture", "standout"},
		Reference: "Dispute Autopilot Architecture & Executive Summary",
	},
}

func Retrieve(ctx context.Context, db *store.Store, userID string, query string) (*RAGContext, error) {
	tokens := tokenize(query)
	var scoredResults []SearchResult

	for _, doc := range staticCorpus {
		score := scoreDocument(doc, tokens, query)
		if score > 0 {
			scoredResults = append(scoredResults, SearchResult{Doc: doc, Score: score})
		}
	}

	if db != nil {
		liveDocs, err := queryLiveCorpus(ctx, db, userID, query, tokens)
		if err != nil {
			return nil, err
		}
		for _, doc := range liveDocs {
			score := scoreDocument(doc, tokens, query)
			if score > 0 {
				scoredResults = append(scoredResults, SearchResult{Doc: doc, Score: score + 1.5})
			}
		}
	}

	sort.SliceStable(scoredResults, func(i, j int) bool {
		return scoredResults[i].Score > scoredResults[j].Score
	})

	topK := 5
	if len(scoredResults) < topK {
		topK = len(scoredResults)
	}

	var sb strings.Builder
	var citedSources []string
	evidenceCount := 0
	policyCount := 0

	sb.WriteString("[RAG RETRIEVED KNOWLEDGE BASE & GROUND TRUTH EVIDENCE]\n")
	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

	for i := 0; i < topK; i++ {
		res := scoredResults[i]
		doc := res.Doc
		citedSources = append(citedSources, doc.Reference)
		if doc.Category == "PAYPAL_POLICY" {
			policyCount++
		} else if doc.Category == "LIVE_EVIDENCE" || doc.Category == "LIVE_DISPUTE" {
			evidenceCount++
		}

		if strings.HasPrefix(doc.Category, "LIVE_") {
			// Database rows carry buyer- and webhook-supplied text (buyer
			// names, item titles, evidence content), titles included: fence
			// it all as data and keep only server-made fields outside.
			sb.WriteString(fmt.Sprintf("SOURCE [%s] (%s):\n", doc.ID, doc.Section))
			sb.WriteString(ai.WrapUntrustedData(doc.Category, doc.Title+"\n"+doc.Content))
		} else {
			sb.WriteString(fmt.Sprintf("SOURCE [%s] — %s (%s):\n", doc.ID, doc.Title, doc.Section))
			sb.WriteString(doc.Content)
		}
		sb.WriteString("\n────────────────────────────────────────────────────────────────────\n")
	}

	if topK == 0 {
		sb.WriteString("SOURCE [pol_inr_11_3] — PayPal Seller Protection (Proof of Delivery):\n")
		sb.WriteString(staticCorpus[0].Content)
		sb.WriteString("\n────────────────────────────────────────────────────────────────────\n")
		sb.WriteString("SOURCE [da_standouts] — DA 5 Standout Features:\n")
		sb.WriteString(staticCorpus[5].Content)
		sb.WriteString("\n")
		citedSources = append(citedSources, staticCorpus[0].Reference, staticCorpus[5].Reference)
		policyCount = 2
	}

	sb.WriteString("INSTRUCTIONS FOR AVA: Ground your answer strictly in these sources. Cite the policy by name (e.g. [PayPal Seller Protection (Proof of Delivery)]) and evidence IDs (e.g. [ev_...]) where relevant. Never invent section numbers. If asked why DA stands out, cite the 5 Core Features; quote benchmark numbers only from live state.\n")
	sb.WriteString("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

	return &RAGContext{
		ContextText:   sb.String(),
		CitedSources:  citedSources,
		EvidenceCount: evidenceCount,
		PolicyCount:   policyCount,
	}, nil
}

func queryLiveCorpus(ctx context.Context, db *store.Store, userID string, rawQuery string, tokens []string) ([]Document, error) {
	var docs []Document
	q := "%" + strings.TrimSpace(rawQuery) + "%"

	disputeRows, err := db.Query(ctx, `
		SELECT id, paypal_dispute_id, order_id, amount_cents, currency, reason, status, recommendation, response_deadline
		FROM disputes
		WHERE id LIKE ? OR paypal_dispute_id LIKE ? OR reason LIKE ?
		ORDER BY rowid DESC LIMIT 4`, q, q, q)
	if err != nil {
		return nil, err
	}
	defer disputeRows.Close()
	for disputeRows.Next() {
		var id, ppID, orderID, currency, reason, status, rec, deadline sql.NullString
		var amountCents sql.NullInt64
		if err := disputeRows.Scan(&id, &ppID, &orderID, &amountCents, &currency, &reason, &status, &rec, &deadline); err == nil {
			amt := float64(amountCents.Int64) / 100
			docs = append(docs, Document{
				ID:       id.String,
				Title:    fmt.Sprintf("Live Dispute %s ($%.2f %s)", ppID.String, amt, currency.String),
				Category: "LIVE_DISPUTE",
				Section:  "SQLite Database (Disputes Table)",
				Content: fmt.Sprintf("Dispute ID: %s (Internal: %s). Order ID: %s. Amount: $%.2f %s. Reason: %s. Status: %s. AI Recommendation: %s. Deadline: %s.",
					ppID.String, id.String, orderID.String, amt, currency.String, reason.String, status.String, rec.String, deadline.String),
				Keywords:  []string{strings.ToLower(ppID.String), strings.ToLower(id.String), strings.ToLower(reason.String), "dispute", "case"},
				Reference: fmt.Sprintf("Dispute %s", ppID.String),
			})
		}
	}

	evidenceRows, err := db.Query(ctx, `
		SELECT id, dispute_id, order_id, evidence_type, content, sha256_hash, captured_at
		FROM evidence_items
		WHERE id LIKE ? OR dispute_id LIKE ? OR order_id LIKE ? OR content LIKE ?
		ORDER BY rowid DESC LIMIT 4`, q, q, q, q)
	if err != nil {
		return nil, err
	}
	defer evidenceRows.Close()
	for evidenceRows.Next() {
		var id, dID, oID, eType, content, sha, capturedAt sql.NullString
		if err := evidenceRows.Scan(&id, &dID, &oID, &eType, &content, &sha, &capturedAt); err == nil {
			cleanContent := content.String
			if len(cleanContent) > 300 {
				cleanContent = cleanContent[:300] + "..."
			}
			docs = append(docs, Document{
				ID:       id.String,
				Title:    fmt.Sprintf("Vault Evidence [%s] — %s", id.String, eType.String),
				Category: "LIVE_EVIDENCE",
				Section:  "Evidence Vault (SHA-256 Hashed)",
				Content: fmt.Sprintf("Evidence ID: %s. Linked Dispute: %s. Linked Order: %s. Type: %s. SHA-256: %s. Captured: %s. Content: %s",
					id.String, dID.String, oID.String, eType.String, sha.String, capturedAt.String, cleanContent),
				Keywords:  []string{strings.ToLower(id.String), strings.ToLower(eType.String), "vault", "evidence", "tracking", "proof"},
				Reference: fmt.Sprintf("Evidence Vault [%s]", id.String),
			})
		}
	}

	orderRows, err := db.Query(ctx, `
		SELECT id, buyer_name, total_cents, items, tracking_number, carrier, delivery_status
		FROM demo_orders
		WHERE id LIKE ? OR buyer_name LIKE ? OR tracking_number LIKE ? OR items LIKE ?
		ORDER BY rowid DESC LIMIT 3`, q, q, q, q)
	if err != nil {
		return nil, err
	}
	defer orderRows.Close()
	for orderRows.Next() {
		var id, buyer, tracking, carrier, status, items sql.NullString
		var totalCents sql.NullInt64
		if err := orderRows.Scan(&id, &buyer, &totalCents, &items, &tracking, &carrier, &status); err == nil {
			amt := float64(totalCents.Int64) / 100
			docs = append(docs, Document{
				ID:       id.String,
				Title:    fmt.Sprintf("Storefront Order %s — %s ($%.2f)", id.String, buyer.String, amt),
				Category: "LIVE_ORDER",
				Section:  "Merchant Storefront Orders",
				Content: fmt.Sprintf("Order ID: %s. Buyer: %s. Amount: $%.2f. Status: %s. Carrier: %s. Tracking: %s. Items: %s",
					id.String, buyer.String, amt, status.String, carrier.String, tracking.String, items.String),
				Keywords:  []string{strings.ToLower(id.String), strings.ToLower(buyer.String), strings.ToLower(tracking.String), "order", "purchase", "sale"},
				Reference: fmt.Sprintf("Order %s", id.String),
			})
		}
	}

	return docs, nil
}

func scoreDocument(doc Document, tokens []string, rawQuery string) float64 {
	lowerContent := strings.ToLower(doc.Content + " " + doc.Title + " " + doc.Section)
	lowerQuery := strings.ToLower(rawQuery)
	score := 0.0

	if strings.Contains(lowerContent, lowerQuery) && len(lowerQuery) > 3 {
		score += 5.0
	}

	for _, kw := range doc.Keywords {
		if strings.Contains(lowerQuery, kw) {
			score += 3.0
		}
	}

	for _, t := range tokens {
		if len(t) <= 2 {
			continue
		}
		if strings.Contains(lowerContent, t) {
			score += 1.0
		}
	}

	return score
}

func tokenize(s string) []string {
	fields := strings.Fields(strings.ToLower(s))
	tokens := make([]string, 0, len(fields))
	for _, f := range fields {
		clean := strings.Trim(f, `.,!?:;'"()[]{}#_ `)
		if clean != "" {
			tokens = append(tokens, clean)
		}
	}
	return tokens
}
