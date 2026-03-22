import { randomUUID } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '../lib/firebaseAdmin';
import { emitRoomUpdated, emitRoomRemoved } from '../lib/roomEvents';
import { PHASE_SEQUENCE } from '@trading-game/shared';
import type { TradingPhase } from '@trading-game/shared';
import { gameEngine, type RoomGameState } from './gameEngine';

export type RoomStatus = 'waiting' | 'blind' | 'flop' | 'turn' | 'settling' | 'finished';

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
}

export class RoomServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RoomServiceError';
  }
}

const createRoomId = () => `room_${randomUUID().slice(0, 8).toUpperCase()}`;

const DEFAULT_BALANCE = 1_000;
const CHARACTER_SEQUENCE = ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'];
const NEXT_ROUND_DELAY_MS = 5_000;

type RoomTimers = {
  phase?: NodeJS.Timeout;
  nextRound?: NodeJS.Timeout;
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

  // =========================================================================
  // CRUD
  // =========================================================================

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
      if (!room) throw new RoomServiceError(404, 'Room not found');
      return room;
    }
    const doc = await this.db.collection('rooms').doc(roomId).get();
    if (!doc.exists) throw new RoomServiceError(404, 'Room not found');
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

  async joinRoom(roomId: string, player: { id: string; name: string }): Promise<RoomRecord> {
    if (!this.db) {
      const updated = this.joinMemoryRoom(roomId, player);
      emitRoomUpdated(updated);
      return updated;
    }

    return this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new RoomServiceError(404, 'Room not found');
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
      if (!snapshot.exists) throw new RoomServiceError(404, 'Room not found');
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

  // =========================================================================
  // Order book operations
  // =========================================================================

  async submitOrder(
    roomId: string,
    playerId: string,
    order: { price: number; quantity: number; side: 'bid' | 'ask' },
  ): Promise<RoomRecord> {
    const applyOrder = (room: RoomRecord): RoomRecord => {
      const phase = room.status;
      if (phase !== 'blind' && phase !== 'flop' && phase !== 'turn') {
        throw new RoomServiceError(400, 'Round is not accepting orders');
      }
      const player = room.players.find((p) => p.id === playerId);
      if (!player) throw new RoomServiceError(404, 'Player not found in room');

      const { gameState } = gameEngine.submitOrder(room, playerId, player.name, order);
      return {
        ...room,
        gameState,
        updatedAt: Date.now(),
      };
    };

    if (!this.db) {
      const room = this.memoryRooms.get(roomId);
      if (!room) throw new RoomServiceError(404, 'Room not found');
      const updated = applyOrder({ ...room, players: [...room.players] });
      this.memoryRooms.set(roomId, updated);
      emitRoomUpdated(updated);
      return updated;
    }

    return this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new RoomServiceError(404, 'Room not found');
      const room = snapshot.data() as RoomRecord;
      const updated = applyOrder(room);
      tx.set(ref, updated);
      return updated;
    }).then((updated) => {
      emitRoomUpdated(updated);
      return updated;
    });
  }

  async cancelOrder(roomId: string, playerId: string, orderId: string): Promise<RoomRecord> {
    const applyCancel = (room: RoomRecord): RoomRecord => {
      const phase = room.status;
      if (phase !== 'blind' && phase !== 'flop' && phase !== 'turn') {
        throw new RoomServiceError(400, 'Round is not accepting order changes');
      }
      if (!room.gameState) throw new RoomServiceError(400, 'No active game state');

      // Verify the order belongs to this player
      const orderToCancel = room.gameState.orders.find((o) => o.id === orderId);
      if (!orderToCancel) throw new RoomServiceError(404, 'Order not found');
      if (orderToCancel.playerId !== playerId) {
        throw new RoomServiceError(403, 'Cannot cancel another player\'s order');
      }

      const gameState = gameEngine.cancelOrder(room, orderId);
      return {
        ...room,
        gameState,
        updatedAt: Date.now(),
      };
    };

    if (!this.db) {
      const room = this.memoryRooms.get(roomId);
      if (!room) throw new RoomServiceError(404, 'Room not found');
      const updated = applyCancel({ ...room, players: [...room.players] });
      this.memoryRooms.set(roomId, updated);
      emitRoomUpdated(updated);
      return updated;
    }

    return this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new RoomServiceError(404, 'Room not found');
      const room = snapshot.data() as RoomRecord;
      const updated = applyCancel(room);
      tx.set(ref, updated);
      return updated;
    }).then((updated) => {
      emitRoomUpdated(updated);
      return updated;
    });
  }

  // =========================================================================
  // Game lifecycle
  // =========================================================================

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
      if (!room) throw new RoomServiceError(404, 'Room not found');
      canStart(room);
      const prepared = this.prepareRound({ ...room, players: [...room.players] });
      this.memoryRooms.set(roomId, prepared);
      emitRoomUpdated(prepared);
      this.schedulePhaseTransition(roomId);
      return prepared;
    }

    return this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new RoomServiceError(404, 'Room not found');
      const room = snapshot.data() as RoomRecord;
      canStart(room);
      const prepared = this.prepareRound(room);
      tx.set(ref, prepared);
      return prepared;
    }).then((prepared) => {
      emitRoomUpdated(prepared);
      this.schedulePhaseTransition(roomId);
      return prepared;
    });
  }

  // =========================================================================
  // State helpers
  // =========================================================================

  private joinRoomState(room: RoomRecord, player: { id: string; name: string }): RoomRecord {
    if (room.players.find((p) => p.id === player.id)) return room;
    if (room.players.length >= room.maxPlayers) {
      throw new RoomServiceError(400, 'Room is full');
    }
    return {
      ...room,
      players: [...room.players, createPlayer(player.id, player.name, room.players.length)],
      updatedAt: Date.now(),
    };
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

    return {
      ...room,
      hostId,
      hostName,
      players: remainingPlayers,
      status: remainingPlayers.length === 0 ? 'waiting' : room.status,
      updatedAt: Date.now(),
      gameState: remainingPlayers.length === 0 ? undefined : room.gameState,
    };
  }

  /**
   * Deal cards and enter the 'blind' phase.
   */
  private prepareRound(room: RoomRecord): RoomRecord {
    const roundNumber = room.roundNumber + 1;
    const roomForDeal: RoomRecord = { ...room, roundNumber };
    const gameState = gameEngine.dealRound(roomForDeal);

    return {
      ...room,
      status: 'blind',
      roundNumber,
      gameState,
      updatedAt: Date.now(),
    };
  }

  /**
   * Advance to the next phase. If we're past the last trading phase, settle.
   */
  private advancePhase(room: RoomRecord): RoomRecord {
    const advanced = gameEngine.advancePhase(room);
    if (!advanced) {
      // Past last trading phase -- settle
      return this.finalizeRound(room);
    }

    return {
      ...room,
      status: advanced.phase as RoomStatus,
      gameState: advanced,
      updatedAt: Date.now(),
    };
  }

  private finalizeRound(room: RoomRecord): RoomRecord {
    const result = gameEngine.settleRound(room);
    return {
      ...room,
      status: 'finished',
      players: result.players,
      roundNumber: result.roundNumber,
      gameState: result.gameState,
      updatedAt: Date.now(),
    };
  }

  // =========================================================================
  // Phase timer chain
  // =========================================================================

  /**
   * Schedule the transition out of the current phase.
   *
   * Phase chain:
   *   blind (30s) -> flop (20s) -> turn (20s) -> settle -> next round (5s)
   */
  private schedulePhaseTransition(roomId: string) {
    const room = this.memoryRooms.get(roomId);
    const gs = room?.gameState;
    if (!gs) return;

    const currentPhase = gs.phase;
    const config = PHASE_SEQUENCE.find((p) => p.phase === currentPhase);
    if (!config) return;

    const delay = Math.max(1_000, gs.phaseEndsAt - Date.now());

    const timers = this.getTimers(roomId);
    if (timers.phase) clearTimeout(timers.phase);

    timers.phase = setTimeout(() => {
      this.handlePhaseExpiry(roomId).catch((error) => {
        console.error('Phase transition failed', error);
      });
    }, delay);
  }

  private async handlePhaseExpiry(roomId: string): Promise<void> {
    const timers = this.getTimers(roomId);
    if (timers.phase) {
      clearTimeout(timers.phase);
      timers.phase = undefined;
    }

    if (!this.db) {
      const room = this.memoryRooms.get(roomId);
      if (!room) return;
      const updated = this.advancePhase({ ...room, players: [...room.players] });
      this.memoryRooms.set(roomId, updated);
      emitRoomUpdated(updated);

      if (updated.status === 'finished') {
        this.scheduleNextRound(roomId, updated);
      } else {
        this.schedulePhaseTransition(roomId);
      }
      return;
    }

    const updated = await this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const room = snapshot.data() as RoomRecord;
      const result = this.advancePhase(room);
      tx.set(ref, result);
      return result;
    });

    if (updated) {
      emitRoomUpdated(updated);
      if (updated.status === 'finished') {
        this.scheduleNextRound(roomId, updated);
      } else {
        // For Firestore mode, read back and schedule
        this.schedulePhaseTransitionFirestore(roomId, updated);
      }
    }
  }

  /**
   * In Firestore mode, schedule based on the room record we already have.
   */
  private schedulePhaseTransitionFirestore(roomId: string, room: RoomRecord) {
    const gs = room.gameState;
    if (!gs) return;

    const config = PHASE_SEQUENCE.find((p) => p.phase === gs.phase);
    if (!config) return;

    const delay = Math.max(1_000, gs.phaseEndsAt - Date.now());
    const timers = this.getTimers(roomId);
    if (timers.phase) clearTimeout(timers.phase);

    timers.phase = setTimeout(() => {
      this.handlePhaseExpiry(roomId).catch((error) => {
        console.error('Phase transition failed', error);
      });
    }, delay);
  }

  private scheduleNextRound(roomId: string, room: RoomRecord) {
    if (room.players.length < 2) return;
    const timers = this.getTimers(roomId);
    if (timers.nextRound) clearTimeout(timers.nextRound);

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
      if (!room || room.players.length < 2) return room ?? null;
      const prepared = this.prepareRound({ ...room, players: [...room.players] });
      this.memoryRooms.set(roomId, prepared);
      emitRoomUpdated(prepared);
      this.schedulePhaseTransition(roomId);
      return prepared;
    }

    const prepared = await this.db.runTransaction(async (tx) => {
      const ref = this.db!.collection('rooms').doc(roomId);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const room = snapshot.data() as RoomRecord;
      if (room.players.length < 2) return room;
      const updated = this.prepareRound(room);
      tx.set(ref, updated);
      return updated;
    });

    if (prepared && prepared.gameState) {
      emitRoomUpdated(prepared);
      this.schedulePhaseTransitionFirestore(prepared.id, prepared);
    }
    return prepared;
  }

  // =========================================================================
  // Memory-mode helpers
  // =========================================================================

  private joinMemoryRoom(roomId: string, player: { id: string; name: string }): RoomRecord {
    const room = this.memoryRooms.get(roomId);
    if (!room) throw new RoomServiceError(404, 'Room not found');
    const updated = this.joinRoomState({ ...room, players: [...room.players] }, player);
    this.memoryRooms.set(roomId, updated);
    return updated;
  }

  private leaveMemoryRoom(roomId: string, playerId: string): RoomRecord {
    const room = this.memoryRooms.get(roomId);
    if (!room) throw new RoomServiceError(404, 'Room not found');
    const updated = this.leaveRoomState({ ...room, players: [...room.players] }, playerId);
    if (updated.players.length === 0) {
      this.memoryRooms.delete(roomId);
      this.clearTimers(roomId);
    } else {
      this.memoryRooms.set(roomId, updated);
    }
    return updated;
  }

  // =========================================================================
  // Timer management
  // =========================================================================

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
    if (!timers) return;
    if (timers.phase) clearTimeout(timers.phase);
    if (timers.nextRound) clearTimeout(timers.nextRound);
    this.timers.delete(roomId);
  }

  private async restoreActiveRounds() {
    if (!this.db) return;

    // Restore any rooms in active trading phases
    const phases: RoomStatus[] = ['blind', 'flop', 'turn'];
    for (const phase of phases) {
      const snapshot = await this.db.collection('rooms').where('status', '==', phase).get();
      const now = Date.now();
      snapshot.docs.forEach((doc) => {
        const room = doc.data() as RoomRecord;
        if (room.gameState?.phaseEndsAt && room.gameState.phaseEndsAt > now) {
          this.schedulePhaseTransitionFirestore(room.id, room);
        }
      });
    }
  }
}

import { SqliteRoomService } from './sqliteRoomService';

export const roomService = new SqliteRoomService();
