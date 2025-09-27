import create from 'zustand';
import { Round } from '@trading-game/core';
import { DEFAULT_DECK } from '@trading-game/shared';

interface GameState {
  round: Round | null;
  startRound: () => void;
  // Voice and character state
  character: string;
  isVoiceEnabled: boolean;
  volume: number;
  setCharacter: (character: string) => void;
  setVoiceEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
}

export const useGameStore = create<GameState>(set => ({
  round: null,
  startRound: () => {
    const r = new Round({ players: [], pot: 0 }, [...DEFAULT_DECK]);
    set({ round: r });
  },
  // Voice and character state
  character: 'DEALER',
  isVoiceEnabled: true,
  volume: 0.5,
  setCharacter: (character) => set({ character }),
  setVoiceEnabled: (enabled) => set({ isVoiceEnabled: enabled }),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) })
}));

// Alias for compatibility with voice hook
export const useStore = useGameStore;
