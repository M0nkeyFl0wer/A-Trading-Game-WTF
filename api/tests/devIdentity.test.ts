/**
 * Dev-auth identity (issue #10).
 *
 * Verifies that under AUTH_DEV_BYPASS:
 *   1. `dev:<id>` bearer tokens give distinct HTTP identities, so two friends
 *      joining one room become two seated players with distinct names;
 *   2. X-Dev-User-Id / X-Dev-User-Name (the curl path) still work, and an
 *      unsafe name falls back to the default label;
 *   3. a socket connecting with `auth.token = 'dev:alice'` (no `userId`) is
 *      the SAME player that created the room over HTTP: `join-room` succeeds
 *      and `POST /start` delivers a `rooms:update` with phase `blind`.
 *
 * Hermetic: the DB is a temp file (api/tests/setup.ts) and the socket test
 * listens on port 0 (OS-assigned) on 127.0.0.1 only for its own duration.
 */
import type { Express } from 'express';
import type { Server } from 'http';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

process.env.AUTH_DEV_BYPASS = 'true';
process.env.ELEVENLABS_API_KEY = 'test-key';

// Same mocks as api.test.ts: no outbound HTTP, no worker-thread bot sandbox.
vi.mock('undici', () => ({
  fetch: vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode('test').buffer,
  })),
}));

vi.mock('@trading-game/bot', () => {
  class MockSandbox {
    async executeBot() {
      return { success: true, trade: { price: 100, size: 1 }, executionTime: 5, memoryUsed: 1024 };
    }
    getStats() { return { trades: 1 }; }
    killWorker() { return true; }
  }
  return { SecureBotSandbox: MockSandbox };
});

let app: Express;
let server: Server;
let start: (port?: number | string, host?: string) => Promise<Server>;

beforeAll(async () => {
  const mod = await import('../server');
  app = mod.app;
  server = mod.server;
  start = mod.start;
});

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const asUser = (token: string) => ({ Authorization: `Bearer ${token}` });

const createRoom = async (token: string, name = 'Dev Identity Room') => {
  const res = await request(app)
    .post('/api/room/create')
    .set(asUser(token))
    .send({ name, maxPlayers: 4 });
  expect(res.status).toBe(201);
  return res.body.room as { id: string; players: Array<{ id: string; name: string }> };
};

describe('resolveDevUser (unit)', () => {
  it('parses dev:<id> tokens and derives the default display name', async () => {
    const { resolveDevUser } = await import('../lib/devIdentity');
    const user = resolveDevUser({ token: 'dev:alice' });
    expect(user).toMatchObject({ id: 'alice', name: 'Dev Trader alic', role: 'developer' });
  });

  it('token wins over explicit id; explicit id wins over the env fallback', async () => {
    const { resolveDevUser } = await import('../lib/devIdentity');
    expect(resolveDevUser({ token: 'dev:alice', explicitId: 'bob' })?.id).toBe('alice');
    expect(resolveDevUser({ explicitId: 'bob' })?.id).toBe('bob');
    // Nothing supplied: shared fallback, never something socket-unique.
    expect(resolveDevUser({})?.id).toBe(process.env.AUTH_DEV_USER_ID || 'dev-user');
  });

  it('rejects malformed tokens/ids/names rather than trusting them', async () => {
    const { resolveDevUser } = await import('../lib/devIdentity');
    // A Firebase-looking JWT is not a dev token → fallback id.
    expect(resolveDevUser({ token: 'eyJhbGciOi.abc.def' })?.id).toBe('dev-user');
    expect(resolveDevUser({ token: 'dev:has space' })?.id).toBe('dev-user');
    expect(resolveDevUser({ explicitId: '../etc' })?.id).toBe('dev-user');
    // Unsafe name → default label, not the raw string.
    expect(resolveDevUser({ token: 'dev:alice', explicitName: '<script>' })?.name).toBe('Dev Trader alic');
    expect(resolveDevUser({ token: 'dev:alice', explicitName: 'x'.repeat(33) })?.name).toBe('Dev Trader alic');
    expect(resolveDevUser({ token: 'dev:alice', explicitName: 'Alice W' })?.name).toBe('Alice W');
  });
});

describe('HTTP dev identity', () => {
  it('dev:alice and dev:bob joining one room become two distinctly named players', async () => {
    const room = await createRoom('dev:alice');
    expect(room.players).toHaveLength(1);
    expect(room.players[0]).toMatchObject({ id: 'alice', name: 'Dev Trader alic' });

    const joined = await request(app)
      .post(`/api/room/join/${room.id}`)
      .set(asUser('dev:bob'))
      .send({});
    expect(joined.status).toBe(200);

    const players = joined.body.room.players as Array<{ id: string; name: string }>;
    expect(players).toHaveLength(2);
    expect(players.map((p) => p.id).sort()).toEqual(['alice', 'bob']);
    const names = new Set(players.map((p) => p.name));
    expect(names.size).toBe(2);
    expect(names.has('Dev Trader alic')).toBe(true);
    expect(names.has('Dev Trader bob')).toBe(true);
  });

  it('keeps the curl path: X-Dev-User-Id + X-Dev-User-Name without a bearer token', async () => {
    const res = await request(app)
      .post('/api/room/create')
      .set('X-Dev-User-Id', 'carol')
      .set('X-Dev-User-Name', 'Carol C')
      .send({ name: 'Curl Room', maxPlayers: 2 });
    expect(res.status).toBe(201);
    expect(res.body.room.players[0]).toMatchObject({ id: 'carol', name: 'Carol C' });
  });

  it('does not seat the host under the room name (body.name is the ROOM name)', async () => {
    const room = await createRoom('dev:dave', 'Not A Player Name');
    expect(room.players[0].name).toBe('Dev Trader dave');
  });
});

describe('socket dev identity', () => {
  let client: ClientSocket | null = null;

  afterAll(() => {
    client?.disconnect();
  });

  it("'dev:alice' handshake token resolves to the same player that created the room", async () => {
    // Bind on an OS-assigned loopback port for this test only.
    const listening = await start(0, '127.0.0.1');
    const port = (listening.address() as { port: number }).port;

    // Room created over HTTP by alice; bob joins so Start has 2 players.
    const room = await createRoom('dev:alice', 'Socket Room');
    const joined = await request(app)
      .post(`/api/room/join/${room.id}`)
      .set(asUser('dev:bob'))
      .send({});
    expect(joined.status).toBe(200);

    // Connect as alice with ONLY auth.token — no userId — exactly as the web
    // client does. Before #10 this socket would have been `dev-<socket.id>`.
    client = ioClient(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      auth: { token: 'dev:alice' },
    });

    const update = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no rooms:update within 2s')), 2000);
      client!.on('error', (err: any) => {
        clearTimeout(timer);
        reject(new Error(`socket error: ${err?.message ?? String(err)}`));
      });
      client!.on('rooms:update', (payload: any) => {
        if (payload?.id === room.id && payload?.status === 'blind') {
          clearTimeout(timer);
          resolve(payload);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      client!.once('connect', () => resolve());
      client!.once('connect_error', (err) => reject(err));
    });
    client.emit('join-room', room.id);

    // Give the server a tick to process join-room before starting the round.
    await new Promise((r) => setTimeout(r, 50));
    const started = await request(app)
      .post(`/api/room/${room.id}/start`)
      .set(asUser('dev:alice'));
    expect(started.status).toBe(200);

    const payload = await update;
    expect(payload.status).toBe('blind');
    expect(payload.gameState?.phase).toBe('blind');
    expect(payload.players.map((p: any) => p.id).sort()).toEqual(['alice', 'bob']);
  });
});
