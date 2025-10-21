# 🚦 Alpha Launch Readiness To‑Do

This checklist translates the red‑team findings, security audit, and UX overhaul into a concrete path to a controlled **alpha**. Each section is ordered by priority. When an item references another document, link implementation notes there to keep this file lean.

---

## 1. Core Product Functionality

- [ ] **Realtime Lobby Data**
  - Hook `useLobbyTables` into the deployed `/api/room/list` endpoint with authenticated requests.
  - Add websocket subscription for live table updates (create/join/start events).
  - Display error banners when the connection drops and offer manual retry.
- [ ] **Table Lifecycle**
  - Persist trades/round state via `/api/trading` routes (no more client-only Rollbacks).
  - Implement optimistic update + reconciliation when the API response returns canonical state.
  - Expose a “Round Summary” card once `round.state === 'settle'` with top performer and P&L deltas.
- [ ] **Onboarding & Tutorials**
  - Create an interactive walkthrough modal for first-time players (lobby and first round).
  - Add contextual tooltips for voice controls, quote modal, and timer.
- [ ] **Accessibility Pass**
  - Run automated axe-core scan on lobby/table and fix violations.
  - Ensure modals trap focus, support Escape close, and announce state changes (pending manual QA).

## 2. Security & Compliance

- [ ] **ElevenLabs Key Rotation**
  - Rotate the exposed key, store in secrets manager, and update Vercel/Firebase envs.
  - Add runtime guard that refuses to call ElevenLabs if the key is missing or flagged.
- [ ] **Firebase Rules Deployment**
  - Deploy `firebase.rules` to staging & production; add CI check to prevent drift.
  - Implement integration test to confirm unauthorized write attempts are blocked.
- [ ] **Webhook Hardening**
  - Add signature verification middlware for payment providers (stub until providers live).
  - Document expected headers/secrets in `SECURITY_IMPLEMENTATION_SUMMARY.md`.
- [ ] **Bot Sandbox Audit**
  - Re-run static analysis against the worker-based sandbox; ensure resource limits enforced.
  - Add regression test that malicious code (e.g. `process.exit()`) is neutralized.

## 3. Payments & Settlement Scaffold

- [ ] **Stripe Sandbox Integration**
  - Replace the card scaffold with Stripe Elements, PaymentIntents, and client secret exchange.
  - Record transaction intents in the backend for ledger reconciliation.
- [ ] **Smart Contract Pull-Payments**
  - Implement escrow contract using OpenZeppelin PullPayment pattern.
  - Add on-chain unit tests (Hardhat/Foundry) verifying reentrancy protection.
- [ ] **ACH / Plaid Flow**
  - Integrate Plaid Link sandbox; store tokens securely; design manual review queue.
  - Document NACHA/SOC2 requirements with responsible owners and audit timeline.

## 4. Infrastructure & DevOps

- [ ] **Staging Environment**
  - Provision dedicated staging Firebase + API instance with representative data.
  - Automate seeded demo accounts (host, two bots) for alpha onboarding.
- [ ] **CI Pipeline Enhancements**
  - Add Vitest + Playwright runs in CI with Vercel preview comment gating.
  - Integrate security scans (npm audit, Snyk or similar) and fail builds on critical issues.
- [ ] **Observability**
  - Configure structured logging (request IDs, user IDs) in API & client (for voice failures).
  - Set up alerting for rate-limiter triggers, auth failures, and websocket disconnect spikes.

## 5. QA & Operations

- [ ] **Alpha Tester Ops Packet**
  - Draft tester NDA, bug reporting instructions, and rollback procedures.
  - Provide “known issues” list (with mitigations) to keep expectations aligned.
- [ ] **Automated Smoke Suite**
  - Expand `tests/red-team-termux.sh` or add a new script covering lobby join, round start, and quote submission using headless browser automation.
- [ ] **Support Playbooks**
  - Create runbooks for: voice service outage, payment reversal, Firebase failover.
  - Define triage channel (Slack/Discord) and escalation path for severity-1 incidents.

---

### Tracking & Status

Use GitHub Projects or Linear to track each checkbox. When an item lands, append a short note in this file linking to the PR/commit and relevant docs.

