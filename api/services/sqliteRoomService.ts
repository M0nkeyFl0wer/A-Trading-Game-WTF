import type Database from 'better-sqlite3';
import { getDatabase } from './database';
import { emitRoomUpdated, emitRoomRemoved } from '../lib/roomEvents';
import { gameEngine, type RoomGameState, type TradeSummary } from './gameEngine';
import type { RoomRecord, RoomPlayer, RoomStatus } from './roomService';
import { RoomServiceError } from './roomService';

const createRoomId = () => `room_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const DEFAULT_BALANCE = 1_000;
const CHARACTER_SEQUENCE = ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'];
const TRADING_WINDOW_MS = 20_000;
const NEXT_ROUND_DELAY_MS = 5_000;

type RoomTimers = {
  settle?: NodeJS.Timeout;
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
    roundEndsAt: row.round_ends_at ?? undefined,
    gameState: row.game_state ? JSON.parse(row.game_state) : undefined,
    pendingTrades: row.pending_trades ? JSON.parse(row.pending_trades) : undefined,
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
      getPlayingRooms: db.prepare("SELECT * FROM rooms WHERE status = 'playing'"),

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
      getActiveRound: db.prepare("SELECT * FROM rounds WHERE room_id = ? AND phase = 'playing' ORDER BY round_number DESC LIMIT 1"),

      insertTrade: db.prepare(`
        INSERT INTO trades (id, round_id, room_id, player_id, player_name, counterparty_id, counterparty_name, direction, price, quantity, value, timestamp)
        VALUES (@id, @round_id, @room_id, @player_id, @player_name, @counterparty_id, @counterparty_name, @direction, @price, @quantity, @value, @timestamp)
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
      round_ends_at: room.roundEndsAt ?? null,
      game_state: room.gameState ? JSON.stringify(room.gameState) : null,
      pending_trades: room.pendingTrades ? JSON.stringify(room.pendingTrades) : null,
      created_at: room.createdAt,
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
      pendingTrades: [],
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
        pending_trades: JSON.stringify(room.pendingTrades),
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
        status: room.players.length + 1 === room.maxPlayers ? 'playing' : room.status,
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

  async submitTrade(
    roomId: string,
    playerId: string,
    trade: { price: number; quantity: number; side: 'buy' | 'sell' },
  ): Promise<RoomRecord> {
    const updated = this.db.transaction(() => {
      const room = this.loadRoom(roomId);
      if (room.status !== 'playing') {
        throw new RoomServiceError(400, 'Round is not accepting trades');
      }
      const player = room.players.find((p) => p.id === playerId);
      if (!player) {
        throw new RoomServiceError(404, 'Player not found in room');
      }
      const counterparties = room.players.filter((p) => p.id !== playerId);
      const counterparty = counterparties[Math.floor(Math.random() * counterparties.length)] || player;

      const summary: TradeSummary = {
        id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        playerId,
        playerName: player.name,
        counterpartyId: counterparty.id,
        counterpartyName: counterparty.name,
        quantity: trade.quantity,
        price: trade.price,
        value: trade.price * trade.quantity,
        type: trade.side,
        timestamp: Date.now(),
      };

      const pending = [...(room.pendingTrades ?? []), summary];
      const gameState: RoomGameState = room.gameState || {
        roundNumber: room.roundNumber,
        phase: room.status,
        communityCards: [],
        trades: [],
        playerCards: [],
        updatedAt: Date.now(),
      };
      const updatedGameState: RoomGameState = {
        ...gameState,
        trades: [...(gameState.trades ?? []), summary],
        updatedAt: Date.now(),
      };

      const updatedRoom: RoomRecord = {
        ...room,
        pendingTrades: pending,
        gameState: updatedGameState,
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);

      // Also persist trade row for historical queries
      this.stmts.insertTrade.run({
        id: summary.id,
        round_id: null,
        room_id: roomId,
        player_id: summary.playerId,
        player_name: summary.playerName,
        counterparty_id: summary.counterpartyId,
        counterparty_name: summary.counterpartyName,
        direction: summary.type,
        price: summary.price,
        quantity: summary.quantity,
        value: summary.value,
        timestamp: summary.timestamp,
      });

      return updatedRoom;
    })();

    emitRoomUpdated(updated);
    return updated;
  }

  async startRoom(roomId: string, requesterId: string): Promise<RoomRecord> {
    const prepared = this.db.transaction(() => {
      const room = this.loadRoom(roomId);
      if (room.hostId !== requesterId) {
        throw new RoomServiceError(403, 'Only the host can start the game');
      }
      if (room.players.length < 2) {
        throw new RoomServiceError(400, 'At least two players required to start');
      }

      const roundNumber = room.roundNumber + 1;
      const roundEndsAt = Date.now() + TRADING_WINDOW_MS;
      const updatedRoom: RoomRecord = {
        ...room,
        status: 'playing',
        roundNumber,
        roundEndsAt,
        pendingTrades: [],
        gameState: {
          roundNumber,
          phase: 'playing',
          communityCards: [],
          trades: [],
          playerCards: [],
          updatedAt: Date.now(),
        },
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);

      // Record the round
      this.stmts.insertRound.run({
        room_id: roomId,
        round_number: roundNumber,
        phase: 'playing',
        community_cards: null,
        started_at: Date.now(),
      });

      return updatedRoom;
    })();

    emitRoomUpdated(prepared);
    this.scheduleRoundSettlement(roomId);
    return prepared;
  }

  // ---------------------------------------------------------------------------
  // Round automation (identical timer logic to original RoomService)
  // ---------------------------------------------------------------------------

  private scheduleRoundSettlement(roomId: string, delayMs = TRADING_WINDOW_MS) {
    const timers = this.getTimers(roomId);
    if (timers.settle) {
      clearTimeout(timers.settle);
    }
    timers.settle = setTimeout(() => {
      this.settleRound(roomId).catch((error) => {
        console.error('Failed to settle round', error);
      });
    }, delayMs);
  }

  private async settleRound(roomId: string): Promise<RoomRecord | null> {
    const timers = this.getTimers(roomId);
    if (timers.settle) {
      clearTimeout(timers.settle);
      timers.settle = undefined;
    }

    const finalized = this.db.transaction(() => {
      let room: RoomRecord;
      try {
        room = this.loadRoom(roomId);
      } catch {
        return null;
      }

      const result = gameEngine.completeRound(room, room.pendingTrades ?? []);
      const updatedRoom: RoomRecord = {
        ...room,
        status: result.status,
        players: result.players,
        roundNumber: result.roundNumber,
        gameState: result.gameState,
        pendingTrades: [],
        roundEndsAt: undefined,
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    if (finalized) {
      emitRoomUpdated(finalized);
      this.scheduleNextRound(roomId, finalized);
    }
    return finalized;
  }

  private scheduleNextRound(roomId: string, room: RoomRecord) {
    if (room.players.length < 2) {
      return;
    }
    const timers = this.getTimers(roomId);
    if (timers.nextRound) {
      clearTimeout(timers.nextRound);
    }
    timers.nextRound = setTimeout(() => {
      this.beginAutomatedRound(roomId).catch((error) => {
        console.error('Failed to start next round', error);
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
      if (room.players.length < 2) {
        return room;
      }

      const roundNumber = room.roundNumber + 1;
      const roundEndsAt = Date.now() + TRADING_WINDOW_MS;
      const updatedRoom: RoomRecord = {
        ...room,
        status: 'playing',
        roundNumber,
        roundEndsAt,
        pendingTrades: [],
        gameState: {
          roundNumber,
          phase: 'playing',
          communityCards: [],
          trades: [],
          playerCards: [],
          updatedAt: Date.now(),
        },
        updatedAt: Date.now(),
      };

      this.persistRoom(updatedRoom);

      this.stmts.insertRound.run({
        room_id: roomId,
        round_number: roundNumber,
        phase: 'playing',
        community_cards: null,
        started_at: Date.now(),
      });

      return updatedRoom;
    })();

    if (prepared) {
      emitRoomUpdated(prepared);
      this.scheduleRoundSettlement(roomId);
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

  private clearTimers(roomId: string) {
    const timers = this.timers.get(roomId);
    if (!timers) {
      return;
    }
    if (timers.settle) {
      clearTimeout(timers.settle);
    }
    if (timers.nextRound) {
      clearTimeout(timers.nextRound);
    }
    this.timers.delete(roomId);
  }

  private restoreActiveRounds() {
    const rows = this.stmts.getPlayingRooms.all() as RoomRow[];
    const now = Date.now();
    for (const row of rows) {
      if (row.round_ends_at && row.round_ends_at > now) {
        const delay = Math.max(1_000, row.round_ends_at - now);
        this.scheduleRoundSettlement(row.id, delay);
      }
    }
  }
}
