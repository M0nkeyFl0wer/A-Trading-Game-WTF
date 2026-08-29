import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import seedrandom from 'seedrandom';
import { Round } from '@trading-game/core';
import type { Player } from '@trading-game/core';
import { DEFAULT_DECK } from '@trading-game/shared';
import { GunSlingerBot } from '../src';

// Price granularity the bots bluff in (one "tick" = 1 unit of price).
const TICK = 1;

function createPlayers(): Player[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `P${i}`,
    balance: 1000,
    position: 0,
  }));
}

/**
 * Simulation against the current 3-phase Round engine (issue #8).
 *
 * The old test targeted the pre-rewrite API (`reveal()`, `settle(trades)`,
 * `houseFee`, `.community`). The engine now works like this:
 *
 *   new Round(table, deck)  -> phase 'deal'
 *   deal()                  -> phase 'blind'  (1 card per player + 3 community)
 *   submitOrder(...)        -> allowed in blind/flop/turn; matched trades returned
 *   advancePhase() x3       -> blind -> flop -> turn -> settlement
 *   settle()                -> applies PnL to player balances, phase 'settled'
 *
 * Bots only produce quotes (bid/ask). To turn a quote into a trade we submit
 * the bot's ask to the book and have a "human" player lift it with a bid at
 * the same price, so the match is deterministic.
 */
describe('bot simulation', () => {
  let origRandom: () => number;

  beforeAll(() => {
    // Seed Math.random so the bots' bluff offsets are reproducible run-to-run.
    // (Round.deal() shuffles with crypto.randomInt, which is NOT affected —
    // that's fine, the assertions below hold for any shuffle.)
    origRandom = Math.random;
    Math.random = seedrandom('bot');
  });

  afterAll(() => {
    Math.random = origRandom;
  });

  it('runs a full round with bots: balances stay >= 0 and settlement is zero-sum', () => {
    const players = createPlayers();
    const round = new Round({ players, pot: 0 }, [...DEFAULT_DECK]);

    // Seats 3 and 4 are bots; seats 0-2 are "humans".
    const bots = [
      new GunSlingerBot(3, TICK, Math.random),
      new GunSlingerBot(4, TICK, Math.random),
    ];

    round.deal();
    expect(round.phase).toBe('blind');

    // Hand each bot its own card so its quote is informed by it.
    bots[0].onCard(players[3].card!);
    bots[1].onCard(players[4].card!);

    // Each bot posts an ask; the human opposite it lifts the ask at that price.
    // The ask rests first, so execution happens at the resting (ask) price.
    bots.forEach((bot, i) => {
      const quote = bot.onQuoteRequest();
      expect(quote.ask).toBeGreaterThan(quote.bid); // sanity: a real spread

      const botId = `P${3 + i}`;
      const humanId = `P${i}`;

      const askTrades = round.submitOrder({
        playerId: botId,
        playerName: botId,
        side: 'ask',
        price: quote.ask,
        quantity: 1,
      });
      expect(askTrades).toHaveLength(0); // nothing to match against yet

      const bidTrades = round.submitOrder({
        playerId: humanId,
        playerName: humanId,
        side: 'bid',
        price: quote.ask,
        quantity: 1,
      });
      expect(bidTrades).toHaveLength(1);
      expect(bidTrades[0].buyerId).toBe(humanId);
      expect(bidTrades[0].sellerId).toBe(botId);
      expect(bidTrades[0].price).toBe(quote.ask);
    });

    expect(round.getMatchedTrades()).toHaveLength(2);

    // Walk the remaining phases to settlement.
    expect(round.advancePhase()).toBe('flop');
    expect(round.advancePhase()).toBe('turn');
    expect(round.advancePhase()).toBe('settlement');

    const startingTotal = players.length * 1000;
    const pnl = round.settle();
    expect(round.phase).toBe('settled');

    // Settlement moves money between players only: the pot is conserved.
    let pnlSum = 0;
    for (const v of pnl.values()) pnlSum += v;
    expect(pnlSum).toBeCloseTo(0, 10);

    const totalBalance = players.reduce((a, p) => a + p.balance, 0);
    expect(totalBalance).toBeCloseTo(startingTotal, 10);

    // With 1-unit trades and a deck whose max total is far below 1000,
    // no one can go bust in a single round.
    players.forEach((p) => expect(p.balance).toBeGreaterThanOrEqual(0));

    // Each trade's PnL is exactly (total - price) for the buyer, mirrored for
    // the seller — check it directly against the engine's card total.
    const total = round.getTotal();
    for (const t of round.getMatchedTrades()) {
      expect(pnl.get(t.buyerId)).toBeCloseTo((total - t.price) * t.quantity, 10);
      expect(pnl.get(t.sellerId)).toBeCloseTo((t.price - total) * t.quantity, 10);
    }
  });
});
