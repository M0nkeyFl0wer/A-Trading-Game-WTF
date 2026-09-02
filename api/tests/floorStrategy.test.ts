/**
 * Floor mode: one Strategy interface + quotes-only trading (issues #25 + #28).
 *
 * Two things are proven here:
 *
 *   (a) BOT-ONLY FLOOR ROUND -- with no human action, a room of bots driven by
 *       a floor-mode FloorCoordinator trades entirely through QUOTES. Every
 *       resulting print is quote-originated, the order book stays empty, the
 *       order-book entry point (roomService.submitOrder) is never called, and
 *       the room's consensus moves off its seed.
 *
 *   (b) STRATEGY IS THE SINGLE ENTRY POINT -- the same `Strategy.decide`
 *       interface produces every bot intent (respond / hit / lift / requestQuote),
 *       the #27 bluff still rides through the RESPOND branch, and the honest
 *       baseline stays honest.
 *
 * Hermetic per the api conventions: a tmp DB_PATH set before the service module
 * loads, and we deliberately DO NOT import botService, so its room:updated
 * listener (which would start the env-configured coordinator) never attaches --
 * the only coordinator in play is the floor-mode one this test constructs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-game-floor-'));
process.env.DB_PATH = path.join(tmpDir, 'game.db');

import { FloorCoordinator } from '../agents/floorCoordinator';
import {
  getStrategyForCharacter,
  createBaselineStrategy,
  type PublicState,
  type PrivateState,
} from '../agents/strategy';
import { bluffedQuoteMid, estimateFairValue } from '../agents/personalities';

type RoomServiceModule = typeof import('../services/roomService');
let roomService: RoomServiceModule['roomService'];
let closeDatabase: typeof import('../services/database')['closeDatabase'];

beforeAll(async () => {
  const svc = await import('../services/roomService');
  roomService = svc.roomService;
  const dbMod = await import('../services/database');
  closeDatabase = dbMod.closeDatabase;
});

afterAll(() => {
  // Clear any armed phase timers so nothing fires into a closed DB after the run.
  const timers = (roomService as any).timers as Map<string, NodeJS.Timeout> | undefined;
  if (timers) {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * mulberry32 -- a tiny, seedable PRNG so the floor round is deterministic across
 * runs. Successive calls differ (unlike a constant), which the strategy relies
 * on: one roll decides whether to initiate, the next picks the target.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('floor mode: bot-only round trades through quotes (issue #25/#28)', () => {
  it('produces quote-originated trades, zero order-book trades, and moves consensus', async () => {
    // One idle human host + three bluffing bots. The human never acts.
    const room = await roomService.createRoom('Floor Round', 5, 'human-host', 'Host');
    await roomService.addBot(room.id, 'human-host', 'BULL');
    await roomService.addBot(room.id, 'human-host', 'BEAR');
    await roomService.addBot(room.id, 'human-host', 'WHALE');

    const started = await roomService.startRoom(room.id, 'human-host');
    expect(started.status).toBe('blind');
    const seededConsensus = started.gameState!.consensus!;

    // A floor-mode coordinator with a seeded rng -- the ONLY coordinator here.
    const coordinator = new FloorCoordinator({ floorMode: true }, mulberry32(12345));

    // If the order book were ever touched, this spy would catch it. It must
    // stay at zero calls for the whole round: quotes-only is the invariant.
    const submitSpy = vi.spyOn(roomService, 'submitOrder');

    // Drive the floor synchronously. Wall-clock barely advances over these
    // awaits, so the round stays in the blind phase the whole time.
    for (let i = 0; i < 40; i++) {
      await coordinator.tickOnce(room.id);
    }

    const after = await roomService.getRoom(room.id);
    const gs = after.gameState!;

    // Trades happened...
    expect(gs.matchedTrades.length).toBeGreaterThan(0);

    // ...and EVERY one is quote-originated. Quote fills stamp a synthetic
    // `quote_<id>_buy` order id; an order-book fill would carry a real order id.
    for (const trade of gs.matchedTrades) {
      expect(trade.buyOrderId.startsWith('quote_')).toBe(true);
      expect(trade.sellOrderId.startsWith('quote_')).toBe(true);
    }

    // The hidden order book was never used: no resting orders, no submitOrder.
    expect((gs.orders ?? []).length).toBe(0);
    expect(submitSpy).not.toHaveBeenCalled();

    // The market belief moved off its no-information seed (issue #23).
    expect(Math.abs(gs.consensus! - seededConsensus)).toBeGreaterThan(0.5);

    submitSpy.mockRestore();
    coordinator.shutdown();
  }, 20_000);
});

describe('Strategy is the single entry point (issue #25)', () => {
  const pub: PublicState = {
    consensus: 40,
    timeRemainingMs: 15_000,
    phaseDurationMs: 30_000,
    targets: [
      { id: 'human', isBot: false },
      { id: 'other-bot', isBot: true },
    ],
    rng: () => 0.5,
  };

  const basePriv: PrivateState = {
    myId: 'me',
    myCard: 3,
    revealedCommunityCards: [],
    playerCount: 4,
    myNetPosition: 0,
  };

  it('routes a character RESPOND through the #27 bluff (Bull quotes above fair)', () => {
    const fair = estimateFairValue(basePriv.myCard, basePriv.revealedCommunityCards, basePriv.playerCount);
    const strat = getStrategyForCharacter('BULL');
    const action = strat.decide(pub, { ...basePriv, pendingForMe: { quoteId: 'q1' } });

    expect(action.type).toBe('respondQuote');
    if (action.type !== 'respondQuote') throw new Error('unreachable');

    // Two points wide (the game's fixed spread), matching gameEngine's rule.
    expect(action.ask - action.bid).toBe(2);
    // The Bull talks it UP: its quoted mid sits above its honest fair value.
    const mid = (action.bid + action.ask) / 2;
    expect(mid).toBeGreaterThan(fair);
    // And it is the SAME bluff function the old code called -- rng fixed at 0.5
    // gives zero noise, so the mid equals round(bluffedQuoteMid).
    expect(mid).toBe(Math.round(bluffedQuoteMid('BULL', fair, pub.consensus, () => 0.5)));
  });

  it('the honest baseline RESPONDs at its true fair value (no bluff)', () => {
    const fair = estimateFairValue(basePriv.myCard, basePriv.revealedCommunityCards, basePriv.playerCount);
    const strat = createBaselineStrategy();
    const action = strat.decide(pub, { ...basePriv, pendingForMe: { quoteId: 'q2' } });

    expect(action.type).toBe('respondQuote');
    if (action.type !== 'respondQuote') throw new Error('unreachable');
    const mid = (action.bid + action.ask) / 2;
    expect(mid).toBe(Math.round(fair));
  });

  it('RESOLVE: a character lifts when its fair value is above the quoted mid, hits when below', () => {
    const strat = getStrategyForCharacter('DEALER');
    // High card -> high fair value; a low quote mid -> lift (buy) it.
    const highCard = { ...basePriv, myCard: 10 };
    const lift = strat.decide(pub, { ...highCard, answered: { quoteId: 'q3', bid: 1, ask: 3 } });
    expect(lift.type).toBe('lift');

    // Low card -> low fair value; a high quote mid -> hit (sell) it.
    const lowCard = { ...basePriv, myCard: 1 };
    const hit = strat.decide(pub, { ...lowCard, answered: { quoteId: 'q4', bid: 99, ask: 101 } });
    expect(hit.type).toBe('hit');
  });

  it('the honest baseline only trades on real edge (passes inside the spread)', () => {
    const strat = createBaselineStrategy();
    const fair = estimateFairValue(basePriv.myCard, basePriv.revealedCommunityCards, basePriv.playerCount);
    // A two-wide quote straddling fair gives no edge -> pass.
    const bid = Math.round(fair) - 1;
    const ask = Math.round(fair) + 1;
    const action = strat.decide(pub, { ...basePriv, answered: { quoteId: 'q5', bid, ask } });
    expect(action.type).toBe('pass');
  });

  it('INITIATE: with nothing on its plate, a strategy requests a quote from a real target', () => {
    // Force the initiate roll to fire and steer target selection onto a bot.
    const rngValues = [0.01, 0.99]; // first: initiate (< score); second: pick target
    let i = 0;
    const rng = () => rngValues[Math.min(i++, rngValues.length - 1)];
    const strat = getStrategyForCharacter('WHALE');
    const action = strat.decide({ ...pub, rng }, basePriv);
    expect(action.type).toBe('requestQuote');
    if (action.type !== 'requestQuote') throw new Error('unreachable');
    expect(pub.targets.some((t) => t.id === action.targetId)).toBe(true);
  });
});
