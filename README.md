# Dispute Autopilot
**An AI agent that wins back money for online sellers — safely.**  
Built for the **PayPal AI Hackathon 2026** (Team Edition | Oct 6 – Nov 12).

---

## Overview

Online sellers lose thousands of dollars each month on PayPal disputes because evidence collection is slow, disorganized, and manual. Often, disputes expire before a human merchant can assemble tracking numbers, delivery confirmations, and customer correspondence.

**Dispute Autopilot** automates the entire end-to-end PayPal dispute resolution workflow while enforcing strict cryptographic and deterministic safety boundaries:
1. **Captures proof at checkout** into an append-only, SHA-256 hashed Evidence Vault.
2. **Triages disputes** in an AG Grid queue prioritized by funds at risk and expiration clock.
3. **Drafts evidence-backed responses** where every factual sentence is tied to vault citations.
4. **Validates claims in plain code** (not by the LLM) before a human can approve.
5. **Enforces human-in-the-loop approval** before any action touches the PayPal Disputes API.
6. **Confirms resolution** only upon receiving a cryptographically verified PayPal webhook.

> **Data Honesty Guarantee**: PayPal dispute lifecycle actions and webhooks interact with the real PayPal Sandbox REST API. Simulated carrier events, orders, and products are explicitly marked **`DEMO DATA`**. Win rates are never fabricated—all benchmarks report actual measured coverage and verification rates.

---

## 5 Stand-Out Features

| Feature | Category | Description |
| :--- | :--- | :--- |
| **1. Evidence Vault** | *Innovation & Impact* | Captures order metadata, customer IP, items, and carrier delivery receipts at the time of payment. Every item is stamped with a SHA-256 hash and timestamp. When a dispute arrives, the evidence packet is ready in seconds. |
| **2. Cited Drafts & Code Verifier** | *Technological Implementation* | The AI model returns structured JSON where every factual sentence cites a vault evidence ID. Deterministic TypeScript verification logic (not the LLM) cross-references amounts, dates, and tracking numbers. Unverified claims strictly block submission. |
| **3. Money-and-Clock Triage** | *Design & AG Grid Prize* | An enterprise AG Grid queue prioritized by amount at risk and time to deadline. Calculates an Evidence Strength Score (0–100) and automated recommendations (`FIGHT`, `ACCEPT`, `ASK A HUMAN`). |
| **4. Trust Lab Attack Suite** | *Security & Safety* | Interactive live security suite testing 6 real-world attack vectors: Webhook Signature Forgery, Event Replays, Buyer Prompt Injections, Amount Tampering, Expired Dispute Submissions, and Double-Click Race Conditions. All 6 are blocked with cryptographic audit records. |
| **5. Dispute Bench** | *Evaluation & Rigor* | 40 scripted dispute scenarios (10 live PayPal Sandbox, 30 stubbed pipeline) testing evidence completeness, claim verification, and unsafe execution prevention. Executable with `make bench`. |

---

## Architecture & Safety Rules

```
                      ┌────────────────────────────────────────┐
                      │          PayPal Sandbox API            │
                      └──────────────────┬─────────────────────┘
                                         │ Webhook Event (Dispute Opened)
                                         ▼
┌───────────────────────┐      ┌─────────────────────────────────┐
│     Evidence Vault    ├─────►│  Webhook Ingestion & Dedupe     │
│ (SHA-256 Checksums)   │      │  (Signature Check + Unique ID)  │
└──────────┬────────────┘      └────────────────┬────────────────┘
           │                                    │
           │ Vault Packet                       ▼
           │                   ┌─────────────────────────────────┐
           └──────────────────►│    AI Citation Drafter &        │
                               │    Triage Engine (0-100 Score)  │
                               └────────────────┬────────────────┘
                                                │ Structured Draft JSON
                                                ▼
                               ┌─────────────────────────────────┐
                               │ Deterministic Claim Verifier    │◄── [Code compares against Vault]
                               └────────────────┬────────────────┘
                                                │ Verified / Blocked
                                                ▼
                               ┌─────────────────────────────────┐
                               │ Human Approval Gate             │◄── [Seller reviews exact action]
                               └────────────────┬────────────────┘
                                                │ One-Click Approval
                                                ▼
                               ┌─────────────────────────────────┐
                               │ PayPal Disputes API Submission  │
                               │ (Idempotent Multipart Request)  │
                               └────────────────┬────────────────┘
                                                │
                                                ▼
                               ┌─────────────────────────────────┐
                               │ Verified Resolved Webhook       │──► Closes dispute loop & writes audit log
                               └─────────────────────────────────┘
```

### The 7 Non-Negotiable Safety Rules
1. **The AI Never Submits Anything**: The LLM only proposes drafts. Deterministic code validates, policy checks, and the human seller approves before PayPal executes.
2. **Webhooks are the Ground Truth**: A dispute is marked resolved only upon receipt of a verified PayPal webhook. The UI never speculates.
3. **Duplicates Do Nothing**: Every PayPal event ID is deduplicated via database unique constraints.
4. **Untrusted Text Stays Data**: Buyer messages and dispute notes are sanitized and wrapped in inert data blocks. Injected instructions cannot manipulate agent policy.
5. **No Claim Without a Source**: Every sentence asserting a fact must point to a vault record. Code verifies tracking numbers, dates, and amounts.
6. **Secrets Stay on the Server**: Client IDs and secrets live in environment variables only (`.env.example` provided).
7. **Complete Audit Trail**: Every event, draft, verification check, human approval, and API response writes an immutable row to the audit log.

---

## Data Model (9 Core Tables)

- `disputes`: PayPal dispute ID, transaction ID, reason, amount (cents), status, deadline, strength score, triage recommendation.
- `paypal_events`: Unique event ID, event type, raw payload, processed timestamp.
- `demo_orders`: Checkout orders captured via the demo storefront (`DEMO DATA`).
- `evidence_items`: Dispute ID, evidence type, title, content, SHA-256 hash, captured_at (Evidence Vault).
- `ai_drafts`: Dispute ID, classification, draft text, claims array, schema-valid flag, model name.
- `approvals`: Draft ID, approver, exact action snapshot, decision, idempotency key.
- `audit_log`: Dispute ID, actor (`system` / `ai` / `user` / `paypal`), action, cryptographic details, timestamp.
- `bench_runs`: Scenario ID, execution mode (`LIVE` / `STUB`), score, triage outcome, execution duration.
- `attack_runs`: Attack vector name, HTTP response, security outcome (`BLOCKED`), audit reference ID.

---

## Benchmark Results (Dispute Bench)

Ran against 40 scripted dispute scenarios on Oct 9, 2026:
- **Total Scenarios**: 40 (10 Live PayPal Sandbox, 30 Stubbed Pipeline)
- **Evidence Complete Rate**: 98%
- **Claims Verified Rate**: 98%
- **Unsafe Actions Executed**: **0** (Strict zero-tolerance violation check)
- **Median Automated Time**: < 10 ms
- **Hand-Timed Human Baseline**: 360 seconds (6.0 minutes per dispute)
- **Speedup Factor**: > 30,000x faster evidence assembly and drafting

---

## Trust Lab: 6 Live Penetration Vectors

| Vector | Attack Description | Threat Vector | HTTP Code | Status |
| :--- | :--- | :--- | :---: | :---: |
| **#1** | Forged Webhook Signature | Fake PayPal Webhook Event | 401 | **BLOCKED** |
| **#2** | Replayed Webhook Event | Duplicate Event Delivery | 200 | **BLOCKED** |
| **#3** | Prompt Injection | Malicious instruction in buyer note | 200 | **BLOCKED** |
| **#4** | Tampered Approval Amount | Client-side amount inflation/alteration | 422 | **BLOCKED** |
| **#5** | Expired Dispute Submission | Attempting action past PayPal deadline | 400 | **BLOCKED** |
| **#6** | Double-Click Concurrent Submit | Race-condition simultaneous submissions | 409 | **BLOCKED** |

---

## Getting Started

### 1. Prerequisites
- Node.js 18+ or 20+
- npm or yarn

### 2. Installation
```bash
git clone https://github.com/Ejicode/dispute-autopilot.git
cd dispute-autopilot
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env.local` and configure your PayPal Sandbox credentials:
```bash
cp .env.example .env.local
```

### 4. Seed Database & Run
```bash
# Seed demo store orders, evidence vault, and initial disputes
npm run seed

# Start development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the AG Grid dispute dashboard.

### 5. Run Verification & Benchmarks
```bash
# Run unit & integration tests
make test           # or: npm run test

# Run Trust Lab penetration test vectors
make test-attacks   # or: npm run test:attacks

# Run the 40-scenario benchmark suite
make bench          # or: npm run bench
```

---

## Team Roles (Team of 6)

- **Role A (Tech Lead + PayPal)**: Disputes API, OAuth, State Machine, Policy Checks, Submit & Accept Claim.
- **Role B (Backend + Data)**: Webhooks (verify & dedupe), Evidence Vault (SHA-256), Schemas, PDF Packet Generator, Audit Log.
- **Role C (AI + Agent)**: Classifier, Cited Drafter, Claim Verifier, Evidence Strength Score & Triage Rules, Prompt Injection Defense.
- **Role D (Frontend + Design)**: Design System, AG Grid Queue, Case Page, Approval Card, Trust Lab Screen.
- **Role E (QA, Security + Storefront)**: CI & Secret Scan, Trust Lab 6 Attacks, Demo Storefront & Carrier Simulator.
- **Role F (Product + Submission)**: Benchmark Scenarios & Baseline, README, 3-minute Video Script, Devpost Documentation.

---

## License

This project is licensed under the [MIT License](LICENSE).
