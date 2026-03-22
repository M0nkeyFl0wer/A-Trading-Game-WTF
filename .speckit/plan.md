# A-Trading-Game-WTF — Implementation Plan

## Current State

The game has correct Liar's Poker mechanics in `packages/core/` (3-phase Round + OrderBook), but the API services and frontend are disconnected. Several build-breaking API mismatches exist, and critical security vulnerabilities prevent real-money deployment.

---

## Phase 0: Fix Build-Breaking Bugs (Day 1)

| ID | Task | Deps | Complexity | Parallel |
|----|------|------|-----------|----------|
| T-001 | Fix gameEngine.ts API mismatches with core OrderBook (`book.submit()`→`submitOrder()`, `getRestingOrders()`→`getOpenOrders()`, `config.revealedCards`→`config.communityCardsRevealed`, `remainingQty`→`filledQuantity`) | — | S | Yes |
| T-002 | Rewrite sqliteRoomService for 3-phase model (blind/flop/turn lifecycle, submitOrder/cancelOrder, phase timer chain, remove old pendingTrades/completeRound) | T-001 | L | No |
| T-003 | Unify room services — make SqliteRoomService the canonical implementation, re-export as roomService | T-002 | M | No |

## Phase 1: Security Hardening — Critical (Days 2-4)

| ID | Task | Deps | Complexity | Parallel |
|----|------|------|-----------|----------|
| T-004 | **State sanitization** — `sanitizeRoomForPlayer()` strips hidden cards, anonymous orders. Per-socket emissions replace `io.emit()`. Sanitize GET /:roomId too | T-003 | L | No |
| T-005 | **Crypto shuffle** — Replace all `Math.random()` with `crypto.randomInt()` in shuffle, ID gen, bot decisions | T-001 | S | Yes |
| T-006 | **Remove dangerous WS handlers** — Delete raw `socket.on('trade')` and `socket.on('message')` relays. Add room membership check on `join-room` | — | S | Yes |
| T-007 | **Price/quantity bounds** — Max price 200, min -50, max qty 10. Server-side validation in gameEngine as second line | — | S | Yes |
| T-008 | **Auth hardening** — Production guard vs dev bypass. Unique dev user IDs per session. Room membership on socket join | — | M | Yes |
| T-009 | **Rate limit order endpoints** — Apply tradingLimiter to POST /:roomId/order and DELETE /:roomId/order/:orderId | — | S | Yes |
| T-010 | **Order spoofing protection** — Max 5 open orders/player/room. 2-second min resting before cancel | T-003 | M | No |

## Phase 2: Frontend Rebuild (Days 3-7)

| ID | Task | Deps | Complexity | Parallel |
|----|------|------|-----------|----------|
| T-011 | **Store update** — Add orderBook, tradingPhase, revealedCommunityCards, phaseEndsAt, settlementTotal, pnl, myCard. Remove old Round usage | T-003 | M | Yes |
| T-012 | **useRoomState update** — Parse new gameState (orders, matchedTrades, revealedCommunityCards, phase, phaseEndsAt, pnl). Map blind/flop/turn statuses | T-011 | M | No |
| T-013 | **OrderForm component** — BID/ASK toggle, price input with +/-, qty slider 1-10, EV estimate display. POST to /:roomId/order | T-012 | M | No |
| T-014 | **OrderBookDisplay component** — Bids (green left) / Asks (red right), depth levels, own-order highlight, cancel button. Spread/best bid/best ask | T-012 | M | Parallel w/ T-013 |
| T-015 | **PhaseIndicator** — Visual stepper Blind→Flop→Turn→Settlement, active highlight, countdown timer, revealed cards per phase | T-011 | S | Yes |
| T-016 | **CommunityCards** — 3 card slots, face-down→flip animations, progressive reveal, total at settlement | T-011 | S | Yes |
| T-017 | **TradeTape update** — Display MatchedTrade[] format, buyer/seller/price/qty/phase, color by phase | T-012 | S | Yes |
| T-018 | **Settlement screen** — Total value, all cards revealed, per-player PnL table, winner highlight, next round countdown | T-012 | M | No |
| T-019 | **TablePage rebuild** — Integrate all new components. PhaseIndicator+CommunityCards top, OrderBook+OrderForm center, Seats+Tape sidebar, Settlement overlay | T-013 T-014 T-015 T-016 T-017 T-018 | L | No |

## Phase 3: Bot Intelligence (Days 5-7)

| ID | Task | Deps | Complexity | Parallel |
|----|------|------|-----------|----------|
| T-020 | **Bot order-book strategy** — Phase-aware scheduling (act in all 3 phases). Market-making: post both bids+asks. Personality→spread/aggression/sizing. Use submitOrder() | T-003 | L | Yes |
| T-021 | **Bot info updating** — On phase advance: recalculate EV with new community cards, cancel mispriced orders, post updated orders | T-020 | M | No |
| T-022 | **KG order patterns** — Record spread, cancel frequency, phase behavior, position direction per player | T-020 | M | Parallel w/ T-021 |

## Phase 4: Security — Enhanced (Week 2)

| ID | Task | Deps | Complexity | Parallel |
|----|------|------|-----------|----------|
| T-023 | **Margin enforcement** — Calculate max loss before accepting orders. Lock margin from available balance. Reject if insufficient | T-003 | M | Yes |
| T-024 | **Commit-reveal cards** — SHA-256 commitments at deal, nonce reveals at phase transitions. Client-verifiable | T-004 | L | No |
| T-025 | **Anonymize order book** — Strip playerId/Name from other players' orders in sanitized view | T-004 | S | No |
| T-026 | **Audit log** — Hash-chained append-only SQLite table. Events: deal, phase_advance, order, cancel, match, settlement | T-003 | M | Yes |
| T-027 | **Signed receipts** — Ed25519 server keypair. Sign orders+trades. Serve public key at /api/public-key | T-026 | M | No |

## Phase 5: Infrastructure (Week 2)

| ID | Task | Deps | Complexity | Parallel |
|----|------|------|-----------|----------|
| T-028 | **Game event system** — Typed event emitter (deal/phase/order/trade/settle). Replaces generic roomEvents. Feeds audit, voice, frontend, bots | — | M | Yes |
| T-029 | **Double-entry ledger** — SQLite ledger table. Every balance change has opposite entry. SUM(round)=0 verification | T-003 | M | Yes |
| T-030 | **Crash recovery** — On startup: scan active rooms, advance through missed phases, settle. Idempotent | T-003 | M | No |

## Phase 6: Polish (Week 2+)

| ID | Task | Deps | Complexity | Parallel |
|----|------|------|-----------|----------|
| T-031 | **Commentator bot** — Dealer narrates via ElevenLabs: deals, reveals, big trades, settlements. Hooks into game events | T-028 | M | Yes |
| T-032 | **Remove legacy /trade endpoint** — Clean up old submitTrade code path | T-019 | S | Yes |

---

## Critical Path

```
T-001 → T-002 → T-003 → T-004 (state sanitization)
                       → T-011 → T-012 → T-013/T-014 → T-019 (frontend)
                       → T-020 → T-021 (bots)
```

Everything branches from T-003 (unified room service). Security tasks T-005 through T-009 run in parallel from day 1. Frontend components T-015/T-016 can start early against the store interface.

## Parallelization Map

**Can start immediately (no deps):**
T-001, T-005, T-006, T-007, T-008, T-009, T-028

**After T-003 (unified service):**
T-004, T-010, T-011, T-020, T-023, T-026, T-029, T-030

**After T-012 (store+hook):**
T-013, T-014, T-017, T-018

**Final integration:**
T-019 (TablePage), T-032 (cleanup)

---

## Phase 7: Topological Compliance Verification (P2)

Use algebraic topology (persistent homology, simplicial complexes) over game state data to detect structural violations of game rules.

| ID | Task | Deps | Complexity | Parallel |
|----|------|------|-----------|----------|
| T-033 | **Trade graph simplicial complex builder** — After each round, construct a simplicial complex from the trade graph (players=vertices, trades=edges, multi-party cycles=higher simplices). Store in SQLite alongside audit log. | T-026 | M | Yes |
| T-034 | **Homology computation module** — Python sidecar using ripser/giotto-tda. Compute Betti numbers (B0=connected components, B1=cycles) of the trade complex. Expose via local HTTP or subprocess call. | T-033 | L | No |
| T-035 | **Constitutional invariants as topological rules** — Encode game rules: B1=0 (no collusion cycles), information filtration is monotonic (player behavior doesn't correlate with unrevealed cards), zero-sum verification via chain complex boundary operator. | T-034 | L | No |
| T-036 | **Information flow filtration** — Model each player's information state as a filtered simplicial complex across phases. Detect if trading behavior shows response to information not yet available (orders correlated with hidden community cards = filtration break). | T-034 | L | Parallel w/ T-035 |
| T-037 | **Compliance dashboard** — API endpoint + frontend panel showing per-round topological health: Betti numbers, filtration consistency score, flagged anomalies. Red/yellow/green status per round. | T-035 T-036 | M | No |

### How it works

```
Round completes
  → Audit log records all events (T-026)
  → Build simplicial complex from trade graph (T-033)
  → Compute persistent homology (T-034)
  → Check constitutional invariants (T-035):
      • B1 = 0? (no collusion rings)
      • Filtration monotonic? (no info leakage)
      • Σ(PnL) = 0? (zero-sum via boundary operator)
  → Check information flow (T-036):
      • Player order timing vs community card reveal
      • Price correlation with hidden state
  → Flag violations in compliance dashboard (T-037)
```

### Implementation notes

- Python sidecar preferred (ripser, giotto-tda, gudhi are mature TDA libraries)
- The KG tables (kg_entities, kg_edges) already model the graph — can compute complexes directly
- Light enough to run post-round (not real-time) — ~100ms for 5-player trade graphs
- Could also apply persistent homology to price time series per phase to detect manipulation patterns
