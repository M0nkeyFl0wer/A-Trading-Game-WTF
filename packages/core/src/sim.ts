/**
 * Headless, deterministic round simulator (issue #26).
 *
 * `simulateRound` runs a *complete* round — deal → blind → flop → turn →
 * settlement — with no socket, no timers and no UI, driven entirely by a seed
 * and a list of strategy functions. Because the deal is produced by a
 * {@link SeededRng}, the same seed plus the same strategies always yields the
 * same deal, the same reveals and the same settlement. That reproducibility is
 * exactly what the Debrief replay and bot-vs-bot tournaments need: they can
 * fast-forward a hand offline and get byte-identical results.
 *
 * The `Strategy` shape here is intentionally minimal and self-contained. It is
 * NOT the api's `Strategy` interface — the engine has no dependency on the
 * server. A strategy is just "given what I can see this phase, what orders do I
 * place?".
 */

import {
  DEFAULT_DECK,
  DECK_MEAN,
  estimateFairValue,
  type Deck,
} from '@trading-game/shared';
import type { Player, Table } from './types';
import { Round, type RoundPhase } from './round';
import type { MatchedTrade, OrderBookSnapshot, TradingPhase } from './orderBook';
import { SeededRng } from './rng';

/** The trading phases a strategy is consulted in, in order. */
const SIM_TRADING_PHASES: TradingPhase[] = ['blind', 'flop', 'turn'];

/** Default starting balance for a simulated player. */
const DEFAULT_STARTING_BALANCE = 1000;

/** A single order a strategy wants to place. */
export interface SimDecision {
  side: 'bid' | 'ask';
  price: number;
  quantity: number;
}

/**
 * Everything a strategy is allowed to see when it decides. This mirrors the
 * real game's information set: a player knows only their own card, the community
 * cards revealed so far, the current phase, the table size, and the public order
 * book. A convenience `fairValue` (the shared estimator) is included so simple
 * strategies do not have to recompute it.
 */
export interface SimPlayerView {
  playerId: string;
  /** The strategy's own hole card. */
  myCard: number;
  /** Community cards visible in the current phase (0 in blind, 1 flop, 2 turn). */
  revealedCommunityCards: number[];
  phase: TradingPhase;
  /** Total number of players (strategies) at the table. */
  playerCount: number;
  /** Public order book at the moment this strategy is consulted. */
  snapshot: OrderBookSnapshot;
  /** Deck mean, exposed so strategies can reason about unknown cards. */
  deckMean: number;
  /** Shared fair-value estimate from this player's point of view (see #24). */
  fairValue: number;
}

/**
 * A minimal strategy: an id, an optional display name / starting balance, and a
 * `decide` function that returns the orders to place this phase (or an empty
 * array to sit out). `decide` is called once per trading phase per player.
 */
export interface SimStrategy {
  id: string;
  name?: string;
  startingBalance?: number;
  decide: (view: SimPlayerView) => SimDecision[] | SimDecision | null | undefined;
}

/**
 * One entry in the replay trace: which player acted, in which phase, what they
 * decided, and which trades resulted from those specific orders. Enough for a
 * Debrief to reconstruct the hand step by step.
 *
 * Note: `trades[].id` and `trades[].timestamp` come from the order book and are
 * NOT deterministic (random ids, wall-clock time). Every *game-relevant* field —
 * price, quantity, buyer/seller, phase — is deterministic. Replay tooling should
 * compare those, not the cosmetic ids.
 */
export interface SimStep {
  phase: TradingPhase;
  playerId: string;
  decisions: SimDecision[];
  trades: MatchedTrade[];
}

/** The full result of a simulated round. */
export interface SimResult {
  seed: number | string;
  /** playerId → their dealt hole card. */
  playerCards: Record<string, number>;
  /** The three community cards, in deal order. */
  communityCards: number[];
  /** The settlement total every trade settles against. */
  total: number;
  /** Every matched trade across all phases, in match order. */
  trades: MatchedTrade[];
  /** playerId → net PnL from settlement. */
  pnl: Record<string, number>;
  /** playerId → balance after settlement. */
  finalBalances: Record<string, number>;
  /** Per-step trace of who did what, for the Debrief / tournament UI. */
  trace: SimStep[];
}

export interface SimulateRoundOptions {
  /** Override the deck (defaults to the shipped {@link DEFAULT_DECK}). */
  deck?: Deck;
}

/**
 * Normalise a strategy's return value into a decisions array. A strategy may
 * return a single decision, an array, or nothing (sit out).
 */
function toDecisions(
  result: SimDecision[] | SimDecision | null | undefined,
): SimDecision[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

/**
 * Run one full round deterministically from `seed` and `strategies`.
 *
 * Ordering is fixed and part of the contract: strategies act in list order
 * within each phase, and phases run blind → flop → turn. Because the seeded RNG,
 * the deal, and this ordering are all deterministic, the returned deal, reveals
 * and settlement are fully reproducible from `{seed, strategies}`.
 */
export function simulateRound(
  seed: number | string,
  strategies: SimStrategy[],
  options: SimulateRoundOptions = {},
): SimResult {
  if (strategies.length === 0) {
    throw new Error('simulateRound requires at least one strategy');
  }

  const deck = (options.deck ?? DEFAULT_DECK) as Deck;

  // Build the table. One player per strategy, in the given order.
  const players: Player[] = strategies.map((s, i) => ({
    id: s.id,
    balance: s.startingBalance ?? DEFAULT_STARTING_BALANCE,
    position: i,
  }));
  const table: Table = { players, pot: 0 };

  // Seed the round so the deal is reproducible, and give it a deterministic
  // monotonic clock so order timestamps — and therefore the matching engine's
  // price-time priority and execution prices — are reproducible too. Without
  // this, two orders placed "at the same time" would tie non-deterministically.
  let tick = 0;
  const round = new Round(table, [...deck], {
    rng: new SeededRng(seed),
    clock: () => ++tick,
  });
  round.deal();

  const playerCount = players.length;
  const trace: SimStep[] = [];

  // Walk the trading phases. `round.phase` is 'blind' immediately after deal.
  for (const phase of SIM_TRADING_PHASES) {
    // Consult each strategy once, in order, with the live order book snapshot.
    for (let i = 0; i < strategies.length; i++) {
      const strat = strategies[i];
      const player = players[i];
      const myCard = player.card?.value ?? 0;
      const revealed = round.getRevealedCommunityCards();

      const view: SimPlayerView = {
        playerId: strat.id,
        myCard,
        revealedCommunityCards: revealed,
        phase,
        playerCount,
        snapshot: round.getOrderBookSnapshot(),
        deckMean: DECK_MEAN,
        fairValue: estimateFairValue(myCard, revealed, playerCount),
      };

      const decisions = toDecisions(strat.decide(view));
      const stepTrades: MatchedTrade[] = [];

      for (const decision of decisions) {
        const trades = round.submitOrder({
          playerId: strat.id,
          playerName: strat.name ?? strat.id,
          side: decision.side,
          price: decision.price,
          quantity: decision.quantity,
        });
        stepTrades.push(...trades);
      }

      trace.push({ phase, playerId: strat.id, decisions, trades: stepTrades });
    }

    // Advance out of this trading phase (blind→flop→turn→settlement).
    round.advancePhase();
  }

  // We are now in 'settlement'. Settle and read back the results.
  const pnlMap = round.settle();

  const playerCards: Record<string, number> = {};
  const finalBalances: Record<string, number> = {};
  for (const player of players) {
    playerCards[player.id] = player.card?.value ?? 0;
    finalBalances[player.id] = player.balance;
  }

  const pnl: Record<string, number> = {};
  for (const [id, value] of pnlMap) {
    pnl[id] = value;
  }
  // Ensure every player appears in pnl, even if they never traded.
  for (const player of players) {
    if (!(player.id in pnl)) pnl[player.id] = 0;
  }

  return {
    seed,
    playerCards,
    communityCards: round.getAllCommunityCards(),
    total: round.getTotal(),
    trades: round.getMatchedTrades(),
    pnl,
    finalBalances,
    trace,
  };
}

// Re-export for consumers who only import the sim module.
export type { RoundPhase };
