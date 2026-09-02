/**
 * Two-way quote requests (Phase 2): routes, service validation, sanitize
 * privacy, and the bot auto-responder.
 *
 * Uses the addBot.test.ts harness (tmp DB, server import) for HTTP-level
 * wiring + privacy checks, plus direct `roomService` calls (the same
 * singleton the server wires) for whitebox assertions -- e.g. mutating a
 * quote's persisted expiresAt to simulate TTL expiry without waiting.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import type { Server } from 'http';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-game-quotes-'));
process.env.DB_PATH = path.join(tmpDir, 'game.db');
process.env.PORT = '0';
process.env.AUTH_DEV_BYPASS = 'true';
process.env.ELEVENLABS_API_KEY = 'test-key';

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
let roomService: typeof import('../services/roomService')['roomService'];
let db: ReturnType<typeof import('../services/database')['getDatabase']>;

beforeAll(async () => {
  const mod = await import('../server');
  app = mod.app;
  server = mod.server;
  const svc = await import('../services/roomService');
  roomService = svc.roomService;
  const dbMod = await import('../services/database');
  db = dbMod.getDatabase();
});

afterAll(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Two humans, a room dealt and in the 'blind' phase, ready to trade. */
async function makeTradingRoom() {
  const room = await roomService.createRoom('Quote Test', 4, 'alice', 'Alice');
  await roomService.joinRoom(room.id, { id: 'bob', name: 'Bob' });
  const started = await roomService.startRoom(room.id, 'alice');
  expect(started.status).toBe('blind');
  return started.id as string;
}

/** Directly patch a persisted quote's expiresAt into the past. */
function forceExpire(roomId: string, quoteId: string) {
  const row = db.prepare('SELECT game_state FROM rooms WHERE id = ?').get(roomId) as { game_state: string };
  const gs = JSON.parse(row.game_state);
  const quote = gs.quotes.find((q: { id: string }) => q.id === quoteId);
  quote.expiresAt = Date.now() - 1000;
  db.prepare('UPDATE rooms SET game_state = ? WHERE id = ?').run(JSON.stringify(gs), roomId);
}

describe('quote requests (service layer)', () => {
  it('requestQuote creates a pending quote', async () => {
    const roomId = await makeTradingRoom();
    const room = await roomService.requestQuote(roomId, 'alice', 'bob');
    expect(room.gameState?.quotes).toHaveLength(1);
    expect(room.gameState?.quotes?.[0]).toMatchObject({
      requesterId: 'alice',
      targetId: 'bob',
      status: 'pending',
    });
  });

  it('rejects requesting a quote from yourself', async () => {
    const roomId = await makeTradingRoom();
    await expect(roomService.requestQuote(roomId, 'alice', 'alice')).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a second active outbound request from the same player', async () => {
    const roomId = await makeTradingRoom();
    await roomService.requestQuote(roomId, 'alice', 'bob');
    await expect(roomService.requestQuote(roomId, 'alice', 'bob')).rejects.toMatchObject({ status: 400 });
  });

  it('respondToQuote rejects a response from someone other than the target', async () => {
    const roomId = await makeTradingRoom();
    const room = await roomService.requestQuote(roomId, 'alice', 'bob');
    const quoteId = room.gameState!.quotes![0].id;
    await expect(
      roomService.respondToQuote(roomId, 'alice', quoteId, 60, 62),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('respondToQuote rejects a spread that is not exactly 2 points', async () => {
    const roomId = await makeTradingRoom();
    const room = await roomService.requestQuote(roomId, 'alice', 'bob');
    const quoteId = room.gameState!.quotes![0].id;
    await expect(
      roomService.respondToQuote(roomId, 'bob', quoteId, 60, 63),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('respondToQuote rejects an expired quote', async () => {
    const roomId = await makeTradingRoom();
    const room = await roomService.requestQuote(roomId, 'alice', 'bob');
    const quoteId = room.gameState!.quotes![0].id;
    forceExpire(roomId, quoteId);
    await expect(
      roomService.respondToQuote(roomId, 'bob', quoteId, 60, 62),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('hit/lift: requester sells at the bid on hit, buys at the ask on lift', async () => {
    const roomId = await makeTradingRoom();
    const requested = await roomService.requestQuote(roomId, 'alice', 'bob');
    const quoteId = requested.gameState!.quotes![0].id;
    await roomService.respondToQuote(roomId, 'bob', quoteId, 60, 62);

    const hit = await roomService.hitQuote(roomId, 'alice', quoteId);
    const trade = hit.gameState!.matchedTrades.find((t) => t.sellOrderId === `quote_${quoteId}_sell`);
    expect(trade).toMatchObject({ price: 60, sellerId: 'alice', buyerId: 'bob', quantity: 1 });
    expect(hit.gameState!.quotes!.find((q) => q.id === quoteId)!.status).toBe('accepted');
  });

  it('rejects a second hit/lift on an already-accepted quote (double-click race)', async () => {
    const roomId = await makeTradingRoom();
    const requested = await roomService.requestQuote(roomId, 'alice', 'bob');
    const quoteId = requested.gameState!.quotes![0].id;
    await roomService.respondToQuote(roomId, 'bob', quoteId, 60, 62);
    await roomService.hitQuote(roomId, 'alice', quoteId);

    await expect(roomService.liftQuote(roomId, 'alice', quoteId)).rejects.toMatchObject({ status: 409 });
  });

  it('rejects hit/lift from anyone but the original requester', async () => {
    const roomId = await makeTradingRoom();
    const requested = await roomService.requestQuote(roomId, 'alice', 'bob');
    const quoteId = requested.gameState!.quotes![0].id;
    await roomService.respondToQuote(roomId, 'bob', quoteId, 60, 62);

    await expect(roomService.hitQuote(roomId, 'bob', quoteId)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects hit/lift when the requester cannot cover the margin', async () => {
    const roomId = await makeTradingRoom();
    // Drain alice's balance so even a 1-lot quote fill is unaffordable.
    db.prepare('UPDATE players SET balance = 0 WHERE id = ? AND room_id = ?').run('alice', roomId);

    const requested = await roomService.requestQuote(roomId, 'alice', 'bob');
    const quoteId = requested.gameState!.quotes![0].id;
    await roomService.respondToQuote(roomId, 'bob', quoteId, 60, 62);

    await expect(roomService.liftQuote(roomId, 'alice', quoteId)).rejects.toMatchObject({ status: 400 });
  });
});

describe('quote requests (HTTP routes + sanitize privacy)', () => {
  it('round-trips request -> respond -> hit through the real routes', async () => {
    const created = await request(app)
      .post('/api/room/create')
      .set('X-Dev-User-Id', 'http-alice')
      .send({ name: 'HTTP Quote Room', maxPlayers: 4 });
    const roomId: string = created.body.room.id;

    await request(app)
      .post(`/api/room/join/${roomId}`)
      .set('X-Dev-User-Id', 'http-bob')
      .send({});
    await request(app).post(`/api/room/${roomId}/start`).set('X-Dev-User-Id', 'http-alice').send({});

    const req = await request(app)
      .post(`/api/room/${roomId}/quote/request`)
      .set('X-Dev-User-Id', 'http-alice')
      .send({ targetId: 'http-bob' });
    expect(req.status).toBe(200);
    const quoteId: string = req.body.room.gameState.quotes[0].id;

    const responded = await request(app)
      .post(`/api/room/${roomId}/quote/${quoteId}/respond`)
      .set('X-Dev-User-Id', 'http-bob')
      .send({ bidPrice: 58, askPrice: 60 });
    expect(responded.status).toBe(200);

    const hit = await request(app)
      .post(`/api/room/${roomId}/quote/${quoteId}/hit`)
      .set('X-Dev-User-Id', 'http-alice')
      .send({});
    expect(hit.status).toBe(200);
    expect(hit.body.receipt).toBeTruthy();
    const quoteAfter = hit.body.room.gameState.quotes.find((q: { id: string }) => q.id === quoteId);
    expect(quoteAfter.status).toBe('accepted');
  });

  it('sanitizeRoomForPlayer never leaks bid/ask to a third player who is not party to the quote', async () => {
    const created = await request(app)
      .post('/api/room/create')
      .set('X-Dev-User-Id', 'p-alice')
      .send({ name: 'Privacy Room', maxPlayers: 4 });
    const roomId: string = created.body.room.id;

    await request(app).post(`/api/room/join/${roomId}`).set('X-Dev-User-Id', 'p-bob').send({});
    await request(app).post(`/api/room/join/${roomId}`).set('X-Dev-User-Id', 'p-carol').send({});
    await request(app).post(`/api/room/${roomId}/start`).set('X-Dev-User-Id', 'p-alice').send({});

    const req = await request(app)
      .post(`/api/room/${roomId}/quote/request`)
      .set('X-Dev-User-Id', 'p-alice')
      .send({ targetId: 'p-bob' });
    const quoteId: string = req.body.room.gameState.quotes[0].id;

    await request(app)
      .post(`/api/room/${roomId}/quote/${quoteId}/respond`)
      .set('X-Dev-User-Id', 'p-bob')
      .send({ bidPrice: 58, askPrice: 60 });

    // A view of the room as Carol -- neither requester nor target.
    const asCarol = await request(app).get(`/api/room/${roomId}`).set('X-Dev-User-Id', 'p-carol');
    const carolQuote = asCarol.body.gameState.quotes.find((q: { id: string }) => q.id === quoteId);
    expect(carolQuote).toBeTruthy();
    expect(carolQuote.bidPrice).toBeUndefined();
    expect(carolQuote.askPrice).toBeUndefined();

    // Alice (the requester) and Bob (the target) both see the real prices.
    const asAlice = await request(app).get(`/api/room/${roomId}`).set('X-Dev-User-Id', 'p-alice');
    const aliceQuote = asAlice.body.gameState.quotes.find((q: { id: string }) => q.id === quoteId);
    expect(aliceQuote.bidPrice).toBe(58);
    expect(aliceQuote.askPrice).toBe(60);
  });

  it('a bot target auto-responds with a two-way price within a couple seconds', async () => {
    const created = await request(app)
      .post('/api/room/create')
      .set('X-Dev-User-Id', 'bot-quote-alice')
      .send({ name: 'Bot Quote Room', maxPlayers: 4 });
    const roomId: string = created.body.room.id;

    const withBot = await request(app)
      .post(`/api/room/${roomId}/add-bot`)
      .set('X-Dev-User-Id', 'bot-quote-alice')
      .send({ character: 'WHALE' });
    const botId: string = withBot.body.room.players.find((p: { isBot?: boolean }) => p.isBot).id;

    await request(app).post(`/api/room/${roomId}/start`).set('X-Dev-User-Id', 'bot-quote-alice').send({});

    const req = await request(app)
      .post(`/api/room/${roomId}/quote/request`)
      .set('X-Dev-User-Id', 'bot-quote-alice')
      .send({ targetId: botId });
    const quoteId: string = req.body.room.gameState.quotes[0].id;

    // Bot response is scheduled 800-1500ms out; poll well past that.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const after = await request(app).get(`/api/room/${roomId}`).set('X-Dev-User-Id', 'bot-quote-alice');
    const quote = after.body.gameState.quotes.find((q: { id: string }) => q.id === quoteId);
    expect(quote.status).toBe('quoted');
    expect(quote.askPrice - quote.bidPrice).toBe(2);
  }, 10_000);
});
