import { describe, it, expect } from 'vitest';
import { simulateRound, type SimStrategy, type SimPlayerView } from '../src/sim';
import { SeededRng, CryptoRng, cryptoRng } from '../src/rng';
import { Round } from '../src/round';
import type { Player } from '../src/types';
import type { DeckValue } from '@trading-game/shared';

const deck: DeckValue[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, -10];

/**
 * A deterministic strategy: bid at floor(fairValue) and ask at ceil(fairValue).
 * Its output depends only on the view it is given, so if the view is
 * reproducible the actions are too.
 */
function makeStrategy(id: string): SimStrategy {
  return {
    id,
    name: id,
    decide: (view: SimPlayerView) => {
      // Alternate seats bid vs ask so trades actually cross.
      const seat = Number(id.replace(/\D/g, '')) || 0;
      if (seat % 2 === 0) {
        return { side: 'bid', price: Math.floor(view.fairValue), quantity: 1 };
      }
      return { side: 'ask', price: Math.floor(view.fairValue) - 1, quantity: 1 };
    },
  };
}

function makeStrategies(n = 5): SimStrategy[] {
  return Array.from({ length: n }, (_, i) => makeStrategy(`P${i}`));
}

describe('SeededRng', () => {
  it('produces an identical sequence for the same numeric seed', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const seqA = Array.from({ length: 20 }, () => a.nextInt(100));
    const seqB = Array.from({ length: 20 }, () => b.nextInt(100));
    expect(seqA).toEqual(seqB);
  });

  it('produces an identical sequence for the same string seed', () => {
    const a = new SeededRng('tournament-7');
    const b = new SeededRng('tournament-7');
    const seqA = Array.from({ length: 20 }, () => a.nextInt(52));
    const seqB = Array.from({ length: 20 }, () => b.nextInt(52));
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 20 }, () => a.nextInt(1000));
    const seqB = Array.from({ length: 20 }, () => b.nextInt(1000));
    expect(seqA).not.toEqual(seqB);
  });

  it('stays within [0, maxExclusive)', () => {
    const r = new SeededRng('bounds');
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(17);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(17);
    }
  });

  it('rejects a non-positive range', () => {
    const r = new SeededRng(1);
    expect(() => r.nextInt(0)).toThrow(RangeError);
    expect(() => r.nextInt(-3)).toThrow(RangeError);
  });
});

describe('CryptoRng (live default, unchanged behaviour)', () => {
  it('returns integers within range', () => {
    const r = new CryptoRng();
    for (let i = 0; i < 200; i++) {
      const v = r.nextInt(17);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(17);
    }
  });

  it('is the default Round.deal() RNG and produces varied deals', () => {
    // Live path: no rng injected. Deal many rounds; the first card should not be
    // constant across deals (i.e. the crypto shuffle is actually shuffling).
    const firstCards = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const players: Player[] = Array.from({ length: 5 }, (_, j) => ({
        id: `P${j}`,
        balance: 100,
        position: j,
      }));
      const r = new Round({ players, pot: 0 }, [...deck]); // no rng => cryptoRng
      r.deal();
      firstCards.add(players[0].card?.value ?? 0);
    }
    expect(firstCards.size).toBeGreaterThan(1);
  });

  it('exposes a shared cryptoRng instance', () => {
    expect(cryptoRng.nextInt(5)).toBeLessThan(5);
  });
});

describe('simulateRound determinism', () => {
  it('same seed + same strategies → byte-identical deal, reveals and settlement', () => {
    const a = simulateRound('game-1', makeStrategies());
    const b = simulateRound('game-1', makeStrategies());

    // Deal is identical.
    expect(a.playerCards).toEqual(b.playerCards);
    expect(a.communityCards).toEqual(b.communityCards);
    expect(a.total).toBe(b.total);

    // Settlement is identical.
    expect(a.pnl).toEqual(b.pnl);
    expect(a.finalBalances).toEqual(b.finalBalances);

    // Trades match on every game-relevant field (ids/timestamps are cosmetic).
    const relevant = (t: (typeof a.trades)[number]) => ({
      buyerId: t.buyerId,
      sellerId: t.sellerId,
      price: t.price,
      quantity: t.quantity,
      phase: t.phase,
    });
    expect(a.trades.map(relevant)).toEqual(b.trades.map(relevant));

    // Trace is identical on its game-relevant fields.
    const traceView = (r: typeof a) =>
      r.trace.map((s) => ({
        phase: s.phase,
        playerId: s.playerId,
        decisions: s.decisions,
        tradeCount: s.trades.length,
      }));
    expect(traceView(a)).toEqual(traceView(b));
  });

  it('reveals are reproducible phase-by-phase for the same seed', () => {
    // Capture the revealed community cards each phase via a spy strategy.
    function revealSpy(): { strat: SimStrategy; seen: number[][] } {
      const seen: number[][] = [];
      const strat: SimStrategy = {
        id: 'P0',
        decide: (view) => {
          seen.push([...view.revealedCommunityCards]);
          return null;
        },
      };
      return { strat, seen };
    }

    const one = revealSpy();
    const two = revealSpy();
    simulateRound(999, [one.strat, makeStrategy('P1')]);
    simulateRound(999, [two.strat, makeStrategy('P1')]);

    // blind → 0 revealed, flop → 1, turn → 2.
    expect(one.seen.map((s) => s.length)).toEqual([0, 1, 2]);
    expect(one.seen).toEqual(two.seen);
  });

  it('different seeds produce different deals', () => {
    const a = simulateRound('seed-A', makeStrategies());
    const b = simulateRound('seed-B', makeStrategies());
    // At least one of the observable outputs must differ.
    const differ =
      JSON.stringify(a.playerCards) !== JSON.stringify(b.playerCards) ||
      JSON.stringify(a.communityCards) !== JSON.stringify(b.communityCards);
    expect(differ).toBe(true);
  });

  it('settlement is zero-sum in a simulated round', () => {
    const result = simulateRound('zero-sum', makeStrategies());
    const totalPnL = Object.values(result.pnl).reduce((s, v) => s + v, 0);
    expect(totalPnL).toBeCloseTo(0, 10);
  });

  it('every player appears in pnl and finalBalances even if they never trade', () => {
    const sitOut: SimStrategy = { id: 'idle', decide: () => null };
    const result = simulateRound(7, [sitOut, makeStrategy('P1')]);
    expect(result.pnl).toHaveProperty('idle');
    expect(result.finalBalances).toHaveProperty('idle');
    // An idle player's balance is unchanged from the default starting balance.
    expect(result.finalBalances['idle']).toBe(1000);
  });

  it('produces a trace covering all three trading phases per player', () => {
    const strategies = makeStrategies(3);
    const result = simulateRound(1234, strategies);
    // 3 phases * 3 players = 9 steps.
    expect(result.trace).toHaveLength(9);
    expect(result.trace.map((s) => s.phase)).toEqual([
      'blind', 'blind', 'blind',
      'flop', 'flop', 'flop',
      'turn', 'turn', 'turn',
    ]);
  });

  it('throws when given no strategies', () => {
    expect(() => simulateRound(1, [])).toThrow('at least one strategy');
  });
});
