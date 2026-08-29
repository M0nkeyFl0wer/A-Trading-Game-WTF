/**
 * Bot-only rooms must never keep playing (#14).
 *
 * Before this fix a bot inherited host when the last human left, and
 * `scheduleNextRound` only checked `players.length >= 2`, so the table kept
 * dealing every few seconds forever (and `restoreActiveRounds` re-armed it on
 * every server restart). These tests exercise the room service directly
 * against a throwaway SQLite file:
 *
 *   1. last human leaving a room that still has bots deletes the room;
 *   2. scheduleNextRound on a bot-only room retires it instead of re-arming;
 *   3. restoreActiveRounds retires bot-only rooms and keeps human ones;
 *   4. the delay constant is shared with the client.
 *
 * DB_PATH is set before the service module is imported (the database module
 * reads it lazily on first `getDatabase()`), so the real api/data/game.db is
 * never touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NEXT_ROUND_DELAY_MS } from '@trading-game/shared';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-game-botonly-'));
process.env.DB_PATH = path.join(tmpDir, 'game.db');

type RoomServiceModule = typeof import('../services/roomService');
type DatabaseModule = typeof import('../services/database');
type RoomEventsModule = typeof import('../lib/roomEvents');

let roomService: RoomServiceModule['roomService'];
let RoomServiceError: RoomServiceModule['RoomServiceError'];
let db: ReturnType<DatabaseModule['getDatabase']>;
let closeDatabase: DatabaseModule['closeDatabase'];
let roomEvents: RoomEventsModule['roomEvents'];

beforeAll(async () => {
  const svc = await import('../services/roomService');
  const dbMod = await import('../services/database');
  const events = await import('../lib/roomEvents');
  roomService = svc.roomService;
  RoomServiceError = svc.RoomServiceError;
  db = dbMod.getDatabase();
  closeDatabase = dbMod.closeDatabase;
  roomEvents = events.roomEvents;
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** getRoom throws a 404 RoomServiceError once a room is deleted. */
const expectRoomGone = async (roomId: string) => {
  await expect(roomService.getRoom(roomId)).rejects.toMatchObject({ status: 404 });
};

describe('bot-only rooms are torn down (#14)', () => {
  it('deletes the room (bots included) when the last human leaves mid-round', async () => {
    const removed: string[] = [];
    const onRemoved = (payload: { id: string }) => removed.push(payload.id);
    roomEvents.on('room:removed', onRemoved);

    const room = await roomService.createRoom('Leave Test', 4, 'human-a', 'Alice');
    await roomService.joinRoom(room.id, { id: 'human-b', name: 'Bob' });
    await roomService.addBot(room.id, 'human-a', 'BULL');

    // Start dealing so the phase timer is armed -- leaving must clear it.
    const started = await roomService.startRoom(room.id, 'human-a');
    expect(started.status).toBe('blind');

    // First human leaves: room survives, Bob becomes host, bot still seated.
    const afterFirst = await roomService.leaveRoom(room.id, 'human-a');
    expect(afterFirst.hostId).toBe('human-b');
    expect(afterFirst.players.some((p) => p.isBot)).toBe(true);

    // Last human leaves: the bot would have inherited host -- instead the room is gone.
    const afterLast = await roomService.leaveRoom(room.id, 'human-b');
    expect(afterLast.players).toHaveLength(0);
    await expectRoomGone(room.id);

    // No orphaned player rows either.
    const rows = db.prepare('SELECT COUNT(*) AS n FROM players WHERE room_id = ?').get(room.id) as { n: number };
    expect(rows.n).toBe(0);

    // Lobby was told to drop it.
    expect(removed).toContain(room.id);
    roomEvents.off('room:removed', onRemoved);

    // The phase-transition timer was cleared (no dangling timers for this room).
    const timers = (roomService as any).timers as Map<string, unknown>;
    expect(timers.has(room.id)).toBe(false);
  });

  it('scheduleNextRound retires a bot-only room instead of re-arming it', async () => {
    const room = await roomService.createRoom('Bots Only', 4, 'human-c', 'Cara');
    await roomService.addBot(room.id, 'human-c', 'BEAR');
    await roomService.addBot(room.id, 'human-c', 'WHALE');

    // Simulate the pre-fix state a bot-only "finished" room ended up in:
    // three seated players, none human. (Reachable before the fix via the
    // host-inheritance path; unreachable through the public API now.)
    db.prepare('UPDATE players SET is_bot = 1 WHERE room_id = ?').run(room.id);
    db.prepare("UPDATE rooms SET status = 'finished' WHERE id = ?").run(room.id);

    const finished = await roomService.getRoom(room.id);
    expect(finished.players.length).toBeGreaterThanOrEqual(2); // old check would have passed
    expect(finished.players.every((p) => p.isBot)).toBe(true);

    (roomService as any).scheduleNextRound(room.id, finished);

    await expectRoomGone(room.id);
    const timers = (roomService as any).timers as Map<string, unknown>;
    expect(timers.has(room.id)).toBe(false);
  });

  it('restoreActiveRounds retires bot-only rooms and leaves human rooms alone', async () => {
    // Bot-only room stuck in an active phase (the "re-armed on restart" case).
    const botRoom = await roomService.createRoom('Restart Bots', 4, 'human-d', 'Dana');
    await roomService.addBot(botRoom.id, 'human-d', 'ROOKIE');
    db.prepare('UPDATE players SET is_bot = 1 WHERE room_id = ?').run(botRoom.id);
    db.prepare("UPDATE rooms SET status = 'blind' WHERE id = ?").run(botRoom.id);

    // Bot-only room in 'finished' long enough that auto-start would trigger.
    const botFinished = await roomService.createRoom('Restart Bots Finished', 4, 'human-e', 'Eve');
    await roomService.addBot(botFinished.id, 'human-e', 'BULL');
    db.prepare('UPDATE players SET is_bot = 1 WHERE room_id = ?').run(botFinished.id);
    db.prepare("UPDATE rooms SET status = 'finished', game_state = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify({ updatedAt: Date.now() - NEXT_ROUND_DELAY_MS * 2 }), Date.now() - NEXT_ROUND_DELAY_MS * 2, botFinished.id);

    // Human-only waiting room: must survive recovery untouched.
    const humanRoom = await roomService.createRoom('Restart Human', 4, 'human-f', 'Finn');

    // The constructor ran recovery once already; re-run it against the rows above.
    (roomService as any).recovered = false;
    (roomService as any).restoreActiveRounds();

    await expectRoomGone(botRoom.id);
    await expectRoomGone(botFinished.id);
    const survivor = await roomService.getRoom(humanRoom.id);
    expect(survivor.status).toBe('waiting');
  });

  it('uses the shared next-round delay so the client countdown matches the server', () => {
    // Settlement overlay must stay up >= 15 s (issue acceptance).
    expect(NEXT_ROUND_DELAY_MS).toBeGreaterThanOrEqual(15_000);
  });

  it('RoomServiceError carries the status used by expectRoomGone', () => {
    // Guards the helper above against a future change to the error shape.
    expect(new RoomServiceError(404, 'x')).toMatchObject({ status: 404 });
  });
});
