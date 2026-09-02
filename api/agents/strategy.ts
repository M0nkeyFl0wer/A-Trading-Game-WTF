/**
 * The one Strategy interface (issue #25 + #28).
 *
 * Everything that plays the floor -- the built-in character personalities, the
 * honest baseline, and (later) user-supplied bots -- implements ONE interface:
 *
 *     Strategy.decide(publicState, privateState) => Action
 *
 * where Action is exactly one of:
 *
 *     { type: 'requestQuote', targetId }   -- ask a named player for a two-way price
 *     { type: 'respondQuote', quoteId, bid, ask }  -- answer someone who asked me
 *     { type: 'hit',  quoteId }            -- sell to the quoter at their bid
 *     { type: 'lift', quoteId }            -- buy from the quoter at their ask
 *     { type: 'pass' }                     -- do nothing this turn
 *
 * This is the SINGLE entry point a bot acts through. The FloorCoordinator calls
 * `decide` in three situations, distinguished purely by what is present on the
 * private state:
 *
 *   1. INITIATE  -- nothing pending for me -> maybe requestQuote a target.
 *   2. RESPOND   -- a quote is pending, addressed to me -> respondQuote (or pass).
 *   3. RESOLVE   -- a quote I requested has been answered -> hit / lift / pass.
 *
 * Because all three collapse into `decide`, there is exactly one place bot
 * behaviour lives, and the coordinator never reaches around it to the order
 * book. The bluff pricing from issue #27 (bluffedQuoteMid) is preserved by
 * routing it through the RESPOND branch below, unchanged.
 *
 * The interface is intentionally pure: `decide` never touches the database or
 * the clock -- the caller passes a snapshot in and gets an intent out, which
 * makes strategies unit-testable in isolation and keeps the coordinator the
 * only thing that mutates room state.
 */

import { estimateFairValue } from '@trading-game/shared';
import { bluffedQuoteMid, PERSONALITY_CONFIGS } from './personalities';

// ---------------------------------------------------------------------------
// Action + state shapes
// ---------------------------------------------------------------------------

/** The one and only vocabulary a strategy speaks. */
export type Action =
  | { type: 'requestQuote'; targetId: string }
  | { type: 'respondQuote'; quoteId: string; bid: number; ask: number }
  | { type: 'hit'; quoteId: string }
  | { type: 'lift'; quoteId: string }
  | { type: 'pass' };

/** A candidate counterparty the strategy may request a quote from. */
export interface QuoteTarget {
  id: string;
  isBot: boolean;
}

/** A two-way price another player has shown me on a quote I requested. */
export interface AnsweredQuote {
  quoteId: string;
  bid: number;
  ask: number;
}

/**
 * What EVERYONE at the table can see -- the market, not my cards. Deliberately
 * small: a strategy prices off consensus, the clock, and who else is here.
 */
export interface PublicState {
  /** Current market belief about the settlement total (EWMA, issue #23). */
  consensus: number | undefined;
  /** Milliseconds left in the current trading phase. */
  timeRemainingMs: number;
  /** Full phase length, so time-pressure can be normalised to 0..1. */
  phaseDurationMs: number;
  /** Everyone I could ask for a quote (never includes me). */
  targets: QuoteTarget[];
  /** Injectable randomness (Math.random by default) so tests are deterministic. */
  rng: () => number;
}

/**
 * What only I know -- my hole card, my book, and any quote currently on my
 * plate. The presence of `pendingForMe` / `answered` is what selects the
 * RESPOND / RESOLVE branch inside `decide`.
 */
export interface PrivateState {
  myId: string;
  myCard: number;
  revealedCommunityCards: number[];
  playerCount: number;
  myNetPosition: number;
  /** A quote addressed to me, awaiting my two-way price (RESPOND context). */
  pendingForMe?: { quoteId: string };
  /** A quote I asked for that has been answered (RESOLVE context). */
  answered?: AnsweredQuote;
}

/** The single interface every player-agent implements. */
export interface Strategy {
  /** A stable label ('BULL', 'BASELINE', ...) for logging/attribution. */
  readonly name: string;
  /** Snapshot in, one intent out. Pure. */
  decide(publicState: PublicState, privateState: PrivateState): Action;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Pick one target, weighting bots above the human. In an idle-human room the
 * only counterparties that will actually answer are the other bots, so a bot
 * that mostly quotes bots keeps the floor alive; it still occasionally pings
 * the human so the human is part of the free-for-all (issue #28).
 */
function pickTarget(targets: QuoteTarget[], rng: () => number): QuoteTarget | null {
  if (targets.length === 0) return null;
  const BOT_WEIGHT = 3;
  const HUMAN_WEIGHT = 1;
  const weight = (t: QuoteTarget) => (t.isBot ? BOT_WEIGHT : HUMAN_WEIGHT);
  const total = targets.reduce((s, t) => s + weight(t), 0);
  let roll = rng() * total;
  for (const t of targets) {
    roll -= weight(t);
    if (roll <= 0) return t;
  }
  return targets[targets.length - 1];
}

/**
 * How badly this strategy wants to START a quote right now, in 0..1. Higher =
 * more likely to fire this tick. Three additive drivers, matching issue #28:
 *   - personality aggressiveness (a Bull hunts more than a Rookie),
 *   - time pressure (fills get urgent as the phase clock runs down),
 *   - consensus dislocation (a big gap between my fair value and the crowd is
 *     an edge worth pinging someone about).
 * A small constant floor keeps SOME initiation happening from the first tick,
 * before any dislocation exists, so a fresh round does not sit silent.
 */
export function initiationScore(
  aggressiveness: number,
  fairValue: number,
  pub: PublicState,
): number {
  const timePressure = clamp01(1 - pub.timeRemainingMs / pub.phaseDurationMs);
  const dislocation = pub.consensus === undefined ? 0 : Math.abs(fairValue - pub.consensus);
  const score =
    0.2 + // base appetite so the floor is never dead at the open
    aggressiveness * 0.4 +
    (dislocation / 15) * 0.4 +
    timePressure * 0.3;
  return clamp01(score);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** My honest expected settlement total from my card + revealed community. */
function fairOf(priv: PrivateState): number {
  return estimateFairValue(priv.myCard, priv.revealedCommunityCards, priv.playerCount);
}

// ---------------------------------------------------------------------------
// Character strategy (bluffing personalities -- BULL/BEAR/WHALE/ROOKIE/DEALER)
// ---------------------------------------------------------------------------

/**
 * A bluffing personality. Preserves issue #27 exactly by routing every RESPOND
 * through `bluffedQuoteMid`, and adds proactive initiation (issue #28). On
 * RESOLVE it leans toward trading: because it compares its honest fair value to
 * the counterparty's *bluffed* mid, the two usually disagree and a trade prints
 * -- which is the point, a live floor. It only passes on an exact tie.
 */
export function createCharacterStrategy(character: string): Strategy {
  const cfg = PERSONALITY_CONFIGS[character] ?? PERSONALITY_CONFIGS.ROOKIE;

  return {
    name: character,
    decide(pub, priv): Action {
      const fair = fairOf(priv);

      // --- RESPOND: someone asked ME for a price -------------------------
      // This is the #27 bluff path, untouched: quote a personality-biased mid
      // (Bull talks it up, Bear down, Whale loud) two points wide.
      if (priv.pendingForMe) {
        const mid = Math.round(bluffedQuoteMid(character, fair, pub.consensus, pub.rng));
        return { type: 'respondQuote', quoteId: priv.pendingForMe.quoteId, bid: mid - 1, ask: mid + 1 };
      }

      // --- RESOLVE: a quote I asked for came back ------------------------
      // Compare my honest fair value to the counterparty's mid. Lift (buy) if I
      // think the total lands above their mid, hit (sell) if below. Trading off
      // the mid -- not the bid/ask edges -- means a character almost always
      // acts, keeping bot<->bot flow constant.
      if (priv.answered) {
        const { quoteId, bid, ask } = priv.answered;
        const mid = (bid + ask) / 2;
        if (fair > mid) return { type: 'lift', quoteId };
        if (fair < mid) return { type: 'hit', quoteId };
        return { type: 'pass' };
      }

      // --- INITIATE: nothing on my plate -> maybe ping a target ----------
      const score = initiationScore(cfg.aggressiveness, fair, pub);
      if (pub.rng() < score) {
        const target = pickTarget(pub.targets, pub.rng);
        if (target) return { type: 'requestQuote', targetId: target.id };
      }
      return { type: 'pass' };
    },
  };
}

// ---------------------------------------------------------------------------
// Honest baseline strategy
// ---------------------------------------------------------------------------

/**
 * The honest baseline: no deception. It quotes its true fair value and only
 * trades when the counterparty's price gives it a real edge (lift below fair,
 * hit above fair, otherwise pass). It is the reference implementation of the
 * interface and the default for any bot without a known personality.
 */
export function createBaselineStrategy(): Strategy {
  // Middle-of-the-road appetite so the baseline participates without dominating.
  const AGGRESSIVENESS = 0.4;

  return {
    name: 'BASELINE',
    decide(pub, priv): Action {
      const fair = fairOf(priv);

      // RESPOND honestly: mid == fair, two points wide.
      if (priv.pendingForMe) {
        const mid = Math.round(fair);
        return { type: 'respondQuote', quoteId: priv.pendingForMe.quoteId, bid: mid - 1, ask: mid + 1 };
      }

      // RESOLVE on real edge only: buy strictly below fair, sell strictly above.
      if (priv.answered) {
        const { quoteId, bid, ask } = priv.answered;
        if (fair > ask) return { type: 'lift', quoteId }; // total likely above what I pay
        if (fair < bid) return { type: 'hit', quoteId };  // total likely below what I receive
        return { type: 'pass' };                          // inside the spread: no edge
      }

      // INITIATE at baseline appetite.
      const score = initiationScore(AGGRESSIVENESS, fair, pub);
      if (pub.rng() < score) {
        const target = pickTarget(pub.targets, pub.rng);
        if (target) return { type: 'requestQuote', targetId: target.id };
      }
      return { type: 'pass' };
    },
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Resolve the Strategy for a seated bot from its character. Unknown / missing
 * characters fall through to the honest baseline, so every bot always has a
 * strategy and the coordinator never has to special-case a null.
 */
export function getStrategyForCharacter(character: string | undefined): Strategy {
  if (character && character in PERSONALITY_CONFIGS) {
    return createCharacterStrategy(character);
  }
  return createBaselineStrategy();
}
