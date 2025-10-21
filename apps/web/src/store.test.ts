import { beforeEach, describe, expect, test } from 'vitest';
import { useGameStore } from './store';

const resetStore = () => {
  const { resetGame } = useGameStore.getState();
  resetGame();
};

describe('game store state', () => {
  beforeEach(() => {
    resetStore();
  });

  test('initialises with default players and idle state', () => {
    const state = useGameStore.getState();

    expect(state.gamePhase).toBe('idle');
    expect(state.roundNumber).toBe(0);
    expect(state.trades).toHaveLength(0);
    expect(state.players).toHaveLength(4);
    expect(state.players[0].name).toBe('You');
    expect(state.character).toBe('DEALER');
  });

  test('startRound creates a round and moves to playing phase', () => {
    const { startRound } = useGameStore.getState();
    startRound();

    const state = useGameStore.getState();
    expect(state.roundNumber).toBe(1);
    expect(state.round).not.toBeNull();
    expect(state.gamePhase).toBe('playing');
    expect(state.trades).toHaveLength(0);
  });

  test('recordTrade appends trade history and updates last action', () => {
    const { recordTrade } = useGameStore.getState();
    recordTrade({
      player: 'You',
      counterparty: 'Bot',
      quantity: 2,
      price: 15,
      type: 'buy',
    });

    const state = useGameStore.getState();
    expect(state.trades).toHaveLength(1);
    expect(state.trades[0].player).toBe('You');
    expect(state.lastAction).toEqual({ type: 'trade', player: 'You', value: 30 });
  });

  test('endRound flags winner and transitions to finished', () => {
    const { startRound, endRound } = useGameStore.getState();
    startRound();
    endRound('player-you');

    const state = useGameStore.getState();
    expect(state.gamePhase).toBe('finished');
    const you = state.players.find(player => player.id === 'player-you');
    expect(you?.isWinner).toBe(true);
  });

  test('voice controls toggle enabled flag and clamp volume', () => {
    const { setVoiceEnabled, setVolume } = useGameStore.getState();
    setVoiceEnabled(false);
    setVolume(2);

    const state = useGameStore.getState();
    expect(state.isVoiceEnabled).toBe(false);
    expect(state.volume).toBe(1);

    setVolume(-1);
    expect(useGameStore.getState().volume).toBe(0);
  });
});
