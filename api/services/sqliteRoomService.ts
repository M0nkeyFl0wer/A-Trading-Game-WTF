import { randomInt, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDatabase } from './database';
import { emitRoomUpdated, emitRoomRemoved } from '../lib/roomEvents';
import { PHASE_SEQUENCE } from '@trading-game/shared';
import { gameEngine, type RoomGameState } from './gameEngine';
import type { RoomRecord, RoomPlayer, RoomStatus } from './roomService';
import { RoomServiceError } from './roomService';
import { logger } from '../lib/logger';
import { createSignedReceipt } from '../lib/signing';

const createRoomId = () => `room_${randomUUID().slice(0, 8).toUpperCase()}`;

const DEFAULT_BALANCE = 1_000;
const CHARACTER_SEQUENCE = ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'];
const BOT_CHARACTERS = ['BULL', 'BEAR', 'WHALE', 'ROOKIE'] as const;
const BOT_NAMES: Record<string, string> = {
  BULL: 'Bull Runner',
  BEAR: 'Bear Necessities',
  WHALE: 'The Whale',
  ROOKIE: 'Fresh Trader',
};
const NEXT_ROUND_DELAY_MS = 5_000;

type RoomTimers = {
  phaseTransition?: NodeJS.Timeout;
  nextRound?: NodeJS.Timeout;
};

const createPlayer = (id: string, name: string, index: number): RoomPlayer => ({
  id,
  name,
  joinedAt: Date.now(),
  balance: DEFAULT_BALANCE,
  character: CHARACTER_SEQUENCE[index % CHARACTER_SEQUENCE.length],
});

// ---------------------------------------------------------------------------
// Row types matching SQLite schema
// ---------------------------------------------------------------------------

interface RoomRow {
  id: string;
  name: string;
  host_id: string;
  host_name: string;
  max_players: number;
  status: string;
  round_number: number;
  round_ends_at: number | null;
  game_state: string | null;
  pending_trades: string | null;
  created_at: number;
  updated_at: number;
}

interface PlayerRow {
  id: string;
  room_id: string;
  display_name: string;
  character: string;
  balance: number;
  is_host: number;
  is_bot: number;
  is_winner: number;
  joined_at: number;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function rowToRoomRecord(row: RoomRow, playerRows: PlayerRow[]): RoomRecord {
  const players: RoomPlayer[] = playerRows.map((p) => ({
    id: p.id,
    name: p.display_name,
    joinedAt: p.joined_at,
    balance: p.balance,
    character: p.character,
    isBot: p.is_bot === 1 ? true : undefined,
    isWinner: p.is_winner === 1 ? true : undefined,
  }));

  return {
    id: row.id,
    name: row.name,
    hostId: row.host_id,
    hostName: row.host_name,
    maxPlayers: row.max_players,
    status: row.status as RoomStatus,
    players,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    roundNumber: row.round_number,
    gameState: row.game_state ? JSON.parse(row.game_state) : undefined,
  };
}

// ---------------------------------------------------------------------------
// SqliteRoomService
// ---------------------------------------------------------------------------

export class SqliteRoomService {
  private db: Database.Database;
  private timers = new Map<string, RoomTimers>();

  // Prepared statements (lazily cached)
  private stmts!: ReturnType<SqliteRoomService['prepareStatements']>;

  constructor() {
    this.db = getDatabase();
    this.stmts = this.prepareStatements();
    this.restoreActiveRounds();
  }

  private prepareStatements() {
    const db = this.db;
    return {
      insertRoom: db.prepare(`
        INSERT INTO rooms (id, name, host_id, host_name, max_players, status, round_number, round_ends_at, game_state, pending_trades, created_at, updated_at)
        VALUES (@id, @name, @host_id, @host_name, @max_players, @status, @round_number, @round_ends_at, @game_state, @pending_trades, @created_at, @updated_at)
      `),
      updateRoom: db.prepare(`
        UPDATE rooms SET
          name = @name,
          host_id = @host_id,
          host_name = @host_name,
          max_players = @max_players,
          status = @status,
          round_number = @round_number,
          round_ends_at = @round_ends_at,
          game_state = @game_state,
          pending_trades = @pending_trades,
          updated_at = @updated_at
        WHERE id = @id
      `),
      getRoom: db.prepare('SELECT * FROM rooms WHERE id = ?'),
      listRooms: db.prepare('SELECT * FROM rooms ORDER BY updated_at DESC LIMIT 50'),
      deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),
      getActivePhaseRooms: db.prepare(
        "SELECT * FROM rooms WHERE status IN ('blind', 'flop', 'turn')",
      ),

      insertPlayer: db.prepare(`
        INSERT INTO players (id, room_id, display_name, character, balance, is_host, is_bot, is_winner, joined_at)
        VALUES (@id, @room_id, @display_name, @character, @balance, @is_host, @is_bot, @is_winner, @joined_at)
      `),
      updatePlayer: db.prepare(`
        UPDATE players SET
          display_name = @display_name,
          character = @character,
          balance = @balance,
          is_host = @is_host,
          is_bot = @is_bot,
          is_winner = @is_winner
        WHERE id = @id AND room_id = @room_id
      `),
      getPlayers: db.prepare('SELECT * FROM players WHERE room_id = ? ORDER BY joined_at ASC'),
      deletePlayer: db.prepare('DELETE FROM players WHERE id = ? AND room_id = ?'),
      deleteRoomPlayers: db.prepare('DELETE FROM players WHERE room_id = ?'),

      insertRound: db.prepare(`
        INSERT INTO rounds (room_id, round_number, phase, community_cards, started_at)
        VALUES (@room_id, @round_number, @phase, @community_cards, @started_at)
      `),
      updateRound: db.prepare(`
        UPDATE rounds SET phase = @phase, community_cards = @community_cards, ended_at = @ended_at
        WHERE id = @id
      `),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private loadRoom(roomId: string): RoomRecord {
    const row = this.stmts.getRoom.get(roomId) as RoomRow | undefined;
    if (!row) {
      throw new RoomServiceError(404, 'Room not found');
    }
    const players = this.stmts.getPlayers.all(roomId) as PlayerRow[];
    return rowToRoomRecord(row, players);
  }

  private saveRoom(room: RoomRecord): void {
    const params = {
      id: room.id,
      name: room.name,
      host_id: room.hostId,
      host_name: room.hostName,
      max_players: room.maxPlayers,
      status: room.status,
      round_number: room.roundNumber,
      round_ends_at: room.gameState?.phaseEndsAt ?? null,
      game_state: room.gameState ? JSON.stringify(room.gameState) : null,
      pending_trades: null,
      updated_at: room.updatedAt,
    };
    this.stmts.updateRoom.run(params);
  }

  private savePlayers(roomId: string, players: RoomPlayer[], hostId: string): void {
    // Delete existing and re-insert (simple and correct for small player counts)
    this.stmts.deleteRoomPlayers.run(roomId);
    for (const p of players) {
      this.stmts.insertPlayer.run({
        id: p.id,
        room_id: roomId,
        display_name: p.name,
        character: p.character,
        balance: p.balance,
        is_host: p.id === hostId ? 1 : 0,
        is_bot: p.isBot ? 1 : 0,
        is_winner: p.isWinner ? 1 : 0,
        joined_at: p.joinedAt,
      });
    }
  }

  private persistRoom(room: RoomRecord): void {
    this.saveRoom(room);
    this.savePlayers(room.id, room.players, room.hostId);
  }

  // ---------------------------------------------------------------------------
  // Public API (matches RoomService interface)
  // ---------------------------------------------------------------------------

  async listRooms(): Promise<RoomRecord[]> {
    const rows = this.stmts.listRooms.all() as RoomRow[];
    return rows.map((row) => {
      const players = this.stmts.getPlayers.all(row.id) as PlayerRow[];
      return rowToRoomRecord(row, players);
    });
  }

  async getRoom(roomId: string): Promise<RoomRecord> {
    return this.loadRoom(roomId);
  }

  async createRoom(name: string, maxPlayers: number, hostId: string, hostName: string): Promise<RoomRecord> {
    const hostPlayer: RoomPlayer = { ...createPlayer(hostId, hostName, 0), character: 'DEALER' };
    const now = Date.now();
    const room: RoomRecord = {
      id: createRoomId(),
      name,
      maxPlayers,
      hostId,
      hostName,
      status: 'waiting',
      players: [hostPlayer],
      createdAt: now,
      updatedAt: now,
      roundNumber: 0,
    };

    const insertAll = this.db.transaction(() => {
      this.stmts.insertRoom.run({
        id: room.id,
        name: room.name,
        host_id: room.hostId,
        host_name: room.hostName,
        max_players: room.maxPlayers,
        status: room.status,
        round_number: room.roundNumber,
        round_ends_at: null,
        game_state: null,
        pending_trades: null,
        created_at: room.createdAt,
        updated_at: room.updatedAt,
      });
      this.savePlayers(room.id, room.players, room.hostId);
    });
    insertAll();

    emitRoomUpdated(room);
    return room;
  }

  async joinRoom(roomId: string, player: { id: string; name: string }): Promise<RoomRecord> {
    const updated = this.db.transaction(() => {
      const room = this.loadRoom(roomId);

      if (room.players.find((p) => p.id === player.id)) {
        return room;
      }
      if (room.players.length >= room.maxPlayers) {
        throw new RoomServiceError(400, 'Room is full');
      }

      const newPlayer = createPlayer(player.id, player.name, room.players.length);
      const updatedRoom: RoomRecord = {
        ...room,
        players: [...room.players, newPlayer],
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    emitRoomUpdated(updated);
    return updated;
  }

  async addBot(roomId: string, requesterId: string, character?: string): Promise<RoomRecord> {
    const validCharacter = character && BOT_CHARACTERS.includes(character as any)
      ? character
      : BOT_CHARACTERS[randomInt(0, BOT_CHARACTERS.length)];

    const botId = `bot_${validCharacter.toLowerCase()}_${randomUUID().slice(0, 12)}`;
    const botName = BOT_NAMES[validCharacter] || 'Bot Trader';

    const updated = this.db.transaction(() => {
      const room = this.loadRoom(roomId);

      if (room.hostId !== requesterId) {
        throw new RoomServiceError(403, 'Only the host can add bots');
      }
      if (room.status !== 'waiting' && room.status !== 'finished') {
        throw new RoomServiceError(400, 'Can only add bots while waiting or between rounds');
      }
      if (room.players.length >= room.maxPlayers) {
        throw new RoomServiceError(400, 'Room is full');
      }

      const botPlayer: RoomPlayer = {
        id: botId,
        name: botName,
        joinedAt: Date.now(),
        balance: DEFAULT_BALANCE,
        character: validCharacter,
        isBot: true,
      };

      const updatedRoom: RoomRecord = {
        ...room,
        players: [...room.players, botPlayer],
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    emitRoomUpdated(updated);
    return updated;
  }

  async leaveRoom(roomId: string, playerId: string): Promise<RoomRecord> {
    const updated = this.db.transaction(() => {
      const room = this.loadRoom(roomId);
      const remainingPlayers = room.players.filter((p) => p.id !== playerId);
      if (remainingPlayers.length === room.players.length) {
        throw new RoomServiceError(400, 'Player not found in room');
      }

      if (remainingPlayers.length === 0) {
        this.stmts.deleteRoomPlayers.run(roomId);
        this.stmts.deleteRoom.run(roomId);
        return { ...room, players: [], status: 'waiting' as RoomStatus, updatedAt: Date.now() };
      }

      let hostId = room.hostId;
      let hostName = room.hostName;
      if (hostId === playerId) {
        const newHost = remainingPlayers[0];
        hostId = newHost.id;
        hostName = newHost.name;
      }

      const updatedRoom: RoomRecord = {
        ...room,
        hostId,
        hostName,
        players: remainingPlayers,
        status: room.status,
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    emitRoomUpdated(updated);
    if (updated.players.length === 0) {
      emitRoomRemoved({ id: updated.id });
      this.clearTimers(roomId);
    }
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Order book operations
  // ---------------------------------------------------------------------------

  async submitOrder(
    roomId: string,
    playerId: string,
    order: { price: number; quantity: number; side: 'bid' | 'ask' },
  ): Promise<RoomRecord> {
    const updated = this.db.transaction(() => {
      const room = this.loadRoom(roomId);
      const phase = room.status;
      if (phase !== 'blind' && phase !== 'flop' && phase !== 'turn') {
        throw new RoomServiceError(400, 'Round is not accepting orders');
      }

      const player = room.players.find((p) => p.id === playerId);
      if (!player) {
        throw new RoomServiceError(404, 'Player not found in room');
      }

      // Margin enforcement: ensure player can cover worst-case loss
      // For a BID at price P, qty Q: max loss = P * Q (settlement = 0)
      // For an ASK at price P, qty Q: max loss = (MAX_SETTLEMENT - P) * Q (settlement = max)
      const MAX_SETTLEMENT = 130; // theoretical max: entire deck sum

      const maxLoss = order.side === 'bid'
        ? order.price * order.quantity
        : (MAX_SETTLEMENT - order.price) * order.quantity;

      const existingOrders = (room.gameState?.orders ?? []).filter(
        (o) => o.playerId === playerId && (o.status === 'open' || o.status === 'partial'),
      );
      const lockedMargin = existingOrders.reduce((sum, o) => {
        const remaining = o.quantity - o.filledQuantity;
        if (o.side === 'bid') {
          return sum + o.price * remaining;
        } else {
          return sum + (MAX_SETTLEMENT - o.price) * remaining;
        }
      }, 0);

      const availableBalance = player.balance - lockedMargin;
      if (maxLoss > availableBalance) {
        throw new RoomServiceError(400,
          `Insufficient margin. Required: $${maxLoss.toFixed(2)}, Available: $${availableBalance.toFixed(2)}`,
        );
      }

      // Anti-spoofing: max 5 open orders per player
      if (room.gameState) {
        const openCount = room.gameState.orders.filter(
          (o) => o.playerId === playerId && (o.status === 'open' || o.status === 'partial'),
        ).length;
        if (openCount >= 5) {
          throw new RoomServiceError(400, 'Maximum 5 open orders per player');
        }
      }

      const { gameState } = gameEngine.submitOrder(room, playerId, player.name, order);
      const updatedRoom: RoomRecord = {
        ...room,
        gameState,
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    emitRoomUpdated(updated);
    return updated;
  }

  async cancelOrder(
    roomId: string,
    playerId: string,
    orderId: string,
  ): Promise<RoomRecord> {
    const updated = this.db.transaction(() => {
      const room = this.loadRoom(roomId);
      const phase = room.status;
      if (phase !== 'blind' && phase !== 'flop' && phase !== 'turn') {
        throw new RoomServiceError(400, 'Round is not accepting order changes');
      }
      if (!room.gameState) {
        throw new RoomServiceError(400, 'No active game state');
      }

      // Verify the order belongs to this player
      const orderToCancel = room.gameState.orders.find((o) => o.id === orderId);
      if (!orderToCancel) {
        throw new RoomServiceError(404, 'Order not found');
      }
      if (orderToCancel.playerId !== playerId) {
        throw new RoomServiceError(403, "Cannot cancel another player's order");
      }

      // Anti-spoofing: minimum 2-second resting time before cancel
      if (Date.now() - orderToCancel.timestamp < 2000) {
        throw new RoomServiceError(400, 'Orders must rest at least 2 seconds before cancellation');
      }

      const gameState = gameEngine.cancelOrder(room, orderId);
      const updatedRoom: RoomRecord = {
        ...room,
        gameState,
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    emitRoomUpdated(updated);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Game lifecycle
  // ---------------------------------------------------------------------------

  async startRoom(roomId: string, requesterId: string): Promise<RoomRecord> {
    const prepared = this.db.transaction(() => {
      const room = this.loadRoom(roomId);
      if (room.hostId !== requesterId) {
        throw new RoomServiceError(403, 'Only the host can start the game');
      }
      if (room.players.length < 2) {
        throw new RoomServiceError(400, 'At least two players required to start');
      }

      return this.prepareRound(room);
    })();

    emitRoomUpdated(prepared);
    this.schedulePhaseTransition(prepared.id, 0);
    return prepared;
  }

  // ---------------------------------------------------------------------------
  // Round preparation
  // ---------------------------------------------------------------------------

  /**
   * Deal cards and enter the 'blind' phase.
   */
  private prepareRound(room: RoomRecord): RoomRecord {
    const roundNumber = room.roundNumber + 1;
    const roomForDeal: RoomRecord = { ...room, roundNumber };
    const gameState = gameEngine.dealRound(roomForDeal);

    const prepared: RoomRecord = {
      ...room,
      status: 'blind',
      roundNumber,
      gameState,
      updatedAt: Date.now(),
    };

    this.persistRoom(prepared);

    // Record the round for history
    this.stmts.insertRound.run({
      room_id: room.id,
      round_number: roundNumber,
      phase: 'blind',
      community_cards: JSON.stringify(gameState.communityCards),
      started_at: Date.now(),
    });

    return prepared;
  }

  // ---------------------------------------------------------------------------
  // 3-phase timer chain
  // ---------------------------------------------------------------------------

  /**
   * Schedule a transition out of the current phase.
   *
   * Phase chain:
   *   blind (30s) -> flop (20s) -> turn (20s) -> settle -> next round (5s)
   */
  private schedulePhaseTransition(roomId: string, phaseIndex: number): void {
    const timers = this.getTimers(roomId);
    if (timers.phaseTransition) clearTimeout(timers.phaseTransition);

    const config = PHASE_SEQUENCE[phaseIndex];
    if (!config) return;

    // Calculate remaining time from phaseEndsAt if available, fall back to full duration
    let delay = config.durationMs;
    try {
      const room = this.loadRoom(roomId);
      if (room.gameState?.phaseEndsAt) {
        delay = Math.max(1_000, room.gameState.phaseEndsAt - Date.now());
      }
    } catch {
      // Room may not exist yet, use full duration
    }

    timers.phaseTransition = setTimeout(() => {
      this.handlePhaseEnd(roomId, phaseIndex).catch((err) =>
        logger.error({ err, roomId }, 'phase transition failed'),
      );
    }, delay);
  }

  private async handlePhaseEnd(roomId: string, phaseIndex: number): Promise<void> {
    const timers = this.getTimers(roomId);
    if (timers.phaseTransition) {
      clearTimeout(timers.phaseTransition);
      timers.phaseTransition = undefined;
    }

    const nextIndex = phaseIndex + 1;

    if (nextIndex >= PHASE_SEQUENCE.length) {
      // All trading phases done -- settle
      await this.settleRound(roomId);
      return;
    }

    // Advance to next phase
    const advanced = this.db.transaction(() => {
      let room: RoomRecord;
      try {
        room = this.loadRoom(roomId);
      } catch {
        return null;
      }

      const newState = gameEngine.advancePhase(room);
      if (!newState) {
        // Past last phase -- will settle outside transaction
        return null;
      }

      const updated: RoomRecord = {
        ...room,
        status: newState.phase as RoomStatus,
        gameState: newState,
        updatedAt: Date.now(),
      };

      this.persistRoom(updated);
      return updated;
    })();

    if (advanced) {
      emitRoomUpdated(advanced);
      this.schedulePhaseTransition(roomId, nextIndex);
    } else {
      // advancePhase returned null -- settle
      await this.settleRound(roomId);
    }
  }

  // ---------------------------------------------------------------------------
  // Settlement
  // ---------------------------------------------------------------------------

  private async settleRound(roomId: string): Promise<void> {
    const finalized = this.db.transaction(() => {
      let room: RoomRecord;
      try {
        room = this.loadRoom(roomId);
      } catch {
        return null;
      }

      const gameResult = gameEngine.settleRound(room);

      // Attach Ed25519-signed settlement receipt for non-repudiation
      const settlementReceipt = createSignedReceipt({
        type: 'settlement',
        roomId,
        roundNumber: gameResult.roundNumber,
        settlementTotal: gameResult.gameState.settlementTotal,
        pnl: gameResult.gameState.pnl,
        tradeCount: gameResult.gameState.matchedTrades.length,
      });
      gameResult.gameState.settlementReceipt = settlementReceipt;

      const updatedRoom: RoomRecord = {
        ...room,
        status: 'finished',
        players: gameResult.players,
        gameState: gameResult.gameState,
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    if (finalized) {
      emitRoomUpdated(finalized);
      this.scheduleNextRound(roomId, finalized);
    }
  }

  // ---------------------------------------------------------------------------
  // Next round automation
  // ---------------------------------------------------------------------------

  private scheduleNextRound(roomId: string, room: RoomRecord): void {
    if (room.players.length < 2) return;

    const timers = this.getTimers(roomId);
    if (timers.nextRound) clearTimeout(timers.nextRound);

    timers.nextRound = setTimeout(() => {
      this.beginAutomatedRound(roomId).catch((error) => {
        logger.error({ err: error, roomId }, 'failed to start next round');
      });
    }, NEXT_ROUND_DELAY_MS);
  }

  private async beginAutomatedRound(roomId: string): Promise<RoomRecord | null> {
    const timers = this.getTimers(roomId);
    if (timers.nextRound) {
      clearTimeout(timers.nextRound);
      timers.nextRound = undefined;
    }

    const prepared = this.db.transaction(() => {
      let room: RoomRecord;
      try {
        room = this.loadRoom(roomId);
      } catch {
        return null;
      }
      if (room.players.length < 2) return room;

      return this.prepareRound(room);
    })();

    if (prepared && prepared.gameState) {
      emitRoomUpdated(prepared);
      this.schedulePhaseTransition(prepared.id, 0);
    }
    return prepared;
  }

  // ---------------------------------------------------------------------------
  // Timer helpers
  // ---------------------------------------------------------------------------

  private getTimers(roomId: string): RoomTimers {
    let timers = this.timers.get(roomId);
    if (!timers) {
      timers = {};
      this.timers.set(roomId, timers);
    }
    return timers;
  }

  private clearTimers(roomId: string): void {
    const timers = this.timers.get(roomId);
    if (!timers) return;
    if (timers.phaseTransition) clearTimeout(timers.phaseTransition);
    if (timers.nextRound) clearTimeout(timers.nextRound);
    this.timers.delete(roomId);
  }

  /**
   * On startup, restore timers for rooms in active trading phases.
   * Cascades through multiple missed phases if the server was down long enough,
   * and auto-starts next rounds for rooms stuck in 'finished' state.
   */
  private recovered = false;

  private restoreActiveRounds(): void {
    if (this.recovered) return;
    this.recovered = true;

    const now = Date.now();
    let settled = 0;
    let advanced = 0;
    let resumed = 0;
    let autoStarted = 0;

    // -----------------------------------------------------------------------
    // 1. Recover rooms in active trading phases (blind, flop, turn)
    // -----------------------------------------------------------------------
    const activeRows = this.stmts.getActivePhaseRooms.all() as RoomRow[];

    for (const row of activeRows) {
      const gs: RoomGameState | null = row.game_state ? JSON.parse(row.game_state) : null;
      if (!gs?.phaseEndsAt) continue;

      const currentPhaseIndex = PHASE_SEQUENCE.findIndex((p) => p.phase === gs.phase);
      if (currentPhaseIndex < 0) continue;

      if (gs.phaseEndsAt > now) {
        // Phase still active -- just resume the timer
        this.schedulePhaseTransition(row.id, currentPhaseIndex);
        resumed++;
        continue;
      }

      // Phase expired. Calculate how many phases we missed.
      let elapsed = now - gs.phaseEndsAt;
      let nextIndex = currentPhaseIndex + 1;

      // Skip through any fully-elapsed subsequent phases
      while (nextIndex < PHASE_SEQUENCE.length && elapsed > PHASE_SEQUENCE[nextIndex].durationMs) {
        elapsed -= PHASE_SEQUENCE[nextIndex].durationMs;
        nextIndex++;
      }

      if (nextIndex >= PHASE_SEQUENCE.length) {
        // All trading phases elapsed -- settle immediately
        logger.info(
          { roomId: row.id, missedPhases: nextIndex - currentPhaseIndex },
          'settling room after server restart',
        );
        this.settleRound(row.id).catch((err) =>
          logger.error({ err, roomId: row.id }, 'failed to settle room on recovery'),
        );
        settled++;
      } else {
        // Advance to the correct phase and resume
        logger.info(
          { roomId: row.id, from: gs.phase, to: PHASE_SEQUENCE[nextIndex].phase },
          'advancing room after server restart',
        );
        this.advanceThroughMissedPhases(row.id, currentPhaseIndex, nextIndex).catch((err) =>
          logger.error({ err, roomId: row.id }, 'failed to recover room phases'),
        );
        advanced++;
      }
    }

    // -----------------------------------------------------------------------
    // 2. Recover rooms stuck in 'finished' that should auto-start next round
    // -----------------------------------------------------------------------
    const finishedRows = this.db
      .prepare("SELECT * FROM rooms WHERE status = 'finished'")
      .all() as RoomRow[];

    for (const row of finishedRows) {
      const gs: RoomGameState | null = row.game_state ? JSON.parse(row.game_state) : null;
      if (!gs) continue;

      // Use updatedAt from game state or row to determine how long it's been finished
      const finishedAt = gs.updatedAt ?? row.updated_at;
      const timeSinceFinish = now - finishedAt;

      if (timeSinceFinish > NEXT_ROUND_DELAY_MS) {
        // Check if room has enough players
        const players = this.stmts.getPlayers.all(row.id) as PlayerRow[];
        if (players.length >= 2) {
          logger.info({ roomId: row.id }, 'auto-starting next round after server restart');
          this.beginAutomatedRound(row.id).catch((err) =>
            logger.error({ err, roomId: row.id }, 'failed to auto-start round on recovery'),
          );
          autoStarted++;
        }
      }
    }

    // -----------------------------------------------------------------------
    // 3. Log recovery summary
    // -----------------------------------------------------------------------
    logger.info(
      {
        activeRooms: activeRows.length,
        finishedRooms: finishedRows.length,
        settled,
        advanced,
        resumed,
        autoStarted,
      },
      'room recovery complete',
    );
  }

  /**
   * Advance a room through multiple missed phases (e.g., server was down for
   * longer than one phase duration). Emits updates for each intermediate phase
   * and schedules the timer for the final target phase with remaining time.
   */
  private async advanceThroughMissedPhases(
    roomId: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<void> {
    // Advance through each missed phase
    for (let i = fromIndex; i < toIndex; i++) {
      const advancedRoom = this.db.transaction(() => {
        let room: RoomRecord;
        try {
          room = this.loadRoom(roomId);
        } catch {
          return null;
        }

        const newState = gameEngine.advancePhase(room);
        if (!newState) return null;

        const updated: RoomRecord = {
          ...room,
          status: newState.phase as RoomStatus,
          gameState: newState,
          updatedAt: Date.now(),
        };
        this.persistRoom(updated);
        return updated;
      })();

      if (advancedRoom) {
        emitRoomUpdated(advancedRoom);
      } else {
        // advancePhase returned null -- settle instead
        await this.settleRound(roomId);
        return;
      }
    }

    // Schedule the timer for the current phase with remaining time
    this.schedulePhaseTransition(roomId, toIndex);
  }
}
