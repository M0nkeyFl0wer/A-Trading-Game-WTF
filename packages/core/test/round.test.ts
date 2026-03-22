import { describe, it, expect, beforeEach } from 'vitest';
import { Round } from '../src/round';
import type { Player } from '../src/types';
import type { DeckValue } from '@trading-game/shared';

const deck: DeckValue[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, -10];

function createPlayers(count = 5): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `P${i}`,
    balance: 100,
    position: 0,
  }));
}

describe('Round', () => {
  let round: Round;
  let players: Player[];

  beforeEach(() => {
    players = createPlayers();
    round = new Round({ players, pot: 0 }, [...deck]);
  });

  // ---------------------------------------------------------------------------
  // Deal
  // ---------------------------------------------------------------------------

  it('deals 1 card per player and 3 community cards', () => {
    round.deal();
    expect(round.phase).toBe('blind');
    expect(players.every((p) => p.card !== undefined)).toBe(true);
    expect(round.getAllCommunityCards()).toHaveLength(3);
  });

  it('throws if deal() called twice', () => {
    round.deal();
    expect(() => round.deal()).toThrow('Cannot deal in phase');
  });

  // ---------------------------------------------------------------------------
  // Phase advancement
  // ---------------------------------------------------------------------------

  it('advances through all phases', () => {
    round.deal();

    expect(round.advancePhase()).toBe('flop');
    expect(round.phase).toBe('flop');

    expect(round.advancePhase()).toBe('turn');
    expect(round.phase).toBe('turn');

    expect(round.advancePhase()).toBe('settlement');
    expect(round.phase).toBe('settlement');
  });

  it('throws when advancing from settlement', () => {
    round.deal();
    round.advancePhase(); // flop
    round.advancePhase(); // turn
    round.advancePhase(); // settlement
    expect(() => round.advancePhase()).toThrow('Cannot advance');
  });

  it('throws when advancing from deal (before dealing)', () => {
    expect(() => round.advancePhase()).toThrow('Cannot advance');
  });

  // ---------------------------------------------------------------------------
  // Community card visibility
  // ---------------------------------------------------------------------------

  it('reveals 0 cards during blind', () => {
    round.deal();
    expect(round.getRevealedCommunityCards()).toEqual([]);
  });

  it('reveals 1 card during flop', () => {
    round.deal();
    round.advancePhase();
    expect(round.getRevealedCommunityCards()).toHaveLength(1);
  });

  it('reveals 2 cards during turn', () => {
    round.deal();
    round.advancePhase();
    round.advancePhase();
    expect(round.getRevealedCommunityCards()).toHaveLength(2);
  });

  it('reveals all 3 cards during settlement', () => {
    round.deal();
    round.advancePhase();
    round.advancePhase();
    round.advancePhase();
    expect(round.getRevealedCommunityCards()).toHaveLength(3);
    expect(round.getRevealedCommunityCards()).toEqual(round.getAllCommunityCards());
  });

  // ---------------------------------------------------------------------------
  // Order submission
  // ---------------------------------------------------------------------------

  it('accepts orders during blind phase', () => {
    round.deal();
    const trades = round.submitOrder({
      playerId: 'P0',
      playerName: 'Alice',
      side: 'bid',
      price: 50,
      quantity: 1,
    });
    expect(trades).toHaveLength(0); // no matching ask yet
    expect(round.getAllOrders()).toHaveLength(1);
  });

  it('matches crossing orders', () => {
    round.deal();

    round.submitOrder({
      playerId: 'P0',
      playerName: 'Alice',
      side: 'bid',
      price: 55,
      quantity: 1,
    });

    const trades = round.submitOrder({
      playerId: 'P1',
      playerName: 'Bob',
      side: 'ask',
      price: 50,
      quantity: 1,
    });

    expect(trades).toHaveLength(1);
    expect(trades[0].buyerId).toBe('P0');
    expect(trades[0].sellerId).toBe('P1');
    expect(trades[0].quantity).toBe(1);
  });

  it('rejects orders outside trading phases', () => {
    // Before deal
    expect(() =>
      round.submitOrder({
        playerId: 'P0',
        playerName: 'Alice',
        side: 'bid',
        price: 50,
        quantity: 1,
      }),
    ).toThrow('Cannot submit orders');

    // After settlement
    round.deal();
    round.advancePhase();
    round.advancePhase();
    round.advancePhase(); // settlement
    expect(() =>
      round.submitOrder({
        playerId: 'P0',
        playerName: 'Alice',
        side: 'bid',
        price: 50,
        quantity: 1,
      }),
    ).toThrow('Cannot submit orders');
  });

  it('allows orders during flop and turn', () => {
    round.deal();
    round.advancePhase(); // flop

    round.submitOrder({
      playerId: 'P0',
      playerName: 'Alice',
      side: 'bid',
      price: 60,
      quantity: 1,
    });

    round.advancePhase(); // turn

    round.submitOrder({
      playerId: 'P1',
      playerName: 'Bob',
      side: 'ask',
      price: 65,
      quantity: 1,
    });

    expect(round.getAllOrders()).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Cancel
  // ---------------------------------------------------------------------------

  it('cancels an order', () => {
    round.deal();
    round.submitOrder({
      playerId: 'P0',
      playerName: 'Alice',
      side: 'bid',
      price: 50,
      quantity: 1,
    });

    const orders = round.getAllOrders();
    expect(round.cancelOrder(orders[0].id)).toBe(true);
    expect(round.getOrderBookSnapshot().bids).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Settlement
  // ---------------------------------------------------------------------------

  it('settles trades against total card value', () => {
    // Deal shuffles the deck, so compute total dynamically
    const p = createPlayers(5);
    const r = new Round({ players: p, pot: 0 }, [...deck]);

    r.deal();
    const total = r.getTotal();

    // P0 bids at 50, P1 asks at 50 -> trade at 50, qty 2
    r.submitOrder({ playerId: 'P0', playerName: 'A', side: 'bid', price: 50, quantity: 2 });
    r.submitOrder({ playerId: 'P1', playerName: 'B', side: 'ask', price: 50, quantity: 2 });

    r.advancePhase(); // flop
    r.advancePhase(); // turn
    r.advancePhase(); // settlement

    const pnl = r.settle();
    expect(r.phase).toBe('settled');

    // buyer PnL = (total - 50) * 2
    // seller PnL = (50 - total) * 2
    const expectedBuyerPnL = (total - 50) * 2;
    const expectedSellerPnL = (50 - total) * 2;
    expect(pnl.get('P0')).toBe(expectedBuyerPnL);
    expect(pnl.get('P1')).toBe(expectedSellerPnL);

    // Balances updated (started at 100)
    expect(p[0].balance).toBe(100 + expectedBuyerPnL);
    expect(p[1].balance).toBe(100 + expectedSellerPnL);
  });

  it('throws if settle() called outside settlement phase', () => {
    round.deal();
    expect(() => round.settle()).toThrow('Cannot settle');
  });

  it('settlement is zero-sum', () => {
    round.deal();

    // Multiple trades across phases
    round.submitOrder({ playerId: 'P0', playerName: 'A', side: 'bid', price: 60, quantity: 3 });
    round.submitOrder({ playerId: 'P1', playerName: 'B', side: 'ask', price: 55, quantity: 2 });
    round.submitOrder({ playerId: 'P2', playerName: 'C', side: 'ask', price: 58, quantity: 1 });

    round.advancePhase(); // flop
    round.advancePhase(); // turn
    round.advancePhase(); // settlement

    const pnl = round.settle();

    // Total PnL across all players should be zero
    let totalPnL = 0;
    for (const val of pnl.values()) {
      totalPnL += val;
    }
    expect(totalPnL).toBeCloseTo(0, 10);
  });

  // ---------------------------------------------------------------------------
  // getTotal
  // ---------------------------------------------------------------------------

  it('getTotal sums all player + community cards', () => {
    const p = createPlayers(5);
    const r = new Round({ players: p, pot: 0 }, [...deck]);
    r.deal();
    // 8 cards dealt from 17-card deck (sum 130). getTotal returns the sum
    // of those 8 cards. We verify by summing player cards + community cards.
    const playerSum = p.reduce((s, pl) => s + (pl.card?.value ?? 0), 0);
    const communitySum = r.getAllCommunityCards().reduce((s, v) => s + v, 0);
    expect(r.getTotal()).toBe(playerSum + communitySum);
  });

  // ---------------------------------------------------------------------------
  // Order book snapshot
  // ---------------------------------------------------------------------------

  it('provides order book snapshot', () => {
    round.deal();

    round.submitOrder({ playerId: 'P0', playerName: 'A', side: 'bid', price: 50, quantity: 1 });
    round.submitOrder({ playerId: 'P1', playerName: 'B', side: 'ask', price: 55, quantity: 1 });

    const snapshot = round.getOrderBookSnapshot();
    expect(snapshot.bids).toHaveLength(1);
    expect(snapshot.asks).toHaveLength(1);
    expect(snapshot.bestBid).toBe(50);
    expect(snapshot.bestAsk).toBe(55);
    expect(snapshot.spread).toBe(5);
  });

  // ---------------------------------------------------------------------------
  // fromState
  // ---------------------------------------------------------------------------

  it('reconstructs round from persisted state', () => {
    round.deal();

    round.submitOrder({ playerId: 'P0', playerName: 'A', side: 'bid', price: 60, quantity: 1 });
    round.submitOrder({ playerId: 'P1', playerName: 'B', side: 'ask', price: 55, quantity: 1 });

    round.advancePhase(); // flop

    // Capture state
    const communityValues = round.getAllCommunityCards();
    const orders = round.getAllOrders();
    const trades = round.getMatchedTrades();

    // Reconstruct
    const restored = Round.fromState(
      { players, pot: 0 },
      communityValues,
      'flop',
      orders,
      trades,
    );

    expect(restored.phase).toBe('flop');
    expect(restored.getAllCommunityCards()).toEqual(communityValues);
    expect(restored.getMatchedTrades()).toHaveLength(trades.length);

    // Can continue from here
    restored.advancePhase(); // turn
    expect(restored.phase).toBe('turn');
  });
});
