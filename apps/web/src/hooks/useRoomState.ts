import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { sanitizeInput } from "../lib/security";
import { useAuth } from "../contexts/AuthContext";
import { useGameStore, type PlayerState, type GamePhase } from "../store";

interface NormalizedRoom {
  id: string;
  name: string;
  status: string;
  hostName: string;
  maxPlayers: number;
  players: PlayerState[];
  updatedAt: number;
}

type HookStatus = "idle" | "loading" | "ready" | "error";

const CHARACTER_ROTATION: PlayerState["character"][] = [
  "DEALER",
  "BULL",
  "BEAR",
  "WHALE",
  "ROOKIE",
];

const statusToPhaseMap: Record<string, GamePhase> = {
  idle: "idle",
  waiting: "waiting",
  starting: "starting",
  playing: "playing",
  revealing: "revealing",
  finished: "finished",
};

const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const WS_BASE = (import.meta.env.VITE_WEBSOCKET_URL || "").replace(/\/$/, "");

const buildRoomUrl = (roomId: string): string => {
  const prefix = API_BASE ? `${API_BASE}` : "";
  return `${prefix}/api/room/${encodeURIComponent(roomId)}`;
};

const buildSocketUrl = (): string | null => {
  if (WS_BASE) return WS_BASE;
  if (typeof window !== "undefined") {
    return window.location.origin.replace(/^http/, "ws");
  }
  return null;
};

const mapStatusToPhase = (status?: string): GamePhase =>
  statusToPhaseMap[status || "idle"] ?? "idle";

const assignCharacter = (index: number): PlayerState["character"] =>
  CHARACTER_ROTATION[index % CHARACTER_ROTATION.length];

const normalizePlayers = (players: unknown, hostName: string): PlayerState[] => {
  if (!players) {
    return [];
  }

  const list = Array.isArray(players)
    ? players
    : typeof players === "object"
    ? Object.values(players as Record<string, unknown>)
    : [];

  return list.map((raw, index) => {
    const entry = raw as Record<string, unknown>;
    return {
      id: sanitizeInput(String(entry.id ?? `player-${index}`)),
      name: sanitizeInput(String(entry.name ?? hostName ?? `Trader ${index + 1}`)),
      balance: Number(entry.balance ?? 1000),
      character: assignCharacter(index),
      isBot: Boolean(entry.isBot),
      isWinner: Boolean(entry.isWinner),
    } satisfies PlayerState;
  });
};

const normalizeRoom = (payload: any): NormalizedRoom | null => {
  if (!payload) return null;
  const hostName = sanitizeInput(String(payload.hostName ?? "Dealer"));
  return {
    id: sanitizeInput(String(payload.id ?? "room")),
    name: sanitizeInput(String(payload.name ?? "Trading Table")),
    status: sanitizeInput(String(payload.status ?? "waiting")),
    hostName,
    maxPlayers: Number(payload.maxPlayers ?? 6),
    players: normalizePlayers(payload.players, hostName),
    updatedAt: Number(payload.updatedAt ?? Date.now()),
  };
};

export function useRoomState(roomId?: string) {
  const { currentUser } = useAuth();
  const [room, setRoom] = useState<NormalizedRoom | null>(null);
  const [status, setStatus] = useState<HookStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const setPlayers = useGameStore(state => state.setPlayers);
  const setGamePhase = useGameStore(state => state.setGamePhase);

  const updateRoomState = useCallback((payload: any) => {
    const normalized = normalizeRoom(payload);
    if (!normalized) return;
    setRoom(normalized);
    setPlayers(normalized.players);
    setGamePhase(mapStatusToPhase(normalized.status));
  }, [setPlayers, setGamePhase]);

  useEffect(() => {
    if (!roomId) {
      setRoom(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const loadRoom = async () => {
      setStatus("loading");
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
          throw new Error(response.status === 404 ? Room not found : Unable to load room);
        }
        const payload = await response.json();
        if (!cancelled) {
          updateRoomState(payload);
          setStatus("ready");
        }
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError" || cancelled) {
          return;
        }
        console.error(Failed to load room, err);
        setError(err instanceof Error ? err.message : Unable to load room);
        setStatus("error");
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
          transports: [websocket],
          auth: { token },
        });
        socketRef.current = socket;

        socket.on(rooms:update, (payload) => {
          if (payload?.id === roomId) {
            updateRoomState(payload);
          }
        });

        socket.on(rooms:removed, (payload) => {
          if (payload?.id === roomId) {
            setError(Room is no longer available);
            setStatus(error);
          }
        });

        socket.emit(join-room, roomId);
      } catch (err) {
        console.warn(Room socket connection failed, err);
      }
    };

    connect();

    return () => {
      active = false;
      if (socketRef.current) {
        socketRef.current.emit(leave-room, roomId);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomId, currentUser, updateRoomState]);

  return { room, status, error };
}
