# Dispute Autopilot
**An Autonomous AI Agent Powered by Google Gemini and PayPal REST APIs that Automates PayPal Dispute Defense, Captures Cryptographic Evidence, and Protects Merchant Revenue.**  
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
6. **Confirms resolution** from a verified PayPal webhook or authenticated provider reconciliation.

> **Data Honesty Guarantee**: PayPal dispute lifecycle actions and webhooks interact with the real PayPal Sandbox REST API. Simulated carrier events, orders, and products are explicitly marked **`DEMO DATA`**. Win rates are never fabricated—all benchmarks report actual measured coverage and verification rates.

---

## Built With

Dispute Autopilot bridges enterprise payment infrastructure and autonomous AI reasoning:

- **PayPal Platform**:
  - **PayPal Disputes REST API v1**: Automated evidence submission (`/v1/customer/disputes/{id}/provide-evidence`), claim acceptance, and lifecycle state management.
  - **PayPal Orders & Checkout REST API v2**: Real-time checkout transaction capture, customer billing metadata, and order verification.
  - **PayPal Webhooks Engine**: Real-time dispute opening, buyer response updates, and settlement webhooks verified cryptographically with simulated or live sandbox RSA certificate validation.
  - **PayPal Seller Protection Policy Engine**: Automated policy grounding adhering strictly to PayPal User Agreement § 11.3 (Proof of Delivery) and § 11.3(b) (Signature Confirmation for transactions $\ge \$750$).
  - **PayPal Developer Sandbox**: Live sandbox integration testing with merchant accounts.

- **Artificial Intelligence & Agents**:
  - **Google Gemini 2.5 / Flash**: High-speed reasoning for dispute classification, evidence relevance extraction, and factual defense drafting.
  - **Deterministic Code Claim Verifier**: Plain Go logic (not LLM) that checks every sentence's citations against the Evidence Vault before approval.
  - **Ava (Conversational AI Dispute Partner)**: Floating interactive assistant providing real-time dispute insights, policy guidance, and quick actions.
  - **Agentic Triage Engine**: Calculates Evidence Strength (0–100) and recommendation rules (`FIGHT`, `ACCEPT`, `ASK A HUMAN`).

- **Frontend & Data Visualization**:
  - **Next.js 14 & React 18**: Modern App Router, Server-Side Export (`output: 'export'`), responsive layouts.
  - **AG Grid Community**: High-performance Money-and-Clock dispute triage queue with custom cell renderers and live sorting.
  - **Tailwind CSS & 3D Specular Design**: Specular reflections, ambient ground sheen, and modern fintech styling.
  - **Recharts & Lucide Icons**: Real-time dispute volume trends and carrier transit graphs.

- **Backend, Storage & Cryptography**:
  - **Go 1.26**: High-performance single-binary HTTP API and static file server.
  - **SQLite (WAL Mode)**: Scoped multi-tenant merchant databases and immutable audit logging.
  - **SHA-256 Cryptographic Vault**: Immutable evidence hashing and tamper-evident chaining.

---

## 5 Stand-Out Features

| Feature | Category | Description |
| :--- | :--- | :--- |
| **1. Evidence Vault** | *Innovation & Impact* | Captures order metadata, customer IP, items, and carrier delivery receipts at the time of payment. Every item is stamped with a SHA-256 hash and timestamp. When a dispute arrives, the evidence packet is ready in seconds. |
| **2. Cited Drafts & Code Verifier** | *Technological Implementation* | The AI model returns structured JSON where every factual sentence cites a vault evidence ID. Deterministic Go verification logic (not the LLM) cross-references amounts, dates, and tracking numbers. Unverified claims strictly block submission. |
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
2. **Webhooks are the Ground Truth**: A dispute is marked resolved only from a verified PayPal webhook or authenticated provider reconciliation. The UI never speculates.
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

Ran against 40 scripted dispute scenarios on Oct 19, 2026:
- **Total Scenarios**: 40 (10 Live PayPal Sandbox, 30 Stubbed Pipeline)
- **Evidence Complete Rate**: 98%
- **Claims Verified Rate**: 100%
- **Unsafe Actions Executed**: **0** (Strict zero-tolerance violation check)
- **Median Automated Time**: < 1 ms
- **Hand-Timed Human Baseline**: 360 seconds (6.0 minutes per dispute)
- **Speedup Factor**: ~360,000x faster evidence assembly and drafting

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

## Quick Start for Judges (30-Second Evaluation)

Judges can test the full end-to-end platform instantly with zero configuration:

### 1. Launch Platform
```bash
# 1-Click Startup (verifies environment, compiles if needed, and starts on :3000):
./run
```

### 2. Instant Demo Credentials
Open [http://localhost:3000/login](http://localhost:3000/login) (credentials are pre-filled on the login screen):
- **User Email**: `admin@disputeautopilot.com`
- **Password**: `Password12345678!`
- Click **"Sign in →"** to access the pre-seeded merchant operations console.

### 3. 3-Minute Guided Evaluation Tour
1. **Dispute Queue (`/`)**:
   - Inspect the **AG Grid Money-and-Clock Triage Queue**. Notice how disputes are automatically sorted by funds at risk and expiration deadline.
   - Click the top dispute (`#PP-D-99214` - **$1,240.00** UltraHD 4K Drone Pro).
2. **Case Review & AI Defense (`/case/dsp_hero_1240`)**:
   - Inspect the **Grounded AI Draft**. Every single factual sentence cites a verified Evidence Vault record (`[EV-101]`, `[EV-102]`, `[EV-103]`).
   - Notice the **Deterministic Claim Verifier**: Plain Go code validates tracking numbers, timestamps, and PayPal § 11.3(b) signature requirements before approval.
   - Click **"Approve & Submit to PayPal"** to experience the human-in-the-loop safety gate.
3. **Evidence Vault (`/vault`)**:
   - View cryptographically hashed checkout receipts, carrier tracking logs, and delivery certificates stamped with immutable SHA-256 checksums.
4. **Trust Lab Attack Suite (`/trust-lab`)**:
   - Click **"Run Full Defense Test Suite"** to watch the system dynamically block 6 real-world attack vectors in real-time (Webhook Signature Forgery, Prompt Injection, Amount Tampering, Replays, Race Conditions).
5. **Dispute Bench (`/bench`)**:
   - View the 40-scenario benchmark evaluation proving 98% evidence completeness, 100% claim verification, 0 unsafe executions, and ~360,000x speedup.
6. **Ava AI Assistant**:
   - Click the floating Ava pill on the bottom-right of any screen to ask questions or trigger quick actions.

---

## Getting Started

The backend is a single Go binary that serves both the JSON API and the statically
exported Next.js frontend. Node.js is only needed to build the frontend assets.

### 1. Prerequisites
- Go 1.26+
- Node.js 20+ (build-time only, for the frontend)

### 2. Installation
```bash
git clone https://github.com/Ejicode/dispute-autopilot.git
cd dispute-autopilot

# Install frontend dependencies and build the static export into ./out
npm ci
npm run build

# Compile the Go server (and the CLI tools into ./bin)
make backend
```

Or do both in one step with `make build`.

### 3. Environment Configuration
Copy `.env.example` to `.env.local`. The default `APP_MODE=demo` runs offline simulations. To connect PayPal Sandbox, set both `APP_MODE=sandbox` and `PAYPAL_ENVIRONMENT=sandbox`, then configure credentials and integration ownership. See [environment isolation](docs/environment-isolation.md), including the changed database paths for existing installations:
```bash
cp .env.example .env.local
```
The Go server loads `.env.<NODE_ENV>.local`, `.env.local`, `.env.<NODE_ENV>`, then `.env` (matching the previous Next.js precedence), and always lets real process environment variables win.

### 4. Register & Run
```bash
# 1-Click Automated Startup (verifies env, compiles if needed, and launches on :3000):
./run

# Or build and run via make:
make dev

# Or run the compiled binary directly:
./bin/server
```
The server reads `PORT` (default `3000`) and `WEB_DIR` (default `./out`, the static frontend directory). Open [http://localhost:3000](http://localhost:3000), register a merchant account with a password of at least 15 characters, and sign in. Each account starts with an empty, isolated workspace. Use the demo storefront and dispute simulator to create that account's sample data.

`make seed` (`go run ./cmd/seed`) prepares a separate CLI-only demo workspace; it does not populate signed-in accounts. Existing legacy data is preserved but is not automatically assigned to new accounts. See [authentication and workspace setup](docs/authentication.md) for API contracts, PayPal ownership, deployment requirements, and migration guidance.

### 5. Run Verification & Benchmarks
```bash
# Run the full Go unit & integration test suite
make test           # go test ./...

# Authentication, merchant isolation, and realtime isolation (end-to-end over HTTP)
go test ./internal/httpapi/ -run TestHTTPApiEndToEnd -count=1

# Reviewed actions, stale snapshots, concurrent execution, and provider failures
go test ./internal/approvals/ -count=1

# Durable webhook retries, duplicates, and out-of-order events
go test ./internal/paypal/ -count=1

# Typed evidence and complete narrative verification
go test ./internal/ai/ -count=1

# Demo/sandbox/live API, database, and provider boundaries
go test ./internal/config/ ./internal/store/ -count=1

# Run Trust Lab penetration test vectors
make test-attacks   # go test ./internal/trustlab/ -count=1 -v

# Run the 40-scenario benchmark suite (writes bench_results.json)
make bench          # go run ./cmd/bench
```

---

## Prize Category Alignment

| Prize Category | Award | How Dispute Autopilot Wins |
| :--- | :---: | :--- |
| **Grand Prize / 1st Place** | **$12,000** | End-to-end, production-ready AI agent solving a multi-billion dollar merchant problem. Combines PayPal Disputes API, Google Gemini AI, SHA-256 Evidence Vault, and deterministic safety verification. |
| **Best Use of PayPal APIs** | **$5,000** | Deep integration across PayPal Disputes API v1, Orders API v2, Webhook signature verification, and automated Seller Protection (§ 11.3 & § 11.3(b)) compliance. |
| **Best Agentic AI Workflow** | **$5,000** | Autonomous multi-step agent: captures proof at checkout, prioritizes triage queue, drafts cited rebuttals, verifies claims with deterministic code, and enforces human-in-the-loop approval. |
| **Best Security & Responsible AI** | **$5,000** | Trust Lab with 6 live penetration tests: blocked webhook forgery, prompt injection neutralization, strict schema enforcement, and immutable cryptographic audit logs. |
| **Best UI/UX & Design** | **$5,000** | Enterprise AG Grid queue, 3D specular card reflections on white canvas, responsive sidebar navigation, and interactive floating AI assistant (Ava). |
| **Best Real-World Impact & Rigor** | **$5,000** | Dispute Bench testing 40 scenarios (10 live PayPal Sandbox, 30 pipeline), proving 100% claim verification, zero fabricated metrics, and ~360,000x speedup over human assembly. |

---

## Team Roles (Team of 6)

See [evidence verification](docs/evidence-verification.md) for supported facts, narrative checks, and regenerating legacy drafts.

The approval API uses an explicit review-and-submit flow. See [approval safety](docs/approval-safety.md) for the request contract, execution states, and reconciliation limits. See [webhook reliability](docs/webhook-reliability.md) to configure the retry scheduler and inspect failed provider events.

- **Role A (Tech Lead + PayPal)**: Disputes API, OAuth, State Machine, Policy Checks, Submit & Accept Claim.
- **Role B (Backend + Data)**: Webhooks (verify & dedupe), Evidence Vault (SHA-256), Schemas, PDF Packet Generator, Audit Log.
- **Role C (AI + Agent)**: Classifier, Cited Drafter, Claim Verifier, Evidence Strength Score & Triage Rules, Prompt Injection Defense.
- **Role D (Frontend + Design)**: Design System, AG Grid Queue, Case Page, Approval Card, Trust Lab Screen.
- **Role E (QA, Security + Storefront)**: CI & Secret Scan, Trust Lab 6 Attacks, Demo Storefront & Carrier Simulator.
- **Role F (Product + Submission)**: Benchmark Scenarios & Baseline, README, 3-minute Video Script, Devpost Documentation.

---

## License

This project is licensed under the [MIT License](LICENSE).

See [dispute reconciliation](docs/dispute-reconciliation.md) for inspecting unresolved approvals without retrying provider actions.
