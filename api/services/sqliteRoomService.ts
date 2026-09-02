import { randomInt, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDatabase } from './database';
import { emitRoomUpdated, emitRoomRemoved } from '../lib/roomEvents';
import { PHASE_SEQUENCE, NEXT_ROUND_DELAY_MS } from '@trading-game/shared';
import type { Order } from '@trading-game/shared';
import { gameEngine, type RoomGameState } from './gameEngine';
import type { RoomRecord, RoomPlayer, RoomStatus } from './roomService';
import { RoomServiceError } from './roomService';
import { logger } from '../lib/logger';
import { createSignedReceipt } from '../lib/signing';
import { emitGameEvent } from '../lib/gameEvents';
import { ledgerService } from './ledger';

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
// NEXT_ROUND_DELAY_MS now lives in @trading-game/shared so the client countdown
// and this server timer cannot drift apart again (#14).

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

// A room only keeps playing while a real person is seated. Bots inherit host
// when humans leave, so a bare `players.length >= 2` check would let a bot-only
// table deal rounds (and write ledger/audit/KG rows) forever (#14).
const hasHumanPlayer = (players: Array<{ isBot?: boolean }>): boolean =>
  players.some((p) => !p.isBot);

// ---------------------------------------------------------------------------
// Margin enforcement (shared by order-book submission and quote hit/lift)
// ---------------------------------------------------------------------------

// Theoretical max settlement total: the entire deck sum.
const MAX_SETTLEMENT = 130;

// Worst-case loss for a position, per the CFD-style settlement:
// a bid loses if settlement -> 0; an ask loses if settlement -> MAX_SETTLEMENT.
const computeMaxLoss = (side: 'bid' | 'ask', price: number, quantity: number): number =>
  side === 'bid' ? price * quantity : (MAX_SETTLEMENT - price) * quantity;

// Sum of worst-case loss across a player's currently open/partial orders.
const computeLockedMargin = (orders: Order[], playerId: string): number =>
  orders
    .filter((o) => o.playerId === playerId && (o.status === 'open' || o.status === 'partial'))
    .reduce((sum, o) => sum + computeMaxLoss(o.side, o.price, o.quantity - o.filledQuantity), 0);

// Throws if a player can't cover the worst-case loss of a new position,
// accounting for margin already locked by their other open orders.
const assertMargin = (
  player: RoomPlayer,
  orders: Order[],
  side: 'bid' | 'ask',
  price: number,
  quantity: number,
): void => {
  const maxLoss = computeMaxLoss(side, price, quantity);
  const lockedMargin = computeLockedMargin(orders, player.id);
  const availableBalance = player.balance - lockedMargin;
  if (maxLoss > availableBalance) {
    throw new RoomServiceError(
      400,
      `Insufficient margin. Required: $${maxLoss.toFixed(2)}, Available: $${availableBalance.toFixed(2)}`,
    );
  }
};

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

      // Last human out: remove any remaining bots and delete the room outright.
      // (An empty room is just the degenerate case of "no humans left".) (#14)
      if (!hasHumanPlayer(remainingPlayers)) {
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

      // Margin enforcement: ensure player can cover worst-case loss.
      assertMargin(player, room.gameState?.orders ?? [], order.side, order.price, order.quantity);

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

    emitGameEvent('order_submit', roomId, updated.roundNumber, {
      playerId,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
    });
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

    emitGameEvent('order_cancel', roomId, updated.roundNumber, { playerId, orderId });
    emitRoomUpdated(updated);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Two-way quote requests
  // ---------------------------------------------------------------------------

  async requestQuote(roomId: string, requesterId: string, targetId: string): Promise<RoomRecord> {
    const updated = this.db.transaction(() => {
      const room = this.loadRoom(roomId);
      const phase = room.status;
      if (phase !== 'blind' && phase !== 'flop' && phase !== 'turn') {
        throw new RoomServiceError(400, 'Round is not accepting quote requests');
      }
      if (requesterId === targetId) {
        throw new RoomServiceError(400, 'Cannot request a quote from yourself');
      }

      const requester = room.players.find((p) => p.id === requesterId);
      if (!requester) {
        throw new RoomServiceError(404, 'Player not found in room');
      }
      const target = room.players.find((p) => p.id === targetId);
      if (!target) {
        throw new RoomServiceError(404, 'Target player not found in room');
      }

      // Max one active outbound quote per requester -- kills spam-pinging one target.
      const activeRequest = (room.gameState?.quotes ?? []).find(
        (q) => q.requesterId === requesterId && (q.status === 'pending' || q.status === 'quoted'),
      );
      if (activeRequest) {
        throw new RoomServiceError(400, 'You already have an active quote request');
      }

      const gameState = gameEngine.requestQuote(room, requesterId, requester.name, targetId, target.name);
      const updatedRoom: RoomRecord = { ...room, gameState, updatedAt: Date.now() };
      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    // The invariant above guarantees exactly one fresh 'pending' quote from this requester.
    const quote = updated.gameState?.quotes?.find(
      (q) => q.requesterId === requesterId && q.status === 'pending',
    );
    emitGameEvent('quote_request', roomId, updated.roundNumber, {
      quoteId: quote?.id,
      requesterId,
      targetId,
    });
    emitRoomUpdated(updated);
    return updated;
  }

  async respondToQuote(
    roomId: string,
    targetId: string,
    quoteId: string,
    bidPrice: number,
    askPrice: number,
  ): Promise<RoomRecord> {
    const updated = this.db.transaction(() => {
      const room = this.loadRoom(roomId);
      const phase = room.status;
      if (phase !== 'blind' && phase !== 'flop' && phase !== 'turn') {
        throw new RoomServiceError(400, 'Round is not accepting quote responses');
      }

      const quote = room.gameState?.quotes?.find((q) => q.id === quoteId);
      if (!quote) {
        throw new RoomServiceError(404, 'Quote request not found');
      }
      if (quote.targetId !== targetId) {
        throw new RoomServiceError(403, 'Only the requested player can respond to this quote');
      }
      if (quote.status !== 'pending') {
        throw new RoomServiceError(409, 'Quote request is no longer open');
      }
      if (Date.now() >= quote.expiresAt) {
        throw new RoomServiceError(400, 'Quote request expired');
      }

      let gameState: RoomGameState;
      try {
        gameState = gameEngine.respondToQuote(room, quoteId, bidPrice, askPrice);
      } catch (err) {
        throw new RoomServiceError(400, err instanceof Error ? err.message : 'Invalid quote response');
      }

      const updatedRoom: RoomRecord = { ...room, gameState, updatedAt: Date.now() };
      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    emitGameEvent('quote_respond', roomId, updated.roundNumber, { quoteId, targetId, bidPrice, askPrice });
    emitRoomUpdated(updated);
    return updated;
  }

  /** Shared by hitQuote/liftQuote -- the only difference is which side of the quote the requester takes. */
  private async resolveQuote(
    roomId: string,
    requesterId: string,
    quoteId: string,
    side: 'hit' | 'lift',
  ): Promise<RoomRecord> {
    const updated = this.db.transaction(() => {
      const room = this.loadRoom(roomId);
      const phase = room.status;
      if (phase !== 'blind' && phase !== 'flop' && phase !== 'turn') {
        throw new RoomServiceError(400, 'Round is not accepting trades');
      }

      const quote = room.gameState?.quotes?.find((q) => q.id === quoteId);
      if (!quote) {
        throw new RoomServiceError(404, 'Quote request not found');
      }
      if (quote.requesterId !== requesterId) {
        throw new RoomServiceError(403, 'Only the requesting player can act on this quote');
      }
      if (quote.status !== 'quoted') {
        throw new RoomServiceError(409, 'Quote is not open to hit or lift');
      }
      if (Date.now() >= quote.expiresAt) {
        throw new RoomServiceError(400, 'Quote request expired');
      }
      if (quote.bidPrice === undefined || quote.askPrice === undefined) {
        throw new RoomServiceError(400, 'Quote has no price');
      }

      const requester = room.players.find((p) => p.id === requesterId);
      if (!requester) {
        throw new RoomServiceError(404, 'Player not found in room');
      }
      const target = room.players.find((p) => p.id === quote.targetId);
      if (!target) {
        throw new RoomServiceError(404, 'Counterparty is no longer in the room');
      }

      // Margin check both sides at qty 1: "hit" the bid = requester sells (ask-shaped
      // exposure) and target buys (bid-shaped); "lift" the ask is the mirror.
      const price = side === 'hit' ? quote.bidPrice : quote.askPrice;
      const requesterSide: 'bid' | 'ask' = side === 'hit' ? 'ask' : 'bid';
      const targetSide: 'bid' | 'ask' = side === 'hit' ? 'bid' : 'ask';
      const orders = room.gameState?.orders ?? [];
      assertMargin(requester, orders, requesterSide, price, 1);
      assertMargin(target, orders, targetSide, price, 1);

      const { gameState } = gameEngine.recordQuoteTrade(room, quoteId, side);
      const updatedRoom: RoomRecord = { ...room, gameState, updatedAt: Date.now() };
      this.persistRoom(updatedRoom);
      return updatedRoom;
    })();

    emitGameEvent('quote_fill', roomId, updated.roundNumber, { quoteId, requesterId, side });
    emitRoomUpdated(updated);
    return updated;
  }

  async hitQuote(roomId: string, requesterId: string, quoteId: string): Promise<RoomRecord> {
    return this.resolveQuote(roomId, requesterId, quoteId, 'hit');
  }

  async liftQuote(roomId: string, requesterId: string, quoteId: string): Promise<RoomRecord> {
    return this.resolveQuote(roomId, requesterId, quoteId, 'lift');
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

    emitGameEvent('round_deal', room.id, roundNumber, { playerCount: room.players.length });

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
      const previousPhase = PHASE_SEQUENCE[phaseIndex]?.phase;
      const newPhase = PHASE_SEQUENCE[nextIndex]?.phase;
      emitGameEvent('phase_advance', roomId, advanced.roundNumber, { from: previousPhase, to: newPhase });
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
      const gs = finalized.gameState;
      if (gs) {
        emitGameEvent('settlement', roomId, finalized.roundNumber, {
          settlementTotal: gs.settlementTotal,
          pnl: gs.pnl,
          matchedTrades: gs.matchedTrades,
        });
        if (gs.pnl) {
          ledgerService.recordSettlement(roomId, finalized.roundNumber, gs.pnl);
        }
      }
      emitRoomUpdated(finalized);
      this.scheduleNextRound(roomId, finalized);
    }
  }

  // ---------------------------------------------------------------------------
  // Next round automation
  // ---------------------------------------------------------------------------

  private scheduleNextRound(roomId: string, room: RoomRecord): void {
    // Nobody human is watching: stop here and tear the room down (#14).
    if (!hasHumanPlayer(room.players)) {
      this.retireBotOnlyRoom(roomId, 'no human players at settlement');
      return;
    }
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

    // Humans may have left during the settlement pause -- never deal to an
    // audience of bots (#14).
    if (!this.roomHasHuman(roomId)) {
      this.retireBotOnlyRoom(roomId, 'no human players before next round');
      return null;
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

  /** True when at least one non-bot player is seated (reads the DB, not a cached record). */
  private roomHasHuman(roomId: string): boolean {
    const rows = this.stmts.getPlayers.all(roomId) as PlayerRow[];
    return rows.some((p) => p.is_bot !== 1);
  }

  /**
   * Stop every timer for a room with no human player left and delete it, bots
   * included. Called from the automation paths that would otherwise keep a
   * bot-only table dealing forever (#14). Deleting a room that is already
   * gone is a harmless no-op.
   */
  private retireBotOnlyRoom(roomId: string, reason: string): void {
    this.clearTimers(roomId);
    this.db.transaction(() => {
      this.stmts.deleteRoomPlayers.run(roomId);
      this.stmts.deleteRoom.run(roomId);
    })();
    logger.info({ roomId, reason }, 'retired bot-only room');
    emitRoomRemoved({ id: roomId });
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
    let retired = 0;

    // -----------------------------------------------------------------------
    // 1. Recover rooms in active trading phases (blind, flop, turn)
    // -----------------------------------------------------------------------
    const activeRows = this.stmts.getActivePhaseRooms.all() as RoomRow[];

    for (const row of activeRows) {
      // A bot-only room must not be re-armed on restart -- that is how they
      // used to survive forever (#14).
      if (!this.roomHasHuman(row.id)) {
        this.retireBotOnlyRoom(row.id, 'server restart, no human players');
        retired++;
        continue;
      }

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

      // Bot-only rooms are torn down rather than auto-started, regardless of
      // how recently they finished -- nothing else would ever clean them up (#14).
      if (!this.roomHasHuman(row.id)) {
        this.retireBotOnlyRoom(row.id, 'server restart, no human players');
        retired++;
        continue;
      }

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
        retired,
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
