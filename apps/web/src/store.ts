import create from 'zustand';
import { Round } from '@trading-game/core';
import { DEFAULT_DECK } from '@trading-game/shared';

interface GameState {
  round: Round | null;
  startRound: () => void;
}

export const useGameStore = create<GameState>(set => ({
  round: null,
  startRound: () => {
    const r = new Round({ players: [], pot: 0 }, [...DEFAULT_DECK]);
    set({ round: r });
  }
}));
