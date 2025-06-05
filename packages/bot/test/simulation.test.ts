import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import seedrandom from 'seedrandom';
import { Round } from '@trading-game/core';
import type { Player, Trade } from '@trading-game/core';
import { DEFAULT_DECK } from '@trading-game/shared';
import { GunSlingerBot } from '../src';

const TICK = 1;

function createPlayers(): Player[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `P${i}`,
    balance: 1000,
    position: 0,
  }));
}

describe('bot simulation', () => {
  let origRandom: () => number;

  beforeAll(() => {
    origRandom = Math.random;
    Math.random = seedrandom('bot');
  });

  afterAll(() => {
    Math.random = origRandom;
  });

  it('runs round with bots without negative balances', () => {
    const players = createPlayers();
    const round = new Round({ players, pot: 0 }, [...DEFAULT_DECK], { houseFee: 0.01 });
    const bots = [
      new GunSlingerBot(3, TICK, Math.random),
      new GunSlingerBot(4, TICK, Math.random),
    ];

    round.deal();
    bots[0].onCard(players[3].card!);
    bots[1].onCard(players[4].card!);

    const trades: Trade[] = [];
    bots.forEach((bot, i) => {
      const q = bot.onQuoteRequest();
      // first human buys from bot i
      trades.push({ from: `P${i}`, to: `P${3 + i}`, price: q.ask, quantity: 1 });
    });

    round.reveal();

    round.settle(trades);

    players.forEach(p => expect(p.balance).toBeGreaterThanOrEqual(0));

    const tradeVolume: Record<string, number> = {};
    trades.forEach(t => {
      tradeVolume[t.from] = (tradeVolume[t.from] || 0) + t.price;
      tradeVolume[t.to] = (tradeVolume[t.to] || 0) + t.price;
    });
    const expectedFees = Object.values(tradeVolume).reduce((a, v) => a + v, 0) * 0.01;
    const totalBalance = players.reduce((a, p) => a + p.balance, 0);
    const communityTotal = (round as any).community.reduce((a: number, c: any) => a + c.value, 0);
    const cardSum = players.reduce((a, p) => a + (p.card?.value || 0), 0);
    const expectedTotal = players.length * 1000 + cardSum + players.length * communityTotal - expectedFees;
    expect(totalBalance).toBeCloseTo(expectedTotal, 6);
  });
});
