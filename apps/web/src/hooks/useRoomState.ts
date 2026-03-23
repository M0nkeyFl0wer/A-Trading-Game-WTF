import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Order, MatchedTrade, TradingPhase } from '@trading-game/shared';
import { sanitizeInput } from '../lib/security';
import { useAuth } from '../contexts/AuthContext';
import {
  useGameStore,
  type PlayerState,
  type GamePhase,
} from '../store';

type HookStatus = 'idle' | 'loading' | 'ready' | 'error';

interface NormalizedRoom {
  id: string;
  name: string;
  status: string;
  hostName: string;
  hostId?: string;
  maxPlayers: number;
  players: PlayerState[];
  updatedAt: number;
  roundNumber?: number;
  phaseEndsAt?: number;
}

const statusToPhaseMap: Record<string, GamePhase> = {
  idle: 'idle',
  waiting: 'waiting',
  starting: 'starting',
  blind: 'playing',
  flop: 'playing',
  turn: 'playing',
  playing: 'playing',
  finished: 'finished',
};

const statusToTradingPhase: Record<string, TradingPhase | 'waiting' | 'finished' | null> = {
  idle: null,
  waiting: 'waiting',
  starting: null,
  blind: 'blind',
  flop: 'flop',
  turn: 'turn',
  playing: null,
  finished: 'finished',
};

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const WS_BASE = (import.meta.env.VITE_WEBSOCKET_URL || '').replace(/\/$/, '');

const buildRoomUrl = (roomId: string): string => {
  const prefix = API_BASE ? `${API_BASE}` : '';
  return `${prefix}/api/room/${encodeURIComponent(roomId)}`;
};

const buildSocketUrl = (): string | null => {
  if (WS_BASE) return WS_BASE;
  if (typeof window !== 'undefined') {
    return window.location.origin.replace(/^http/, 'ws');
  }
  return null;
};

const mapStatusToPhase = (status?: string): GamePhase =>
  statusToPhaseMap[status || 'idle'] ?? 'idle';

const mapStatusToTradingPhase = (status?: string): TradingPhase | 'waiting' | 'finished' | null =>
  statusToTradingPhase[status || 'idle'] ?? null;

const normalizePlayers = (
  players: unknown,
  hostName: string,
): PlayerState[] => {
  if (!players) {
    return [];
  }

  const list = Array.isArray(players)
    ? players
    : typeof players === 'object'
    ? Object.values(players as Record<string, unknown>)
    : [];

  return list.map((raw, index) => {
    const entry = raw as Record<string, unknown>;
    const character = typeof entry.character === 'string'
      ? (entry.character as PlayerState['character'])
      : (['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'] as PlayerState['character'][])[index % 5];
    const id = sanitizeInput(String(entry.id ?? `player-${index}`));

    return {
      id,
      name: sanitizeInput(String(entry.name ?? hostName ?? `Trader ${index + 1}`)),
      balance: Number(entry.balance ?? 1000),
      character,
      isBot: Boolean(entry.isBot),
      isWinner: Boolean(entry.isWinner),
      cardValue: typeof entry.cardValue === 'number' ? Number(entry.cardValue) : undefined,
    } satisfies PlayerState;
  });
};

const normalizeRoom = (payload: any): NormalizedRoom | null => {
  if (!payload) return null;
  const hostName = sanitizeInput(String(payload.hostName ?? 'Dealer'));
  return {
    id: sanitizeInput(String(payload.id ?? 'room')),
    name: sanitizeInput(String(payload.name ?? 'Trading Table')),
    status: sanitizeInput(String(payload.status ?? 'waiting')),
    hostName,
    hostId: payload.hostId ? sanitizeInput(String(payload.hostId)) : undefined,
    maxPlayers: Number(payload.maxPlayers ?? 6),
    players: normalizePlayers(payload.players, hostName),
    updatedAt: Number(payload.updatedAt ?? Date.now()),
    roundNumber: Number(payload.roundNumber ?? payload.gameState?.roundNumber ?? 0) || undefined,
    phaseEndsAt: payload.gameState?.phaseEndsAt
      ? Number(payload.gameState.phaseEndsAt)
      : payload.roundEndsAt
      ? Number(payload.roundEndsAt)
      : undefined,
  };
};

export function useRoomState(roomId?: string) {
  const { currentUser } = useAuth();
  const [room, setRoom] = useState<NormalizedRoom | null>(null);
  const [status, setStatus] = useState<HookStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const setPlayers = useGameStore((state) => state.setPlayers);
  const setGamePhase = useGameStore((state) => state.setGamePhase);
  const setRoundNumber = useGameStore((state) => state.setRoundNumber);
  const setTradingPhase = useGameStore((state) => state.setTradingPhase);
  const setOrders = useGameStore((state) => state.setOrders);
  const setMatchedTrades = useGameStore((state) => state.setMatchedTrades);
  const setRevealedCommunityCards = useGameStore((state) => state.setRevealedCommunityCards);
  const setPhaseEndsAt = useGameStore((state) => state.setPhaseEndsAt);
  const setMyCard = useGameStore((state) => state.setMyCard);
  const setSettlement = useGameStore((state) => state.setSettlement);
  const setCommentary = useGameStore((state) => state.setCommentary);

  const updateRoomState = useCallback((payload: any) => {
    const normalized = normalizeRoom(payload);
    if (!normalized) return;

    setRoom(normalized);
    setGamePhase(mapStatusToPhase(normalized.status));
    setTradingPhase(mapStatusToTradingPhase(normalized.status));

    if (normalized.roundNumber) {
      setRoundNumber(normalized.roundNumber);
    }
    if (normalized.phaseEndsAt) {
      setPhaseEndsAt(normalized.phaseEndsAt);
    }

    // Extract order book data from gameState and merge card values into players
    const gs = payload?.gameState;
    let playersToSet = normalized.players;

    if (gs) {
      if (Array.isArray(gs.orders)) {
        setOrders(gs.orders as Order[]);
      }
      if (Array.isArray(gs.matchedTrades)) {
        setMatchedTrades(gs.matchedTrades as MatchedTrade[]);
      }
      if (Array.isArray(gs.revealedCommunityCards)) {
        setRevealedCommunityCards(gs.revealedCommunityCards as number[]);
      }

      // Merge card values from gameState.playerCards into player states
      if (Array.isArray(gs.playerCards)) {
        const cardMap = new Map<string, { value: number; revealed: boolean }>();
        for (const pc of gs.playerCards) {
          if (pc?.id) {
            cardMap.set(String(pc.id), {
              value: Number(pc.value ?? 0),
              revealed: Boolean(pc.revealed),
            });
          }
        }
        if (cardMap.size > 0) {
          playersToSet = normalized.players.map((p) => {
            const card = cardMap.get(p.id);
            return card
              ? { ...p, cardValue: card.value, cardRevealed: card.revealed }
              : p;
          });
        }

        // Find own card value from playerCards
        if (currentUser) {
          const myEntry = gs.playerCards.find(
            (c: any) => c?.id === currentUser.uid,
          );
          if (myEntry && typeof myEntry.value === 'number') {
            setMyCard(myEntry.value);
          } else {
            setMyCard(null);
          }
        }
      }

      // Settlement data
      if (gs.settlementTotal != null || gs.pnl != null) {
        setSettlement(
          gs.settlementTotal != null ? Number(gs.settlementTotal) : null,
          gs.pnl ?? null,
        );
      }
    }

    setPlayers(playersToSet);

    // Extract commentary from the payload (injected by the server)
    if (Array.isArray(payload?.commentary) && payload.commentary.length > 0) {
      setCommentary(payload.commentary);
    }
  }, [
    currentUser, setPlayers, setGamePhase, setRoundNumber, setTradingPhase,
    setOrders, setMatchedTrades, setRevealedCommunityCards, setPhaseEndsAt,
    setMyCard, setSettlement, setCommentary,
  ]);

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const loadRoom = async () => {
      setStatus('loading');
      setError(null);
      try {
        const headers: HeadersInit = {};
        if (currentUser) {
          const token = await currentUser.getIdToken();
          headers.Authorization = `Bearer ${token}`;
        }
        const response = await fetch(buildRoomUrl(roomId), {
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(response.status === 404 ? 'Room not found' : 'Unable to load room');
        }
        const payload = await response.json();
        if (!cancelled) {
          updateRoomState(payload);
          setStatus('ready');
        }
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError' || cancelled) {
          return;
        }
        console.error('Failed to load room', err);
        setError(err instanceof Error ? err.message : 'Unable to load room');
        setStatus('error');
      }
    };

    loadRoom();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roomId, currentUser, updateRoomState]);

  useEffect(() => {
    if (!roomId || !currentUser) {
      return () => {};
    }

    let active = true;
    const socketUrl = buildSocketUrl();
    if (!socketUrl) {
      return () => {};
    }

    const connect = async () => {
      try {
        const token = await currentUser.getIdToken();
        if (!active) return;
        const socket = io(socketUrl, {
          transports: ['websocket'],
          auth: { token },
        });
        socketRef.current = socket;

        socket.on('rooms:update', (payload) => {
          if (payload?.id === roomId) {
            updateRoomState(payload);
          }
        });

        socket.on('rooms:removed', (payload) => {
          if (payload?.id === roomId) {
            setError('Room is no longer available');
            setStatus('error');
          }
        });

        socket.emit('join-room', roomId);
      } catch (err) {
        console.warn('Lobby socket connection failed', err);
      }
    };

    connect();

    return () => {
      active = false;
      if (socketRef.current) {
        socketRef.current.emit('leave-room', roomId);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomId, currentUser, updateRoomState]);

  return { room, status, error };
}
