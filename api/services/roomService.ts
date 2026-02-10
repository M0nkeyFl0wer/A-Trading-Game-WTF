import type { Firestore } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '../lib/firebaseAdmin';
import { emitRoomUpdated, emitRoomRemoved } from '../lib/roomEvents';
import { gameEngine, type RoomGameState, type TradeSummary } from './gameEngine';

export type RoomStatus = 'waiting' | 'playing' | 'starting' | 'finished';

export interface RoomPlayer {
  id: string;
  name: string;
  joinedAt: number;
  balance: number;
  character: string;
  isBot?: boolean;
  isWinner?: boolean;
}

export interface RoomRecord {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  maxPlayers: number;
  status: RoomStatus;
  players: RoomPlayer[];
  createdAt: number;
  updatedAt: number;
  roundNumber: number;
  gameState?: RoomGameState;
  roundEndsAt?: number;
  pendingTrades?: TradeSummary[];
}

export class RoomServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RoomServiceError';
  }
}

const createRoomId = () => `room_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const DEFAULT_BALANCE = 1_000;
const CHARACTER_SEQUENCE = ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'];
const TRADING_WINDOW_MS = 20_000;
const NEXT_ROUND_DELAY_MS = 5_000;
const BOT_TRADE_DELAY_MS = 3_000;

type RoomTimers = {
  settle?: NodeJS.Timeout;
  nextRound?: NodeJS.Timeout;
  botTrades?: NodeJS.Timeout;
};

const createPlayer = (id: string, name: string, index: number): RoomPlayer => ({
  id,
  name,
  joinedAt: Date.now(),
  balance: DEFAULT_BALANCE,
  character: CHARACTER_SEQUENCE[index % CHARACTER_SEQUENCE.length],
});

export class RoomService {
  private memoryRooms = new Map<string, RoomRecord>();
  private timers = new Map<string, RoomTimers>();
  private db: Firestore | null;

  constructor(firestore: Firestore | null) {
    this.db = firestore;
    if (this.db) {
      this.restoreActiveRounds().catch((error) => {
        console.error('Failed to restore active rounds', error);
      });
    }
  }

  async listRooms(): Promise<RoomRecord[]> {
    if (!this.db) {
      return Array.from(this.memoryRooms.values());
    }
    const snapshot = await this.db.collection('rooms').orderBy('updatedAt', 'desc').limit(50).get();
    return snapshot.docs.map((doc) => doc.data() as RoomRecord);
  }

  async getRoom(roomId: string): Promise<RoomRecord> {
    if (!this.db) {
      const room = this.memoryRooms.get(roomId);
      if (!room) {
        throw new RoomServiceError(404, 'Room not found');
      }
      return room;
    }

    const doc = await this.db.collection('rooms').doc(roomId).get();
    if (!doc.exists) {
      throw new RoomServiceError(404, 'Room not found');
    }
    return doc.data() as RoomRecord;
  }

  async createRoom(name: string, maxPlayers: number, hostId: string, hostName: string): Promise<RoomRecord> {
    const hostPlayer = { ...createPlayer(hostId, hostName, 0), character: 'DEALER' };
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

    if (!this.db) {
      this.memoryRooms.set(room.id, room);
      emitRoomUpdated(room);
      return room;
    }

    await this.db.collection('rooms').doc(room.id).set(room);
    emitRoomUpdated(room);
    return room;
  }

  async joinRoom(roomId: string, player: { id: string; name: string; isBot?: boolean; character?: string }): Promise<RoomRecord> {
    if (!this.db) {
      const updated = this.joinMemoryRoom(roomId, player);
      emitRoomUpdated(updated);
      return updated;
    }

    return this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        throw new RoomServiceError(404, 'Room not found');
      }
      const room = snapshot.data() as RoomRecord;
      const updated = this.joinRoomState(room, player);
      tx.set(ref, updated);
      emitRoomUpdated(updated);
      return updated;
    });
  }

  async leaveRoom(roomId: string, playerId: string): Promise<RoomRecord> {
    if (!this.db) {
      const updated = this.leaveMemoryRoom(roomId, playerId);
      emitRoomUpdated(updated);
      if (updated.players.length === 0) {
        emitRoomRemoved({ id: updated.id });
        this.clearTimers(roomId);
      }
      return updated;
    }

    return this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        throw new RoomServiceError(404, 'Room not found');
      }
      const room = snapshot.data() as RoomRecord;
      const updated = this.leaveRoomState(room, playerId);

      if (updated.players.length === 0) {
        tx.delete(ref);
        emitRoomRemoved({ id: updated.id });
        this.clearTimers(roomId);
      } else {
        tx.set(ref, updated);
        emitRoomUpdated(updated);
      }
      return updated;
    });
  }

  async submitTrade(
    roomId: string,
    playerId: string,
    trade: { price: number; quantity: number; side: 'buy' | 'sell' },
  ): Promise<RoomRecord> {
    const applyTrade = (room: RoomRecord): RoomRecord => {
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
      return {
        ...room,
        pendingTrades: pending,
        gameState: updatedGameState,
        updatedAt: Date.now(),
      };
    };

    if (!this.db) {
      const room = this.memoryRooms.get(roomId);
      if (!room) {
        throw new RoomServiceError(404, 'Room not found');
      }
      const updated = applyTrade({ ...room, players: [...room.players] });
      this.memoryRooms.set(roomId, updated);
      emitRoomUpdated(updated);
      return updated;
    }

    return this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        throw new RoomServiceError(404, 'Room not found');
      }
      const room = snapshot.data() as RoomRecord;
      const updated = applyTrade(room);
      tx.set(ref, updated);
      return updated;
    }).then((updated) => {
      emitRoomUpdated(updated);
      return updated;
    });
  }

  async startRoom(roomId: string, requesterId: string): Promise<RoomRecord> {
    const canStart = (room: RoomRecord) => {
      if (room.hostId !== requesterId) {
        throw new RoomServiceError(403, 'Only the host can start the game');
      }
      if (room.players.length < 2) {
        throw new RoomServiceError(400, 'At least two players required to start');
      }
    };

    if (!this.db) {
      const room = this.memoryRooms.get(roomId);
      if (!room) {
        throw new RoomServiceError(404, 'Room not found');
      }
      canStart(room);
      const prepared = this.prepareRound({ ...room, players: [...room.players] });
      this.memoryRooms.set(roomId, prepared);
      emitRoomUpdated(prepared);
      this.scheduleRoundSettlement(roomId);
      this.scheduleBotTrades(roomId);
      return prepared;
    }

    return this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        throw new RoomServiceError(404, 'Room not found');
      }
      const room = snapshot.data() as RoomRecord;
      canStart(room);
      const prepared = this.prepareRound(room);
      tx.set(ref, prepared);
      return prepared;
    }).then((prepared) => {
      emitRoomUpdated(prepared);
      this.scheduleRoundSettlement(roomId);
      this.scheduleBotTrades(roomId);
      return prepared;
    });
  }

  private joinRoomState(room: RoomRecord, player: { id: string; name: string; isBot?: boolean; character?: string }): RoomRecord {
    if (room.players.find((p) => p.id === player.id)) {
      return room;
    }

    if (room.players.length >= room.maxPlayers) {
      throw new RoomServiceError(400, 'Room is full');
    }

    const newPlayer: RoomPlayer = {
      ...createPlayer(player.id, player.name, room.players.length),
      isBot: player.isBot ?? false,
      ...(player.character ? { character: player.character } : {}),
    };

    const updated: RoomRecord = {
      ...room,
      players: [...room.players, newPlayer],
      status: room.players.length + 1 === room.maxPlayers ? 'playing' : room.status,
      updatedAt: Date.now(),
    };

    return updated;
  }

  private leaveRoomState(room: RoomRecord, playerId: string): RoomRecord {
    const remainingPlayers = room.players.filter((p) => p.id !== playerId);
    if (remainingPlayers.length === room.players.length) {
      throw new RoomServiceError(400, 'Player not found in room');
    }

    let hostId = room.hostId;
    let hostName = room.hostName;
    if (hostId === playerId) {
      const newHost = remainingPlayers[0];
      hostId = newHost?.id || hostId;
      hostName = newHost?.name || hostName;
    }

    const updated: RoomRecord = {
      ...room,
      hostId,
      hostName,
      players: remainingPlayers,
      status: remainingPlayers.length === 0 ? 'waiting' : room.status,
      updatedAt: Date.now(),
      gameState: remainingPlayers.length === 0 ? undefined : room.gameState,
    };

    return updated;
  }

  private prepareRound(room: RoomRecord): RoomRecord {
    const roundNumber = room.roundNumber + 1;
    const roundEndsAt = Date.now() + TRADING_WINDOW_MS;
    return {
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
  }

  private finalizeRound(room: RoomRecord): RoomRecord {
    const result = gameEngine.completeRound(room, room.pendingTrades ?? []);
    return {
      ...room,
      status: result.status,
      players: result.players,
      roundNumber: result.roundNumber,
      gameState: result.gameState,
      pendingTrades: [],
      roundEndsAt: undefined,
      updatedAt: Date.now(),
    };
  }

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

  private scheduleBotTrades(roomId: string) {
    const timers = this.getTimers(roomId);
    if (timers.botTrades) clearTimeout(timers.botTrades);
    timers.botTrades = setTimeout(() => {
      this.submitBotTrades(roomId).catch((error) => { console.error('Bot trade generation failed', error); });
    }, BOT_TRADE_DELAY_MS);
  }

  private async submitBotTrades(roomId: string): Promise<void> {
    const timers = this.getTimers(roomId);
    if (timers.botTrades) { clearTimeout(timers.botTrades); timers.botTrades = undefined; }
    const room = !this.db
      ? this.memoryRooms.get(roomId) ?? null
      : ((await this.db.collection('rooms').doc(roomId).get()).data() as RoomRecord | undefined) ?? null;
    if (!room || room.status !== 'playing') return;
    const botTrades = gameEngine.generateBotTrades(room);
    if (botTrades.length === 0) return;
    const pending = [...(room.pendingTrades ?? []), ...botTrades];
    const updatedGameState = {
      ...(room.gameState ?? { roundNumber: room.roundNumber, phase: room.status, communityCards: [], trades: [], playerCards: [], updatedAt: Date.now() }),
      trades: [...(room.gameState?.trades ?? []), ...botTrades],
      updatedAt: Date.now(),
    };
    const updated: RoomRecord = { ...room, pendingTrades: pending, gameState: updatedGameState as any, updatedAt: Date.now() };
    if (!this.db) { this.memoryRooms.set(roomId, updated); } else { await this.db.collection('rooms').doc(roomId).set(updated); }
    emitRoomUpdated(updated);
  }

  private async settleRound(roomId: string): Promise<RoomRecord | null> {
    const timers = this.getTimers(roomId);
    if (timers.settle) {
      clearTimeout(timers.settle);
      timers.settle = undefined;
    }

    if (!this.db) {
      const room = this.memoryRooms.get(roomId);
      if (!room) {
        return null;
      }
      const finalized = this.finalizeRound({ ...room, players: [...room.players] });
      this.memoryRooms.set(roomId, finalized);
      emitRoomUpdated(finalized);
      this.scheduleNextRound(roomId, finalized);
      return finalized;
    }

    const finalized = await this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        return null;
      }
      const room = snapshot.data() as RoomRecord;
      const updated = this.finalizeRound(room);
      tx.set(ref, updated);
      return updated;
    });

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

    if (!this.db) {
      const room = this.memoryRooms.get(roomId);
      if (!room || room.players.length < 2) {
        return room ?? null;
      }
      const prepared = this.prepareRound({ ...room, players: [...room.players] });
      this.memoryRooms.set(roomId, prepared);
      emitRoomUpdated(prepared);
      this.scheduleRoundSettlement(roomId);
      this.scheduleBotTrades(roomId);
      return prepared;
    }

    const prepared = await this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) {
        return null;
      }
      const room = snapshot.data() as RoomRecord;
      if (room.players.length < 2) {
        return room;
      }
      const updated = this.prepareRound(room);
      tx.set(ref, updated);
      return updated;
    });

    if (prepared) {
      emitRoomUpdated(prepared);
      this.scheduleRoundSettlement(roomId);
      this.scheduleBotTrades(roomId);
    }
    return prepared;
  }

  private joinMemoryRoom(roomId: string, player: { id: string; name: string; isBot?: boolean; character?: string }): RoomRecord {
    const room = this.memoryRooms.get(roomId);
    if (!room) {
      throw new RoomServiceError(404, 'Room not found');
    }
    const updated = this.joinRoomState({ ...room, players: [...room.players] }, player);
    this.memoryRooms.set(roomId, updated);
    return updated;
  }

  private leaveMemoryRoom(roomId: string, playerId: string): RoomRecord {
    const room = this.memoryRooms.get(roomId);
    if (!room) {
      throw new RoomServiceError(404, 'Room not found');
    }
    const updated = this.leaveRoomState({ ...room, players: [...room.players] }, playerId);
    if (updated.players.length === 0) {
      this.memoryRooms.delete(roomId);
      this.clearTimers(roomId);
    } else {
      this.memoryRooms.set(roomId, updated);
    }
    return updated;
  }

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
    if (timers.botTrades) {
      clearTimeout(timers.botTrades);
    }
    this.timers.delete(roomId);
  }

  private async restoreActiveRounds() {
    if (!this.db) {
      return;
    }
    const snapshot = await this.db.collection('rooms').where('status', '==', 'playing').get();
    const now = Date.now();
    snapshot.docs.forEach((doc) => {
      const room = doc.data() as RoomRecord;
      if (room.roundEndsAt && room.roundEndsAt > now) {
        const delay = Math.max(1_000, room.roundEndsAt - now);
        this.scheduleRoundSettlement(room.id, delay);
      }
    });
  }
}

const firestore = getFirestoreInstance();
export const roomService = new RoomService(firestore);
