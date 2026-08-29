import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { sanitizeInput } from '../lib/security';
import { auth, isDevAuth } from '../lib/firebase';
import { getDevUserId, devIdToken, authHeaders } from '../lib/devIdentity';
import { io, Socket } from 'socket.io-client';

export type LobbyTablePhase = 'waiting' | 'playing' | 'finished';

export interface LobbyTableSummary {
  id: string;
  name: string;
  host: string;
  players: number;
  capacity: number;
  stakes: string;
  phase: LobbyTablePhase;
  avgTurnSeconds: number;
  voiceEnabled: boolean;
  tags: string[];
  createdAt: string;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

const generateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `table-${Math.random().toString(36).slice(2, 10)}`;

const OFFLINE_TABLES: LobbyTableSummary[] = [
  {
    id: 'alpha',
    name: 'Alpha Exchange',
    host: 'Dealer',
    players: 2,
    capacity: 5,
    stakes: 'Low stakes · Tick 1',
    phase: 'waiting',
    avgTurnSeconds: 42,
    voiceEnabled: true,
    tags: ['Beginner friendly', 'Voice enabled'],
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
  },
  {
    id: 'luna',
    name: 'Luna Bulls',
    host: 'Bull Runner',
    players: 4,
    capacity: 6,
    stakes: 'Mid stakes · Tick 5',
    phase: 'playing',
    avgTurnSeconds: 28,
    voiceEnabled: true,
    tags: ['Momentum play', 'Fast pace'],
    createdAt: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
  },
  {
    id: 'deep-blue',
    name: 'Deep Blue Desk',
    host: 'The Whale',
    players: 3,
    capacity: 4,
    stakes: 'High stakes · Tick 10',
    phase: 'waiting',
    avgTurnSeconds: 65,
    voiceEnabled: false,
    tags: ['Invite only', 'Manual voice'],
    createdAt: new Date(Date.now() - 1000 * 60 * 32).toISOString(),
  },
];

const stakesFromRoom = (room: any): string => {
  const capacity = Number(room?.maxPlayers ?? 6);
  if (capacity >= 7) return 'High stakes · Tick 10';
  if (capacity >= 5) return 'Mid stakes · Tick 5';
  return 'Low stakes · Tick 1';
};

const normalizeRoom = (table: any): LobbyTableSummary | null => {
  if (!table) return null;

  const playerCount = (() => {
    if (Array.isArray(table?.players)) {
      return table.players.length;
    }
    if (table?.players && typeof table.players === 'object') {
      return Object.keys(table.players).length;
    }
    return Number(table?.players ?? 0);
  })();

  return {
    id: sanitizeInput(String(table?.id ?? generateId())),
    name: sanitizeInput(String(table?.name ?? 'Untitled table')),
    host: sanitizeInput(String(table?.hostName ?? table?.host ?? 'Dealer')),
    players: Math.max(0, Math.min(8, Number(playerCount))),
    capacity: Math.max(1, Math.min(8, Number(table?.maxPlayers ?? table?.capacity ?? 6))),
    stakes: sanitizeInput(String(table?.stakes ?? stakesFromRoom(table))),
    phase: (['waiting', 'playing', 'finished'] as LobbyTablePhase[]).includes(table?.status)
      ? (table.status as LobbyTablePhase)
      : 'waiting',
    avgTurnSeconds: Math.max(10, Math.min(240, Number(table?.avgTurnSeconds ?? 45))),
    voiceEnabled: Boolean(table?.voiceEnabled ?? true),
    tags: Array.isArray(table?.tags)
      ? table.tags.map((tag: string) => sanitizeInput(String(tag))).slice(0, 4)
      : [],
    createdAt: new Date(table?.createdAt ?? Date.now()).toISOString(),
  };
};

const normaliseFromApi = (payload: any): LobbyTableSummary[] => {
  const rooms = Array.isArray(payload?.rooms)
    ? payload.rooms
    : Array.isArray(payload)
      ? payload
      : [];

  const normalised = rooms
    .map(normalizeRoom)
    .filter(Boolean) as LobbyTableSummary[];

  return normalised.length ? normalised.slice(0, 12) : OFFLINE_TABLES;
};

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const ROOMS_ENDPOINT = API_BASE ? `${API_BASE}/api/rooms` : '/api/rooms';
const WS_BASE = (import.meta.env.VITE_WEBSOCKET_URL || '').replace(/\/$/, '');

export const useLobbyTables = () => {
  const [tables, setTables] = useState<LobbyTableSummary[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // In dev auth mode there is no Firebase token to wait for: use the
    // per-browser `dev:<uid>` token straight away. Same uid as AuthContext's
    // dev user, so the lobby socket and the table socket are one identity.
    if (isDevAuth) {
      setAuthToken(devIdToken(getDevUserId()));
      return;
    }

    // Without Firebase auth instance, there's nothing to subscribe to.
    if (!auth) return;

    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (user) {
        try {
          const token = await user.getIdToken();
          setAuthToken(token);
        } catch (tokenError) {
          console.warn('Unable to fetch auth token for lobby request', tokenError);
          setAuthToken(null);
        }
      } else {
        setAuthToken(null);
      }
    });

    return () => unsubscribe();
  }, []);

  const updateFromRoom = useCallback((room: any) => {
    const normalized = normalizeRoom(room);
    if (!normalized) {
      return;
    }

    setTables((prev) => {
      const existingIdx = prev.findIndex((table) => table.id === normalized.id);
      // If a socket payload omits createdAt, normalizeRoom stamps Date.now(), which
      // would shuffle the list on every event. Keep the createdAt we already know.
      const merged = existingIdx >= 0 && !room?.createdAt
        ? { ...normalized, createdAt: prev[existingIdx].createdAt }
        : normalized;
      const next = existingIdx >= 0 ? [...prev] : [...prev, merged];
      next[existingIdx >= 0 ? existingIdx : next.length - 1] = merged;
      return next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });
  }, []);

  const removeRoomById = useCallback((roomId: string) => {
    setTables((prev) => prev.filter((table) => table.id !== roomId));
  }, []);

  const loadTables = useCallback(async (signal?: AbortSignal) => {
    if (status === 'loading') return;

    setStatus('loading');
    setError(null);

    const useOffline = (message?: string) => {
      setTables(OFFLINE_TABLES);
      setStatus('ready');
      setError(message ?? 'Using cached lobby data while we connect to the server.');
    };

    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      useOffline();
      return;
    }

    try {
      // authHeaders() picks Bearer vs X-Dev-User-* (see lib/devIdentity.ts).
      const headers: Record<string, string> = authHeaders(authToken);

      const response = await fetch(ROOMS_ENDPOINT, {
        signal,
        headers,
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 401) {
          useOffline('Sign in to view live tables. Showing preview data.');
          return;
        }
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = await response.json();
      const normalised = normaliseFromApi(payload);

      setTables(normalised.length ? normalised : OFFLINE_TABLES);
      setStatus('ready');
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        return;
      }
      console.warn('Lobby tables request fell back to offline cache', err);
      useOffline('Unable to connect to the lobby service. Showing preview tables.');
    }
  }, [status, authToken]);

  useEffect(() => {
    const controller = new AbortController();
    loadTables(controller.signal);

    const refreshInterval = window?.setInterval
      ? window.setInterval(() => loadTables(controller.signal), 30_000)
      : null;

    return () => {
      controller.abort();
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [loadTables]);

  useEffect(() => {
    const socketUrl = WS_BASE || (typeof window !== 'undefined' ? window.location.origin : '');

    if (!authToken || !socketUrl) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io(socketUrl, {
      transports: ['websocket'],
      auth: { token: authToken },
    });

    // 'rooms:update' is only delivered to sockets that joined a room, so for the
    // lobby it is effectively dead. The server broadcasts 'rooms:lobby-update'
    // to every socket on any room change -- that is what keeps the lobby live (#12).
    socket.on('rooms:update', updateFromRoom);
    socket.on('rooms:lobby-update', updateFromRoom);
    socket.on('rooms:removed', (payload: { id: string }) => {
      if (payload?.id) {
        removeRoomById(payload.id);
      }
    });
    socket.on('connect_error', (err) => {
      console.warn('Lobby socket connection failed', err);
    });

    socketRef.current = socket;

    return () => {
      socket.off('rooms:update', updateFromRoom);
      socket.off('rooms:lobby-update', updateFromRoom);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [authToken, updateFromRoom, removeRoomById]);

  const stats = useMemo(() => {
    if (!tables.length) return null;

    const waiting = tables.filter(table => table.phase === 'waiting').length;
    const playing = tables.filter(table => table.phase === 'playing').length;

    return { waiting, playing };
  }, [tables]);

  const refreshLobby = useCallback(() => loadTables(), [loadTables]);

  return {
    tables,
    status,
    error,
    stats,
    refresh: refreshLobby,
  };
};
