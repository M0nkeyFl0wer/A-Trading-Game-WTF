import create from 'zustand';
import type { Order, MatchedTrade, TradingPhase } from '@trading-game/shared';
import type { CharacterType } from './lib/characterVisuals';
import { voiceService } from './lib/elevenlabs';

export interface Commentary {
  text: string;
  priority: 'low' | 'medium' | 'high';
  character: 'DEALER';
}

export type GamePhase = 'idle' | 'waiting' | 'starting' | 'playing' | 'finished';

export interface PlayerState {
  id: string;
  name: string;
  balance: number;
  character: CharacterType;
  isBot?: boolean;
  isWinner?: boolean;
  cardValue?: number;
  cardRevealed?: boolean;
}

export type LastAction =
  | { type: 'trade'; player: string; value: number }
  | { type: 'fold'; player: string }
  | { type: 'reveal'; player?: string }
  | { type: 'win_round'; player: string; value?: number }
  | { type: 'order_placed'; player: string; side: 'bid' | 'ask'; price: number };

interface GameState {
  // Core game state
  roundNumber: number;
  gamePhase: GamePhase;
  players: PlayerState[];
  lastAction: LastAction | null;

  // 3-phase order book state
  tradingPhase: TradingPhase | 'waiting' | 'finished' | null;
  orders: Order[];
  matchedTrades: MatchedTrade[];
  revealedCommunityCards: number[];
  phaseEndsAt: number | null;
  myCard: number | null;
  settlementTotal: number | null;
  pnl: Record<string, number> | null;
  commentary: Commentary[];

  // Voice and character state
  character: CharacterType;
  isVoiceEnabled: boolean;
  volume: number;

  // Game actions
  resetGame: () => void;
  setGamePhase: (phase: GamePhase) => void;
  setPlayers: (players: PlayerState[]) => void;
  setLastAction: (action: LastAction | null) => void;
  setRoundNumber: (round: number) => void;

  // 3-phase order book setters
  setTradingPhase: (phase: TradingPhase | 'waiting' | 'finished' | null) => void;
  setOrders: (orders: Order[]) => void;
  setMatchedTrades: (trades: MatchedTrade[]) => void;
  setRevealedCommunityCards: (cards: number[]) => void;
  setPhaseEndsAt: (ts: number | null) => void;
  setMyCard: (value: number | null) => void;
  setSettlement: (total: number | null, pnl: Record<string, number> | null) => void;
  setCommentary: (comments: Commentary[]) => void;

  // Voice actions
  setCharacter: (character: CharacterType) => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
}

const defaultPlayers: PlayerState[] = [
  { id: 'player-you', name: 'You', balance: 1_000, character: 'DEALER' },
  { id: 'bot-bull', name: 'Bull Runner', balance: 1_000, character: 'BULL', isBot: true },
  { id: 'bot-bear', name: 'Bear Necessities', balance: 1_000, character: 'BEAR', isBot: true },
  { id: 'bot-whale', name: 'The Whale', balance: 1_000, character: 'WHALE', isBot: true },
];

const INITIAL_VOLUME = 0.7;

export const useGameStore = create<GameState>((set) => {
  voiceService.setVolume(INITIAL_VOLUME);

  return {
    roundNumber: 0,
    gamePhase: 'idle',
    players: defaultPlayers,
    lastAction: null,

    // 3-phase order book defaults
    tradingPhase: null,
    orders: [],
    matchedTrades: [],
    revealedCommunityCards: [],
    phaseEndsAt: null,
    myCard: null,
    settlementTotal: null,
    pnl: null,
    commentary: [],

    character: 'DEALER',
    isVoiceEnabled: true,
    volume: INITIAL_VOLUME,

    resetGame: () => set({
      roundNumber: 0,
      gamePhase: 'idle',
      lastAction: null,
      tradingPhase: null,
      orders: [],
      matchedTrades: [],
      revealedCommunityCards: [],
      phaseEndsAt: null,
      myCard: null,
      settlementTotal: null,
      pnl: null,
      commentary: [],
      players: defaultPlayers.map(player => ({ ...player })),
    }),

    setGamePhase: (phase) => set({ gamePhase: phase }),
    setPlayers: (players) => set({ players: players.map(player => ({ ...player })) }),
    setLastAction: (action) => set({ lastAction: action }),
    setRoundNumber: (round) => set({ roundNumber: round }),

    // 3-phase setters
    setTradingPhase: (phase) => set({ tradingPhase: phase }),
    setOrders: (orders) => set({ orders }),
    setMatchedTrades: (trades) => set({ matchedTrades: trades }),
    setRevealedCommunityCards: (cards) => set({ revealedCommunityCards: cards }),
    setPhaseEndsAt: (ts) => set({ phaseEndsAt: ts }),
    setMyCard: (value) => set({ myCard: value }),
    setSettlement: (total, pnl) => set({ settlementTotal: total, pnl }),
    setCommentary: (comments) => set({ commentary: comments }),

    setCharacter: (character) => set({ character }),
    setVoiceEnabled: (enabled) => set({ isVoiceEnabled: enabled }),
    setVolume: (volume) => {
      const clamped = Math.max(0, Math.min(1, volume));
      voiceService.setVolume(clamped);
      set({ volume: clamped });
    },
  };
});

// Alias for compatibility with voice hook
export const useStore = useGameStore;
