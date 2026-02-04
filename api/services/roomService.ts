import type { Firestore } from 'firebase-admin/firestore';
import { getFirestoreInstance } from '../lib/firebaseAdmin';
import { emitRoomUpdated, emitRoomRemoved } from '../lib/roomEvents';

export type RoomStatus = 'waiting' | 'playing' | 'starting';

export interface RoomPlayer {
  id: string;
  name: string;
  joinedAt: number;
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
}

export class RoomServiceError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RoomServiceError';
  }
}

const createRoomId = () => `room_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export class RoomService {
  private memoryRooms = new Map<string, RoomRecord>();
  private db: Firestore | null;

  constructor(firestore: Firestore | null) {
    this.db = firestore;
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
    const room: RoomRecord = {
      id: createRoomId(),
      name,
      maxPlayers,
      hostId,
      hostName,
      status: 'waiting',
      players: [
        {
          id: hostId,
          name: hostName,
          joinedAt: Date.now(),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
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

  async joinRoom(roomId: string, player: RoomPlayer): Promise<RoomRecord> {
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
      } else {
        tx.set(ref, updated);
        emitRoomUpdated(updated);
      }
      return updated;
    });
  }

  async startRoom(roomId: string, requesterId: string): Promise<RoomRecord> {
    const updateState = (room: RoomRecord): RoomRecord => {
      if (room.hostId !== requesterId) {
        throw new RoomServiceError(403, 'Only the host can start the game');
      }
      if (room.players.length < 2) {
        throw new RoomServiceError(400, 'At least two players required to start');
      }
      room.status = 'starting';
      room.updatedAt = Date.now();
      return room;
    };

    if (!this.db) {
      const room = this.memoryRooms.get(roomId);
      if (!room) {
        throw new RoomServiceError(404, 'Room not found');
      }
      const updated = updateState({ ...room, players: [...room.players] });
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
      const updated = updateState(room);
      tx.set(ref, updated);
      emitRoomUpdated(updated);
      return updated;
    });
  }

  private joinRoomState(room: RoomRecord, player: RoomPlayer): RoomRecord {
    if (room.players.find((p) => p.id === player.id)) {
      return room;
    }

    if (room.players.length >= room.maxPlayers) {
      throw new RoomServiceError(400, 'Room is full');
    }

    const updated: RoomRecord = {
      ...room,
      players: [...room.players, player],
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
    };

    return updated;
  }

  private joinMemoryRoom(roomId: string, player: RoomPlayer): RoomRecord {
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
    } else {
      this.memoryRooms.set(roomId, updated);
    }
    return updated;
  }
}

const firestore = getFirestoreInstance();
export const roomService = new RoomService(firestore);
