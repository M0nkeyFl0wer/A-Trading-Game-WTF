import type { TradingAgent, AgentContext, AgentResponse, AgentConfig, AgentActionType } from './types';
// Fair value now lives in @trading-game/shared so the server and the web client
// price against ONE function (issue #24). Re-exported below to keep this
// module's existing import site (botService) working unchanged.
import { estimateFairValue } from '@trading-game/shared';

// ---------------------------------------------------------------------------
// Default configs per personality
// ---------------------------------------------------------------------------

export const PERSONALITY_CONFIGS: Record<string, AgentConfig> = {
  BULL: {
    aggressiveness: 0.75,
    riskTolerance: 0.8,
    spreadWidth: 4,
    maxPosition: 5,
    maxOrdersPerTick: 2,
    commentFrequency: 0.4,
  },
  BEAR: {
    aggressiveness: 0.6,
    riskTolerance: 0.3,
    spreadWidth: 5,
    maxPosition: 3,
    maxOrdersPerTick: 1,
    commentFrequency: 0.3,
  },
  WHALE: {
    aggressiveness: 0.5,
    riskTolerance: 0.9,
    spreadWidth: 2,
    maxPosition: 8,
    maxOrdersPerTick: 2,
    commentFrequency: 0.2,
  },
  ROOKIE: {
    aggressiveness: 0.4,
    riskTolerance: 0.5,
    spreadWidth: 8,
    maxPosition: 2,
    maxOrdersPerTick: 1,
    commentFrequency: 0.6,
  },
  DEALER: {
    aggressiveness: 0.45,
    riskTolerance: 0.4,
    spreadWidth: 3,
    maxPosition: 4,
    maxOrdersPerTick: 2,
    commentFrequency: 0.15,
  },
};

// ---------------------------------------------------------------------------
// Commentary templates per personality
// ---------------------------------------------------------------------------

const BULL_COMMENTS = [
  "This is going up, I can feel it!",
  "Loading up on the long side.",
  "Who's selling at these prices? I'll take them all!",
  "Bull market, baby!",
];

const BEAR_COMMENTS = [
  "This doesn't add up. I'm selling.",
  "The total is going to be lower than people think.",
  "Everyone's too optimistic. Shorting here.",
  "Classic overvaluation.",
];

const WHALE_COMMENTS = [
  "I'll make a market. Who wants to trade?",
  "Size for size. Let's go.",
  "Tightening the spread.",
];

const ROOKIE_COMMENTS = [
  "Uh... is this a good price?",
  "I think I'll buy... no wait, sell... no, buy!",
  "What does everyone else think?",
  "YOLO!",
];

const DEALER_COMMENTS = [
  "The market is open.",
  "Interesting price action.",
  "Volume picking up.",
];

// ---------------------------------------------------------------------------
// Fair value estimation -- moved into @trading-game/shared (issue #24) so the
// bot pricing here and the number the human sees on the web client can never
// drift onto different constants. Re-exported so botService's existing
// `import { estimateFairValue } from '../agents/personalities'` keeps working.
// ---------------------------------------------------------------------------

export { estimateFairValue };

// ---------------------------------------------------------------------------
// Bluff model (issue #27)
//
// A bot that quotes `fairValue ± jitter` is honest -- a sharp player just picks
// off the jitter and a casual player has nothing to read. Instead each
// character quotes AWAY from its true fair value by a personality-shaped bluff,
// modulated by the room's consensus signal (issue #23):
//
//   - BULL  talks it up   -> quotes above fair, and leans harder into a rising
//                            crowd (momentum).
//   - BEAR  talks it down -> quotes below fair, leans harder into a falling
//                            crowd.
//   - WHALE quotes to move you -> ignores its own fair value and prints a LOUD
//                            two-way well beyond consensus, dragging the crowd
//                            (the EWMA follows the print). Amplifies whichever
//                            way the room is already drifting.
//   - ROOKIE is honest-but-sloppy: no directional bias, just a wide, noisy mid.
//   - DEALER is the closest to a fair market maker: a whisper of noise.
//
// It stays BEATABLE and LEGIBLE on purpose: the bias is a fixed, learnable
// number per character, so a player who watches can fade the Bull and follow
// the Whale. The randomness only stops it being pixel-perfect predictable.
// ---------------------------------------------------------------------------

export interface BluffProfile {
  /** Directional skew off the bot's TRUE fair value, in points. +up / -down. */
  deception: number;
  /** How hard it leans on the crowd: multiplies (consensus - fair). */
  consensusPush: number;
  /** Full width of the uniform noise added to the mid, in points. */
  noise: number;
  /** Whale-style manipulation: quote relative to consensus, not fair value. */
  movesTheCrowd?: boolean;
}

export const BLUFF_PROFILES: Record<string, BluffProfile> = {
  BULL:   { deception:  6, consensusPush: 0.3, noise: 3 },
  BEAR:   { deception: -6, consensusPush: 0.3, noise: 3 },
  WHALE:  { deception:  0, consensusPush: 0,   noise: 3, movesTheCrowd: true },
  ROOKIE: { deception:  0, consensusPush: 0,   noise: 8 },
  DEALER: { deception:  0, consensusPush: 0,   noise: 2 },
};

// A whale's "loud" quote sits this many points beyond consensus, in whichever
// direction the crowd is already leaning -- enough to visibly drag the EWMA.
const WHALE_LOUDNESS = 12;

/**
 * Compute the mid a bot QUOTES, given its true fair value and the room's
 * consensus. Deterministic apart from the injected rng (defaults to
 * Math.random), which makes it unit-testable.
 *
 * @param character  the bot's personality key
 * @param fairValue  the bot's own honest fair value (from estimateFairValue)
 * @param consensus  the room's current market belief, or undefined pre-seed
 * @param rng        () => number in [0,1); injectable for tests
 */
export function bluffedQuoteMid(
  character: string,
  fairValue: number,
  consensus: number | undefined,
  rng: () => number = Math.random,
): number {
  const p = BLUFF_PROFILES[character] ?? BLUFF_PROFILES.ROOKIE;
  const noise = (rng() - 0.5) * p.noise;

  if (p.movesTheCrowd) {
    // The whale quotes to MOVE the room, not to reveal what it knows. It steps
    // loudly beyond consensus in the direction the crowd is already drifting
    // (relative to a neutral anchor of the whale's own fair value); if the room
    // is flat it pumps upward. The far-from-consensus mid drags the EWMA.
    const anchor = consensus ?? fairValue;
    const lean = anchor - fairValue;
    const dir = lean > 0.5 ? 1 : lean < -0.5 ? -1 : 1;
    return anchor + dir * WHALE_LOUDNESS + noise;
  }

  // Bull/Bear/Rookie/Dealer: bias off fair value, then lean into the crowd's
  // deviation from fair (momentum). consensusPush is 0 for the honest ones.
  const crowdLean = consensus === undefined ? 0 : p.consensusPush * (consensus - fairValue);
  return fairValue + p.deception + crowdLean + noise;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPersonalityAgent(
  id: string,
  name: string,
  character: string,
  configOverrides?: Partial<AgentConfig>,
): TradingAgent {
  const baseConfig = PERSONALITY_CONFIGS[character] || PERSONALITY_CONFIGS.ROOKIE;
  const config: AgentConfig = { ...baseConfig, ...configOverrides };

  return {
    id,
    name,
    character,
    config,

    activate(context: AgentContext): AgentResponse {
      // 1. Estimate fair value
      const fairValue = estimateFairValue(
        context.myCard,
        context.revealedCommunityCards,
        context.playerCount,
      );

      // 2. Calculate activation based on:
      //    - EV delta from market (bigger delta = higher activation)
      //    - Time pressure (less time = higher activation)
      //    - Personality aggressiveness
      const marketMid = context.orderBook.bestBid !== null && context.orderBook.bestAsk !== null
        ? (context.orderBook.bestBid + context.orderBook.bestAsk) / 2
        : context.orderBook.lastTradePrice ?? fairValue;

      const evDelta = Math.abs(fairValue - marketMid);
      const timePressure = 1 - (context.timeRemainingMs / 30000); // 0 at start, 1 at end
      const baseActivation = Math.min(1, (evDelta / 20) * config.aggressiveness + timePressure * 0.3);

      // Position check: reduce activation if near max position
      const positionUsage = Math.abs(context.socialState.myNetPosition) / config.maxPosition;
      const positionDamper = positionUsage > 0.8 ? 0.3 : 1.0;

      const activation = Math.min(1, baseActivation * positionDamper);

      // 3. If activation too low, just wait
      if (activation < 0.15) {
        return {
          activation,
          wantsFloor: false,
          interrupt: false,
          yieldTo: null,
          actions: [{ type: 'wait' }],
          commentary: null,
        };
      }

      // 4. Build orders based on personality
      const actions = buildOrders(context, config, character, fairValue);

      // 5. Decide if this is an interrupt (crossing the spread)
      const interrupt = activation > 0.7 && evDelta > 5;

      // 6. Maybe generate commentary
      let commentary: string | null = null;
      if (Math.random() < config.commentFrequency * activation) {
        const pool = getCommentPool(character);
        commentary = pool[Math.floor(Math.random() * pool.length)];
      }

      // 7. Yield logic: ROOKIE yields to WHALE in busy markets
      let yieldTo: string | null = null;
      if (character === 'ROOKIE' && context.socialState.recentVolume > 3) {
        yieldTo = 'WHALE';
      }

      return {
        activation,
        wantsFloor: actions.length > 0 && actions[0].type !== 'wait',
        interrupt,
        yieldTo,
        actions,
        commentary,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Order generation per personality
// ---------------------------------------------------------------------------

function buildOrders(
  ctx: AgentContext,
  config: AgentConfig,
  character: string,
  fairValue: number,
): AgentActionType[] {
  const actions: AgentActionType[] = [];
  const jitter = () => (Math.random() - 0.5) * 4;

  // First: cancel mispriced orders (> spreadWidth * 2 from fair value)
  for (const order of ctx.socialState.myOpenOrders) {
    const distance = Math.abs(order.price - fairValue);
    if (distance > config.spreadWidth * 2) {
      actions.push({ type: 'cancel', orderId: order.id });
    }
  }

  // Don't post new orders if we already have enough open
  const openCount = ctx.socialState.myOpenOrders.filter(
    o => o.status === 'open' || o.status === 'partial',
  ).length;
  if (openCount >= 4) return actions; // leave room for 1 more under the 5-order limit

  const halfSpread = config.spreadWidth / 2;

  switch (character) {
    case 'BULL': {
      // Aggressive bids, reluctant asks
      actions.push({
        type: 'bid',
        price: Math.round((fairValue + halfSpread * 0.5 + jitter()) * 100) / 100,
        quantity: 1 + Math.floor(Math.random() * 2),
      });
      if (Math.random() < 0.3) {
        actions.push({
          type: 'ask',
          price: Math.round((fairValue + config.spreadWidth * 1.5 + jitter()) * 100) / 100,
          quantity: 1,
        });
      }
      break;
    }
    case 'BEAR': {
      // Aggressive asks, reluctant bids
      actions.push({
        type: 'ask',
        price: Math.round((fairValue - halfSpread * 0.5 + jitter()) * 100) / 100,
        quantity: 1 + Math.floor(Math.random() * 1),
      });
      if (Math.random() < 0.3) {
        actions.push({
          type: 'bid',
          price: Math.round((fairValue - config.spreadWidth * 1.5 + jitter()) * 100) / 100,
          quantity: 1,
        });
      }
      break;
    }
    case 'WHALE': {
      // Tight two-sided market, large size
      const qty = 2 + Math.floor(Math.random() * 3);
      actions.push({
        type: 'bid',
        price: Math.round((fairValue - halfSpread + jitter()) * 100) / 100,
        quantity: qty,
      });
      actions.push({
        type: 'ask',
        price: Math.round((fairValue + halfSpread + jitter()) * 100) / 100,
        quantity: qty,
      });
      break;
    }
    case 'ROOKIE': {
      // Wide, random, sometimes wrong-sided
      const side: 'bid' | 'ask' = Math.random() > 0.5 ? 'bid' : 'ask';
      const chaos = (Math.random() - 0.5) * config.spreadWidth * 2;
      actions.push({
        type: side,
        price: Math.round((fairValue + chaos) * 100) / 100,
        quantity: 1,
      });
      break;
    }
    case 'DEALER':
    default: {
      // Balanced market-making
      actions.push({
        type: 'bid',
        price: Math.round((fairValue - halfSpread + jitter()) * 100) / 100,
        quantity: 1 + Math.floor(Math.random() * 1),
      });
      actions.push({
        type: 'ask',
        price: Math.round((fairValue + halfSpread + jitter()) * 100) / 100,
        quantity: 1 + Math.floor(Math.random() * 1),
      });
      break;
    }
  }

  return actions.slice(0, config.maxOrdersPerTick);
}

function getCommentPool(character: string): string[] {
  switch (character) {
    case 'BULL': return BULL_COMMENTS;
    case 'BEAR': return BEAR_COMMENTS;
    case 'WHALE': return WHALE_COMMENTS;
    case 'ROOKIE': return ROOKIE_COMMENTS;
    default: return DEALER_COMMENTS;
  }
}
