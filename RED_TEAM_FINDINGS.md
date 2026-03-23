# Red Team Security Assessment -- Exploitable Vulnerabilities

Date: 2026-03-22
Scope: Express API, Socket.io, SQLite, game engine, order book, auth system

---

## VULN-1: CRITICAL -- Card Peeking via Room List and Mutation Responses

**Status: PATCHED**

Every HTTP response that returned a `RoomRecord` was sending raw, unsanitized
game state including `communityCards`, `allNonces`, `shuffleSeed`, and all
`playerCards` with their numeric values. This meant any player (or
unauthenticated attacker with dev bypass) could see every hidden card in every
active game.

**Affected endpoints (all patched):**
- `GET /api/room/` (listRooms -- no sanitization at all)
- `POST /api/room/create`
- `POST /api/room/join/:roomId`
- `POST /api/room/leave/:roomId`
- `POST /api/room/:roomId/start`
- `POST /api/room/:roomId/order`
- `DELETE /api/room/:roomId/order/:orderId`
- `POST /api/room/:roomId/add-bot`

Only `GET /api/room/:roomId` was sanitized. All others returned raw data.

**Proof of concept (pre-patch):**
```bash
# Step 1: Create room as attacker
curl -s http://localhost:3001/api/room/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"Exploit Room","maxPlayers":5}' | jq '.room.gameState'

# Step 2: After game starts, list all rooms to see ALL cards
curl -s http://localhost:3001/api/room/ | jq '.rooms[0].gameState.communityCards'
# Returns: [15, 7, 3]  -- the hidden community cards!

curl -s http://localhost:3001/api/room/ | jq '.rooms[0].gameState.playerCards'
# Returns all player card values!

curl -s http://localhost:3001/api/room/ | jq '.rooms[0].gameState.allNonces'
# Returns all nonces -- breaks commit-reveal scheme entirely!
```

**Fix:**
- Room list endpoint now returns lobby-safe metadata only (no gameState)
- All mutation endpoints now pass through `sanitizeRoomForPlayer()`
- `sanitizeRoomForPlayer()` rewritten with allowlist approach instead of
  blocklist/delete (prevents future field leaks when new fields are added)

**Files modified:**
- `api/lib/sanitize.ts` -- complete rewrite to allowlist approach
- `api/routes/room.ts` -- all 8 endpoints sanitized

---

## VULN-2: HIGH -- Auth Dev Bypass Causes Shared Identity

**Status: PATCHED**

With `AUTH_DEV_BYPASS=true` (currently active in `.env`), ALL unauthenticated
HTTP requests get identity `dev-user`. ALL unauthenticated socket connections
get either `dev-user` or `dev-{socketId}` (inconsistently). This means:

1. In HTTP mode, every player shares the same identity -- any player can
   cancel other players' orders, leave their rooms, and act as room host.
2. HTTP and Socket identities are inconsistent (HTTP: `dev-user`, Socket:
   `dev-{socketId}`), breaking the join-room validation.

**Proof of concept (pre-patch):**
```bash
# Player A creates a room
curl -s http://localhost:3001/api/room/create \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Room"}' | jq '.room.id'
# Returns: "room_ABCD1234"

# Player B (no auth, gets same dev-user identity) starts the game
# as if they were the host!
curl -s -X POST http://localhost:3001/api/room/room_ABCD1234/start
# Succeeds! Because both players are "dev-user" = the host
```

**Fix:**
- Dev bypass now reads `X-Dev-User-Id` header for distinct identities
- Header value validated against strict regex `^[a-zA-Z0-9_-]{1,64}$`
- Socket auth reads `auth.userId` from handshake for same purpose
- Falls back to default `dev-user` if no header provided

**Usage after fix:**
```bash
# Player A
curl -H 'X-Dev-User-Id: alice' http://localhost:3001/api/room/create ...

# Player B (different identity)
curl -H 'X-Dev-User-Id: bob' http://localhost:3001/api/room/join/room_ABCD1234 ...
```

**Files modified:**
- `api/middleware/authenticate.ts`
- `api/server.ts` (socket auth)

---

## VULN-3: HIGH -- Firestore/Memory RoomService Missing All Security Checks

**Status: PATCHED**

The `RoomService` class (Firestore/memory mode) was missing:
- Margin enforcement (players could over-leverage)
- 5-order limit (unlimited order spam possible)
- 2-second cancel cooldown (order spoofing possible)

These checks existed only in `SqliteRoomService`. While SQLite is the current
default, the Firestore path is one config change away from activation.

**Proof of concept:** Switch to Firestore mode, then:
```bash
# Submit 100 orders with zero margin check
for i in $(seq 1 100); do
  curl -s -X POST http://localhost:3001/api/room/ROOM_ID/order \
    -H 'Content-Type: application/json' \
    -d '{"price":200,"quantity":10,"side":"bid"}'
done
# All 100 succeed -- no 5-order limit, no margin check
```

**Fix:** Added margin enforcement, 5-order limit, and 2-second cancel cooldown
to `RoomService.submitOrder()` and `RoomService.cancelOrder()`.

**File modified:** `api/services/roomService.ts`

---

## VULN-4: MEDIUM -- Audit Hash Chain Field-Boundary Ambiguity

**Status: PATCHED**

The audit hash was computed as `SHA-256(prevHash + eventType + payload + timestamp)`.
Without delimiters, fields can be shifted to produce collisions:

- `eventType="order_submit"` + `payload="{}"` + `timestamp="1234"`
- `eventType="order_submi"` + `payload="t{}"` + `timestamp="1234"`

Both produce the same hash input and thus the same hash.

**Fix:** Changed to pipe-delimited format:
`SHA-256(prevHash|eventType|payload|timestamp)`

**File modified:** `api/services/auditService.ts`

---

## VULN-5: MEDIUM -- Health Endpoint Leaks Server Internals

**Status: PATCHED**

`GET /api/health` exposed `process.memoryUsage()`, `process.uptime()`, full
metrics snapshot, and environment name. This reveals:
- Exact heap/RSS sizes (memory layout fingerprinting)
- Uptime (timing attacks -- know when server restarted)
- Metrics (request counts, active rooms, player counts)

**Proof of concept:**
```bash
curl -s http://localhost:3001/api/health | jq
# Returns memory heap sizes, uptime in seconds, metrics...
```

**Fix:** Health endpoint now returns only `{ status, timestamp }`.

**File modified:** `api/server.ts`

---

## VULN-6: MEDIUM -- Predictable Order IDs Enable Game State Inference

**Status: PATCHED**

Order IDs were sequential (`ord_1`, `ord_2`, ...) using a global counter.
An attacker could infer:
- Total number of orders across all games
- Order submission rate
- Whether their orders were first or last

**Fix:** Order and trade IDs now use `crypto.randomBytes(8).toString('hex')`
for 16-char unpredictable hex IDs.

**File modified:** `packages/core/src/orderBook.ts`

---

## VULN-7: LOW -- Sanitize Function Used Blocklist Instead of Allowlist

**Status: PATCHED (part of VULN-1 fix)**

The original `sanitizeRoomForPlayer()` spread the entire `gameState` and then
deleted sensitive fields. This is a blocklist approach -- any new field added
to `RoomGameState` would automatically leak to clients unless someone
remembered to add it to the delete list.

**Fix:** Rewrote to use an explicit allowlist. The sanitized gameState is
built field-by-field. New fields on `RoomGameState` are hidden by default.

---

## VULN-8: LOW -- Compliance Endpoint JSON.parse Without Try-Catch

**Status: PATCHED**

`GET /api/room/:roomId/compliance` called `JSON.parse(r.details)` on data
from the database without error handling. Malformed data in the `details`
column would crash the endpoint.

**Fix:** Wrapped in try-catch, returns `null` on parse failure.

**File modified:** `api/routes/room.ts`

---

## Vulnerabilities Investigated But Not Exploitable

### SQL Injection
All queries use parameterized statements via `better-sqlite3` prepared
statements. No string interpolation into SQL. **Not exploitable.**

### Signed Receipt Forgery
Ed25519 private key is stored at `api/data/server.key` with 0600 permissions.
The `getPublicKey()` endpoint correctly only exposes the public key.
Canonicalization uses sorted keys to prevent JSON serialization ambiguity.
**Not exploitable** (assuming filesystem permissions are maintained).

### WebSocket Injection
Raw relay handlers were removed. The only socket events are `join-room` and
`leave-room`, both validated against room membership. All game state changes
go through HTTP endpoints. **Not exploitable.**

### Race Conditions on Phase Transitions
The SQLite implementation uses `db.transaction()` for all order submissions,
ensuring atomicity. Phase checks happen inside the transaction. A request
arriving during a phase transition will either succeed (phase still active)
or fail (phase already advanced). **Not exploitable** at the SQLite layer.

### Bot Prediction
Bot behavior uses `crypto.randomInt()` for shuffling and random delays,
plus personality-based but stochastic activation levels. While personality
patterns create tendencies, the exact timing and price decisions include
enough randomness to prevent reliable prediction. **Low risk.**

### Negative Balances
The margin check in `submitOrder` ensures `maxLoss <= availableBalance`.
For a bid at price P: maxLoss = P * qty.
For an ask at price P: maxLoss = (130 - P) * qty.
With negative prices (min -50), the worst case ask margin is (130-(-50))*10 = 1800,
which exceeds the starting balance of 1000, so such orders are correctly
rejected. PnL from matched trades can theoretically push a balance below
zero, but only through legitimate market outcomes. **Working as designed.**
