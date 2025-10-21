import { useCallback, useEffect, useMemo, useState } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { sanitizeInput } from '../lib/security';
import { auth } from '../lib/firebase';

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

const normaliseFromApi = (payload: any): LobbyTableSummary[] => {
  if (!Array.isArray(payload)) return OFFLINE_TABLES;

  return payload
    .map((table) => ({
      id: sanitizeInput(String(table?.id ?? generateId())),
      name: sanitizeInput(String(table?.name ?? 'Untitled table')),
      host: sanitizeInput(String(table?.host ?? 'Dealer')),
      players: Math.max(0, Math.min(8, Number(table?.players ?? 0))),
      capacity: Math.max(1, Math.min(8, Number(table?.capacity ?? 6))),
      stakes: sanitizeInput(String(table?.stakes ?? 'Tick 1')),
      phase: (['waiting', 'playing', 'finished'] as LobbyTablePhase[]).includes(table?.phase)
        ? (table.phase as LobbyTablePhase)
        : 'waiting',
      avgTurnSeconds: Math.max(10, Math.min(240, Number(table?.avgTurnSeconds ?? 45))),
      voiceEnabled: Boolean(table?.voiceEnabled ?? true),
      tags: Array.isArray(table?.tags)
        ? table.tags.map((tag: string) => sanitizeInput(String(tag))).slice(0, 4)
        : [],
      createdAt: new Date(table?.createdAt ?? Date.now()).toISOString(),
    }))
    .slice(0, 6);
};

export const useLobbyTables = () => {
  const [tables, setTables] = useState<LobbyTableSummary[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

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
      const headers: HeadersInit = {};

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch('/api/room/list', {
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

  const stats = useMemo(() => {
    if (!tables.length) return null;

    const waiting = tables.filter(table => table.phase === 'waiting').length;
    const playing = tables.filter(table => table.phase === 'playing').length;

    return { waiting, playing };
  }, [tables]);

  return {
    tables,
    status,
    error,
    stats,
    refresh: () => loadTables(),
  };
};
