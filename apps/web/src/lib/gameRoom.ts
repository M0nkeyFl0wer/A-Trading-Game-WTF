import { io, Socket } from 'socket.io-client';
import { database } from './firebase';
import { ref, set, onValue, off, push, remove, onDisconnect } from 'firebase/database';
import { User } from 'firebase/auth';

export interface GameRoom {
  id: string;
  name: string;
  host: string;
  players: Record<string, PlayerInfo>;
  status: 'waiting' | 'playing' | 'finished';
  maxPlayers: number;
  createdAt: number;
  gameState?: GameState;
}

export interface PlayerInfo {
  uid: string;
  displayName: string;
  photoURL?: string;
  ready: boolean;
  connected: boolean;
  score?: number;
}

export interface GameState {
  round: number;
  currentTurn: string;
  deck: any[];
  table: any;
  trades: any[];
}

export class GameRoomManager {
  private socket: Socket | null = null;
  private currentRoom: string | null = null;
  private listeners: Map<string, any> = new Map();

  constructor(private user: User) {
    this.initializeSocket();
  }

  private initializeSocket() {
    const socketUrl = import.meta.env.VITE_WEBSOCKET_URL || 'ws://localhost:3001';
    this.socket = io(socketUrl, {
      auth: {
        uid: this.user.uid,
        displayName: this.user.displayName,
      },
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      console.log('Connected to game server');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from game server');
    });

    this.socket.on('gameUpdate', (gameState: GameState) => {
      if (this.currentRoom) {
        this.updateGameState(this.currentRoom, gameState);
      }
    });

    this.socket.on('playerJoined', (player: PlayerInfo) => {
      console.log('Player joined:', player);
    });

    this.socket.on('playerLeft', (playerId: string) => {
      console.log('Player left:', playerId);
    });
  }

  async createRoom(roomName: string, maxPlayers: number = 5): Promise<string> {
    const roomsRef = ref(database, 'rooms');
    const newRoomRef = push(roomsRef);
    const roomId = newRoomRef.key!;

    const room: GameRoom = {
      id: roomId,
      name: roomName,
      host: this.user.uid,
      players: {
        [this.user.uid]: {
          uid: this.user.uid,
          displayName: this.user.displayName || 'Anonymous',
          photoURL: this.user.photoURL || undefined,
          ready: false,
          connected: true,
        },
      },
      status: 'waiting',
      maxPlayers,
      createdAt: Date.now(),
    };

    await set(newRoomRef, room);
    this.currentRoom = roomId;
    this.socket?.emit('createRoom', roomId);

    // Set up disconnect handler
    const playerRef = ref(database, `rooms/${roomId}/players/${this.user.uid}`);
    onDisconnect(playerRef).update({ connected: false });

    return roomId;
  }

  async joinRoom(roomId: string): Promise<void> {
    const roomRef = ref(database, `rooms/${roomId}`);

    return new Promise((resolve, reject) => {
      onValue(roomRef, async (snapshot) => {
        const room = snapshot.val() as GameRoom;

        if (!room) {
          reject(new Error('Room not found'));
          return;
        }

        if (Object.keys(room.players).length >= room.maxPlayers) {
          reject(new Error('Room is full'));
          return;
        }

        if (room.status !== 'waiting') {
          reject(new Error('Game already started'));
          return;
        }

        // Add player to room
        const playerRef = ref(database, `rooms/${roomId}/players/${this.user.uid}`);
        await set(playerRef, {
          uid: this.user.uid,
          displayName: this.user.displayName || 'Anonymous',
          photoURL: this.user.photoURL || undefined,
          ready: false,
          connected: true,
        });

        this.currentRoom = roomId;
        this.socket?.emit('joinRoom', roomId);

        // Set up disconnect handler
        onDisconnect(playerRef).update({ connected: false });

        resolve();
      }, { onlyOnce: true });
    });
  }

  async leaveRoom(): Promise<void> {
    if (!this.currentRoom) return;

    const playerRef = ref(database, `rooms/${this.currentRoom}/players/${this.user.uid}`);
    await remove(playerRef);

    this.socket?.emit('leaveRoom', this.currentRoom);
    this.currentRoom = null;
  }

  async toggleReady(): Promise<void> {
    if (!this.currentRoom) return;

    const playerRef = ref(database, `rooms/${this.currentRoom}/players/${this.user.uid}/ready`);
    const snapshot = await new Promise<boolean>((resolve) => {
      onValue(playerRef, (snap) => {
        resolve(snap.val() as boolean);
      }, { onlyOnce: true });
    });

    await set(playerRef, !snapshot);
  }

  async startGame(): Promise<void> {
    if (!this.currentRoom) return;

    const roomRef = ref(database, `rooms/${this.currentRoom}`);
    await set(ref(database, `rooms/${this.currentRoom}/status`), 'playing');

    this.socket?.emit('startGame', this.currentRoom);
  }

  subscribeToRoom(roomId: string, callback: (room: GameRoom | null) => void): () => void {
    const roomRef = ref(database, `rooms/${roomId}`);
    const listener = onValue(roomRef, (snapshot) => {
      callback(snapshot.val() as GameRoom | null);
    });

    this.listeners.set(roomId, listener);

    return () => {
      off(roomRef, listener);
      this.listeners.delete(roomId);
    };
  }

  async getRooms(): Promise<GameRoom[]> {
    const roomsRef = ref(database, 'rooms');

    return new Promise((resolve) => {
      onValue(roomsRef, (snapshot) => {
        const rooms = snapshot.val() || {};
        const roomList = Object.values(rooms) as GameRoom[];
        resolve(roomList.filter(room => room.status === 'waiting'));
      }, { onlyOnce: true });
    });
  }

  private async updateGameState(roomId: string, gameState: GameState) {
    const gameStateRef = ref(database, `rooms/${roomId}/gameState`);
    await set(gameStateRef, gameState);
  }

  disconnect() {
    this.socket?.disconnect();
    this.listeners.forEach((listener, roomId) => {
      const roomRef = ref(database, `rooms/${roomId}`);
      off(roomRef, listener);
    });
    this.listeners.clear();
  }
}