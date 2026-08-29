/**
 * Pins the Add Bot route (#11).
 *
 * The web client used to POST `/api/room/:id/bot` while the server only served
 * `/:roomId/add-bot`, so the button 404'd and a solo host could never start a
 * game. This test drives the exact path the client now uses and asserts the
 * seated bot comes back in the room payload.
 *
 * Isolation: the env below MUST be set before `../server` is imported, because
 * the database module reads DB_PATH at first use and server.ts calls
 * `listen(PORT)` at import time. A tmp DB keeps the real api/data/game.db
 * untouched; PORT=0 asks the OS for any free port so nothing collides with a
 * running dev server on 3001 (or with other test files).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import type { Server } from 'http';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-game-addbot-'));
process.env.DB_PATH = path.join(tmpDir, 'game.db');
process.env.PORT = '0';
process.env.AUTH_DEV_BYPASS = 'true';
process.env.ELEVENLABS_API_KEY = 'test-key';

// The bot sandbox spins up worker threads; stub it out the same way api.test.ts does.
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

beforeAll(async () => {
  const mod = await import('../server');
  app = mod.app;
  server = mod.server;
});

afterAll(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('POST /api/room/:id/add-bot', () => {
  it('seats one bot in the host\'s room and returns 200', async () => {
    // Dev bypass: X-Dev-User-Id becomes req.user.id, so this user is the host.
    const host = 'host-user-11';

    const created = await request(app)
      .post('/api/room/create')
      .set('X-Dev-User-Id', host)
      .send({ name: 'Add Bot Room', maxPlayers: 4 });
    expect(created.status).toBe(201);
    const roomId: string = created.body.room.id;

    // This is the URL TablePage.tsx now calls (was `/bot`, which 404'd).
    const added = await request(app)
      .post(`/api/room/${roomId}/add-bot`)
      .set('X-Dev-User-Id', host)
      .send({ character: 'BULL' });

    expect(added.status).toBe(200);
    expect(added.body.success).toBe(true);

    const players: Array<{ id: string; isBot?: boolean }> = added.body.room.players;
    const bots = players.filter((p) => p.isBot);
    expect(bots).toHaveLength(1);
    // Host + exactly one bot.
    expect(players).toHaveLength(2);
  });

  it('still rejects the old client path so the regression cannot hide', async () => {
    const host = 'host-user-11b';
    const created = await request(app)
      .post('/api/room/create')
      .set('X-Dev-User-Id', host)
      .send({ name: 'Old Path Room', maxPlayers: 4 });
    const roomId: string = created.body.room.id;

    const wrong = await request(app)
      .post(`/api/room/${roomId}/bot`)
      .set('X-Dev-User-Id', host)
      .send({});
    expect(wrong.status).toBe(404);
  });
});
