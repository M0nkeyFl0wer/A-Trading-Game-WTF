/**
 * Reconnect / refresh recovery + sad-path coverage (issue #47).
 *
 * The happy-path tests hide the failure modes a real friend-test hits:
 *   (a) a quote is left sitting and EXPIRES, then a late hit/lift must be
 *       rejected with the 'expired' error rather than filling at a stale price;
 *   (b) a player's socket DISCONNECTS mid-round -- the server must keep serving
 *       everyone else and must let a fresh socket re-JOIN the room (this is the
 *       exact server contract the floor UI's reconnect/refresh recovery in
 *       apps/web/src/hooks/useRoomState.ts depends on: on (re)connect the client
 *       re-emits `join-room`, and only a re-join makes `rooms:update` resume);
 *   (c) a 3-player table (two humans + a bot) STARTS and SETTLES end to end.
 *
 * Everything here is hermetic per the api test conventions: a tmp DB_PATH, the
 * server bound to 127.0.0.1 on an OS-assigned free port (PORT 0), and dev-auth
 * bypass so sockets can identify themselves with `dev:<id>` tokens exactly like
 * the browser does. No real Firebase, no fixed port, no touching api/data.
 *
 * These env vars MUST be set before `../server` (and the modules it pulls in,
 * which read them at load) are imported -- same rule as addBot/quotes tests.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { Server } from 'http';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-game-recovery-'));
process.env.DB_PATH = path.join(tmpDir, 'game.db');
process.env.PORT = '0';
process.env.AUTH_DEV_BYPASS = 'true';
process.env.ELEVENLABS_API_KEY = 'test-key';

// The bot sandbox spins up worker threads at import; stub it exactly as the
// other api tests do. The server-side personality bots (botService) never run
// user code and are unaffected, so the 3-player settle path is still real.
vi.mock('@trading-game/bot', () => {
  class MockSandbox {
    async executeBot() {
      return { success: true, trade: { price: 100, size: 1 }, executionTime: 5, memoryUsed: 1024 };
    }
    getStats() {
      return { trades: 1 };
    }
    killWorker() {
      return true;
    }
  }
  return { SecureBotSandbox: MockSandbox };
});

let app: Express;
let server: Server;
let listening: Server;
let port: number;
let roomService: typeof import('../services/roomService')['roomService'];
let botService: typeof import('../services/botService')['botService'];
let db: ReturnType<typeof import('../services/database')['getDatabase']>;

beforeAll(async () => {
  const mod = await import('../server');
  app = mod.app;
  server = mod.server;
  // Under VITEST server.ts stays passive (never listens on import); the socket
  // tests need a real listener, so we bind it here on a free port.
  listening = await mod.start(0, '127.0.0.1');
  port = (listening.address() as AddressInfo).port;

  roomService = (await import('../services/roomService')).roomService;
  botService = (await import('../services/botService')).botService;
  db = (await import('../services/database')).getDatabase();
});

afterAll(async () => {
  // Kill bot floor-coordinator intervals before closing so no timer fires into
  // a torn-down DB and leaves the vitest worker hanging.
  botService?.shutdown();
  await new Promise<void>((resolve) => listening.close(() => resolve()));
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Two humans, dealt and in the 'blind' phase, ready to trade. */
async function makeTradingRoom(hostId = 'alice', otherId = 'bob') {
  const room = await roomService.createRoom('Recovery Test', 4, hostId, 'Alice');
  await roomService.joinRoom(room.id, { id: otherId, name: 'Bob' });
  const started = await roomService.startRoom(room.id, hostId);
  expect(started.status).toBe('blind');
  // Stop the automatic phase-transition timer so the round can't advance or
  // settle out from under a test that drives the state by hand.
  (roomService as unknown as { clearTimers(id: string): void }).clearTimers(room.id);
  return room.id as string;
}

/** Directly patch a persisted quote's expiresAt into the past (no waiting on TTL). */
function forceExpire(roomId: string, quoteId: string) {
  const row = db.prepare('SELECT game_state FROM rooms WHERE id = ?').get(roomId) as { game_state: string };
  const gs = JSON.parse(row.game_state);
  const quote = gs.quotes.find((q: { id: string }) => q.id === quoteId);
  quote.expiresAt = Date.now() - 1000;
  db.prepare('UPDATE rooms SET game_state = ? WHERE id = ?').run(JSON.stringify(gs), roomId);
}

/** Open a dev-identity socket like the browser does (`dev:<id>` handshake token). */
function connectClient(devId: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    auth: { token: `dev:${devId}` },
    // Deterministic tests: no auto-reconnect noise, always a fresh socket.
    reconnection: false,
    forceNew: true,
  });
}

/** Resolve when `socket` emits `event`, or reject after `timeoutMs`. */
function waitFor<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for '${event}'`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Join a room over the socket and give the async server-side join a beat to land. */
async function joinRoom(socket: ClientSocket, roomId: string) {
  // The connect can land before this listener attaches (localhost is fast), so
  // only wait when we're not already connected -- otherwise `once('connect')`
  // would hang for an event that already fired.
  if (!socket.connected) await waitFor(socket, 'connect');
  socket.emit('join-room', roomId);
  // The server's join-room handler awaits a DB read before `socket.join`, so a
  // room:updated fired immediately after the emit could race the join. A short
  // settle keeps the tests deterministic without polling for an ack the server
  // doesn't send.
  await new Promise((r) => setTimeout(r, 150));
}

// ---------------------------------------------------------------------------
// (a) + (c): service-level sad paths -- deterministic, no sockets
// ---------------------------------------------------------------------------

describe('sad path: quote expiry (issue #47)', () => {
  it('a quoted price left to expire cannot be hit -- returns the expired error', async () => {
    const roomId = await makeTradingRoom();
    const requested = await roomService.requestQuote(roomId, 'alice', 'bob');
    const quoteId = requested.gameState!.quotes![0].id;
    // Bob quotes a real two-way price, so the quote is 'quoted' (hit-able)...
    await roomService.respondToQuote(roomId, 'bob', quoteId, 60, 62);
    // ...but Alice sleeps on it until the TTL lapses.
    forceExpire(roomId, quoteId);

    await expect(roomService.hitQuote(roomId, 'alice', quoteId)).rejects.toMatchObject({
      status: 400,
      message: /expired/i,
    });
    // The mirror side (lift the ask) must be rejected the same way.
    await expect(roomService.liftQuote(roomId, 'alice', quoteId)).rejects.toMatchObject({
      status: 400,
      message: /expired/i,
    });
  });

  it('an unanswered (pending) quote that expires cannot later be responded to', async () => {
    const roomId = await makeTradingRoom();
    const requested = await roomService.requestQuote(roomId, 'alice', 'bob');
    const quoteId = requested.gameState!.quotes![0].id;
    // Bob never answered; the request itself ages out.
    forceExpire(roomId, quoteId);

    await expect(
      roomService.respondToQuote(roomId, 'bob', quoteId, 60, 62),
    ).rejects.toMatchObject({ status: 400, message: /expired/i });
  });
});

describe('sad path: a 3-player table starts and settles (issue #47)', () => {
  it('two humans + a bot deal, trade, and settle with PnL for every seat', async () => {
    const room = await roomService.createRoom('Trio Table', 4, 'alice', 'Alice');
    await roomService.joinRoom(room.id, { id: 'bob', name: 'Bob' });
    const withBot = await roomService.addBot(room.id, 'alice', 'WHALE');
    const bot = withBot.players.find((p) => p.isBot)!;
    expect(withBot.players).toHaveLength(3);

    const started = await roomService.startRoom(room.id, 'alice');
    expect(started.status).toBe('blind');
    // Drive settlement by hand rather than waiting ~70s of real phase timers.
    (roomService as unknown as { clearTimers(id: string): void }).clearTimers(room.id);

    // A real human-vs-human fill so settlement has something to price.
    const requested = await roomService.requestQuote(room.id, 'alice', 'bob');
    const quoteId = requested.gameState!.quotes![0].id;
    await roomService.respondToQuote(room.id, 'bob', quoteId, 60, 62);
    await roomService.hitQuote(room.id, 'alice', quoteId);

    // settleRound is the private terminus of the phase chain; call it directly
    // so the test settles deterministically instead of on a timer.
    await (roomService as unknown as { settleRound(id: string): Promise<void> }).settleRound(room.id);
    (roomService as unknown as { clearTimers(id: string): void }).clearTimers(room.id);

    const finished = await roomService.getRoom(room.id);
    expect(finished.status).toBe('finished');
    const gs = finished.gameState!;
    expect(typeof gs.settlementTotal).toBe('number');
    // Every seat -- both humans AND the bot -- gets a PnL entry.
    expect(gs.pnl).toBeDefined();
    expect(Object.keys(gs.pnl!).sort()).toEqual(['alice', 'bob', bot.id].sort());
    // The alice/bob fill is zero-sum; the bot, which never traded, nets zero.
    expect(gs.pnl!.alice + gs.pnl!.bob).toBe(0);
    expect(gs.pnl![bot.id]).toBe(0);
    // The fill we made is present in the settled trade tape.
    expect(gs.matchedTrades.some((t) => t.buyOrderId === `quote_${quoteId}_buy`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b): socket disconnect mid-round + the re-join recovery contract
// ---------------------------------------------------------------------------

describe('sad path: socket disconnect + reconnect recovery (issue #47)', () => {
  it('a joined socket receives live room updates', async () => {
    const roomId = await makeTradingRoom('sk-alice', 'sk-bob');
    const alice = connectClient('sk-alice');
    try {
      await joinRoom(alice, roomId);
      const update = waitFor<{ id: string }>(alice, 'rooms:update');
      // Any state change fans a sanitized snapshot out to the room's sockets.
      await roomService.requestQuote(roomId, 'sk-alice', 'sk-bob');
      const payload = await update;
      expect(payload.id).toBe(roomId);
    } finally {
      alice.disconnect();
    }
  });

  it('one player disconnecting mid-round does not crash the server or stop others', async () => {
    const roomId = await makeTradingRoom('dc-alice', 'dc-bob');
    const alice = connectClient('dc-alice');
    const bob = connectClient('dc-bob');
    try {
      await joinRoom(alice, roomId);
      await joinRoom(bob, roomId);

      // Bob's browser vanishes mid-round (closed tab / dropped wifi).
      bob.disconnect();
      await new Promise((r) => setTimeout(r, 150));

      // The server must still be healthy...
      const health = await request(app).get('/api/health');
      expect(health.status).toBe(200);

      // ...still fan updates to the survivor without throwing while iterating
      // a room whose membership just changed...
      const update = waitFor<{ id: string }>(alice, 'rooms:update');
      await roomService.requestQuote(roomId, 'dc-alice', 'dc-bob');
      expect((await update).id).toBe(roomId);

      // ...and a socket disconnect must NOT evict the player from the game:
      // their seat (and card) survive for when they refresh back in.
      const room = await roomService.getRoom(roomId);
      expect(room.players.map((p) => p.id).sort()).toEqual(['dc-alice', 'dc-bob']);
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('a fresh socket can re-join after a disconnect and updates resume (refresh recovery)', async () => {
    const roomId = await makeTradingRoom('rj-alice', 'rj-bob');
    const first = connectClient('rj-alice');
    await joinRoom(first, roomId);
    // Simulate a page refresh: the old socket dies entirely.
    first.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    // A brand-new socket for the SAME dev identity re-joins -- exactly what the
    // floor UI does on mount / on socket 'connect'. Without a re-join the server
    // would deliver nothing to this new socket.
    const reconnected = connectClient('rj-alice');
    try {
      await joinRoom(reconnected, roomId);
      const update = waitFor<{ id: string }>(reconnected, 'rooms:update');
      await roomService.requestQuote(roomId, 'rj-alice', 'rj-bob');
      expect((await update).id).toBe(roomId);
    } finally {
      reconnected.disconnect();
    }
  });
});
