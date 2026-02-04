import create from 'zustand';
import { Round } from '@trading-game/core';
import { DEFAULT_DECK } from '@trading-game/shared';
import type { CharacterType } from './lib/characterVisuals';
import { voiceService } from './lib/elevenlabs';

type GamePhase = 'idle' | 'waiting' | 'starting' | 'playing' | 'revealing' | 'finished';

export interface PlayerState {
  id: string;
  name: string;
  balance: number;
  character: CharacterType;
  isBot?: boolean;
  isWinner?: boolean;
}

export interface TradeEvent {
  id: string;
  player: string;
  counterparty: string;
  quantity: number;
  price: number;
  value: number;
  type: 'buy' | 'sell';
  timestamp: number;
  note?: string;
}

export type LastAction =
  | { type: 'trade'; player: string; value: number }
  | { type: 'fold'; player: string }
  | { type: 'reveal'; player?: string }
  | { type: 'win_round'; player: string; value?: number };

interface TradePayload extends Partial<Pick<TradeEvent, 'id' | 'timestamp' | 'note' | 'value'>> {
  player: string;
  counterparty: string;
  quantity: number;
  price: number;
  type: 'buy' | 'sell';
}

interface GameState {
  round: Round | null;
  roundNumber: number;
  gamePhase: GamePhase;
  players: PlayerState[];
  trades: TradeEvent[];
  lastAction: LastAction | null;
  // Voice and character state
  character: CharacterType;
  isVoiceEnabled: boolean;
  volume: number;
  // Game actions
  startRound: () => void;
  endRound: (winnerId?: string) => void;
  resetGame: () => void;
  setGamePhase: (phase: GamePhase) => void;
  setPlayers: (players: PlayerState[]) => void;
  recordTrade: (trade: TradePayload) => void;
  setTrades: (trades: TradeEvent[]) => void;
  setLastAction: (action: LastAction | null) => void;
  // Voice actions
  setCharacter: (character: CharacterType) => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
  setRoundNumber: (round: number) => void;
}

const defaultPlayers: PlayerState[] = [
  { id: 'player-you', name: 'You', balance: 1_000, character: 'DEALER' },
  { id: 'bot-bull', name: 'Bull Runner', balance: 1_000, character: 'BULL', isBot: true },
  { id: 'bot-bear', name: 'Bear Necessities', balance: 1_000, character: 'BEAR', isBot: true },
  { id: 'bot-whale', name: 'The Whale', balance: 1_000, character: 'WHALE', isBot: true },
];

const INITIAL_VOLUME = 0.7;

export const useGameStore = create<GameState>((set, get) => {
  voiceService.setVolume(INITIAL_VOLUME);

  return {
    round: null,
    roundNumber: 0,
    gamePhase: 'idle',
    players: defaultPlayers,
    trades: [],
    lastAction: null,
    character: 'DEALER',
    isVoiceEnabled: true,
    volume: INITIAL_VOLUME,

    startRound: () => {
      const currentPlayers = get().players;
      const table = {
        players: currentPlayers.map(player => ({
          id: player.id,
          balance: player.balance,
          position: 0,
        })),
        pot: 0,
      };

      const round = new Round(table, [...DEFAULT_DECK]);
      try {
        round.deal();
      } catch (error) {
        console.warn('Round deal failed; continuing without dealt cards', error);
      }

      set(state => ({
        round,
        roundNumber: state.roundNumber + 1,
        gamePhase: 'playing',
        trades: [],
        lastAction: null,
        players: state.players.map(player => ({ ...player, isWinner: false })),
      }));
    },

    endRound: (winnerId) => {
      set(state => ({
        round: null,
        gamePhase: 'finished',
        lastAction: winnerId
          ? { type: 'win_round', player: winnerId }
          : state.lastAction,
        players: state.players.map(player => ({
          ...player,
          isWinner: winnerId ? player.id === winnerId : false,
        })),
      }));
    },

    resetGame: () => set({
      round: null,
      roundNumber: 0,
      gamePhase: 'idle',
      trades: [],
      lastAction: null,
      players: defaultPlayers.map(player => ({ ...player })),
    }),

    setGamePhase: (phase) => set({ gamePhase: phase }),

    setPlayers: (players) => set({ players: players.map(player => ({ ...player })) }),

    recordTrade: (trade) => {
      const tradeEvent: TradeEvent = {
        id: trade.id ?? `trade-${Date.now()}`,
        timestamp: trade.timestamp ?? Date.now(),
        note: trade.note,
        player: trade.player,
        counterparty: trade.counterparty,
        quantity: trade.quantity,
        price: trade.price,
        type: trade.type,
        value: trade.value ?? trade.price * trade.quantity,
      };

      set(state => ({
        trades: [...state.trades.slice(-49), tradeEvent],
        lastAction: { type: 'trade', player: trade.player, value: tradeEvent.value },
      }));
    },

    setTrades: (trades) => {
      set({ trades: trades.slice(-50) });
    },

    setLastAction: (action) => set({ lastAction: action }),

    setCharacter: (character) => set({ character }),

    setVoiceEnabled: (enabled) => set({ isVoiceEnabled: enabled }),

    setVolume: (volume) => {
      const clamped = Math.max(0, Math.min(1, volume));
      voiceService.setVolume(clamped);
      set({ volume: clamped });
    },

    setRoundNumber: (round) => set({ roundNumber: round }),
  };
});

// Alias for compatibility with voice hook
export const useStore = useGameStore;
