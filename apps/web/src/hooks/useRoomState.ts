import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Order, MatchedTrade, QuoteRequest, TradingPhase } from '@trading-game/shared';
import { sanitizeInput } from '../lib/security';
import { authHeaders } from '../lib/devIdentity';
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
  const setConsensus = useGameStore((state) => state.setConsensus);
  const setSettlement = useGameStore((state) => state.setSettlement);
  const setCommentary = useGameStore((state) => state.setCommentary);
  const setQuotes = useGameStore((state) => state.setQuotes);

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
      // Consensus is the aggregate market belief the server maintains (#23).
      // It may be absent on rooms dealt before the field existed -> null.
      setConsensus(typeof gs.consensus === 'number' ? gs.consensus : null);
      if (Array.isArray(gs.quotes)) {
        setQuotes(gs.quotes as QuoteRequest[]);
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
    setMyCard, setConsensus, setSettlement, setCommentary, setQuotes,
  ]);

  /**
   * Fetch the authoritative room snapshot over HTTP and push it into the store.
   *
   * This is the heart of refresh/reconnect recovery (issue #47): GET
   * /api/room/:id returns the current phase, the player's own card, the order
   * book, and any open quotes -- everything the floor UI needs to render the
   * exact table the player was looking at before the page reloaded. It carries
   * the dev-identity token via `authHeaders`, so the same `dev:<uid>` seat is
   * restored (an X-Dev-User-Id header, never a Bearer -- see lib/devIdentity).
   *
   * Shared by two callers so refresh AND a mid-round socket reconnect run the
   * same recovery:
   *   - the mount effect below (initial load; passes an AbortSignal so an
   *     unmount mid-flight can't write stale state),
   *   - the socket effect's reconnect handler (passes `silent` so a background
   *     catch-up doesn't blank the table by flipping status back to 'loading').
   */
  const refetchRoom = useCallback(
    async (opts: { signal?: AbortSignal; silent?: boolean } = {}) => {
      if (!roomId) return;
      if (!opts.silent) {
        setStatus('loading');
        setError(null);
      }
      const headers: Record<string, string> = currentUser
        ? authHeaders(await currentUser.getIdToken())
        : {};
      const response = await fetch(buildRoomUrl(roomId), {
        headers,
        signal: opts.signal,
      });
      if (!response.ok) {
        throw new Error(response.status === 404 ? 'Room not found' : 'Unable to load room');
      }
      const payload = await response.json();
      // The fetch resolved after an unmount/roomId change: drop the result
      // rather than writing it into a store that now belongs to another room.
      if (opts.signal?.aborted) return;
      updateRoomState(payload);
      setStatus('ready');
    },
    [roomId, currentUser, updateRoomState],
  );

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      return;
    }

    const controller = new AbortController();

    refetchRoom({ signal: controller.signal }).catch((err) => {
      if ((err as DOMException)?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.error('Failed to load room', err);
      setError(err instanceof Error ? err.message : 'Unable to load room');
      setStatus('error');
    });

    return () => {
      controller.abort();
    };
  }, [roomId, refetchRoom]);

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

        // Emit `join-room` on EVERY (re)connect, not just the first (issue #47).
        // socket.io reconnects on its own after a network blip, a tunnel
        // hiccup, or a laptop waking from sleep. Each reconnection is a BRAND
        // NEW server-side socket that has joined no room, so the server won't
        // deliver `rooms:update` to it until it hears `join-room` again. The
        // old code emitted join-room once, imperatively, so after any reconnect
        // the table would silently freeze while looking connected. `connect`
        // fires on the initial connection and on every successful reconnection,
        // which is exactly the hook we want for re-joining.
        let hasConnectedBefore = false;
        socket.on('connect', () => {
          socket.emit('join-room', roomId);
          // On a RE-connection (not the very first connect, which the mount
          // effect's fetch already covered), pull the authoritative snapshot
          // over HTTP so any phase/card/quote changes that happened while we
          // were offline are restored -- the same recovery a full page refresh
          // performs. `silent` keeps the visible table in place during catch-up.
          if (hasConnectedBefore) {
            refetchRoom({ silent: true }).catch((err) =>
              console.warn('Reconnect refetch failed', err),
            );
          }
          hasConnectedBefore = true;
        });

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
  }, [roomId, currentUser, updateRoomState, refetchRoom]);

  return { room, status, error };
}
