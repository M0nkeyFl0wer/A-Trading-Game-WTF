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
    expect(state.matchedTrades).toHaveLength(0);
    expect(state.orders).toHaveLength(0);
    expect(state.players).toHaveLength(4);
    expect(state.players[0].name).toBe('You');
    expect(state.character).toBe('DEALER');
    expect(state.tradingPhase).toBeNull();
    expect(state.myCard).toBeNull();
    expect(state.revealedCommunityCards).toHaveLength(0);
  });

  test('setTradingPhase updates phase correctly', () => {
    const { setTradingPhase } = useGameStore.getState();
    setTradingPhase('blind');
    expect(useGameStore.getState().tradingPhase).toBe('blind');

    setTradingPhase('flop');
    expect(useGameStore.getState().tradingPhase).toBe('flop');

    setTradingPhase('finished');
    expect(useGameStore.getState().tradingPhase).toBe('finished');
  });

  test('setOrders and setMatchedTrades update order book state', () => {
    const { setOrders, setMatchedTrades } = useGameStore.getState();

    setOrders([{
      id: 'o1',
      playerId: 'p1',
      side: 'bid',
      price: 60,
      quantity: 2,
      remaining: 2,
      phase: 'blind',
      timestamp: Date.now(),
      status: 'open',
      isMine: true,
    }]);
    expect(useGameStore.getState().orders).toHaveLength(1);

    setMatchedTrades([{
      id: 't1',
      buyerId: 'p1',
      sellerId: 'p2',
      price: 60,
      quantity: 1,
      phase: 'blind',
      timestamp: Date.now(),
    }]);
    expect(useGameStore.getState().matchedTrades).toHaveLength(1);
  });

  test('setSettlement updates settlement state', () => {
    const { setSettlement } = useGameStore.getState();
    setSettlement(183, { 'p1': 12.5, 'p2': -8.0 });

    const state = useGameStore.getState();
    expect(state.settlementTotal).toBe(183);
    expect(state.pnl).toEqual({ 'p1': 12.5, 'p2': -8.0 });
  });

  test('setMyCard and setRevealedCommunityCards work correctly', () => {
    const { setMyCard, setRevealedCommunityCards } = useGameStore.getState();

    setMyCard(12);
    expect(useGameStore.getState().myCard).toBe(12);

    setRevealedCommunityCards([15, 7]);
    expect(useGameStore.getState().revealedCommunityCards).toEqual([15, 7]);
  });

  test('resetGame clears all trading state', () => {
    const store = useGameStore.getState();
    store.setTradingPhase('flop');
    store.setOrders([{ id: 'o1', playerId: 'p1', side: 'bid', price: 60, quantity: 1, remaining: 1, phase: 'blind', timestamp: Date.now(), status: 'open' }]);
    store.setMyCard(10);
    store.setSettlement(100, { 'p1': 5 });
    store.setRevealedCommunityCards([5, 10, 15]);

    store.resetGame();

    const state = useGameStore.getState();
    expect(state.tradingPhase).toBeNull();
    expect(state.orders).toHaveLength(0);
    expect(state.matchedTrades).toHaveLength(0);
    expect(state.myCard).toBeNull();
    expect(state.settlementTotal).toBeNull();
    expect(state.pnl).toBeNull();
    expect(state.revealedCommunityCards).toHaveLength(0);
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
