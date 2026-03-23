import type { TradingAgent, AgentContext, AgentResponse, AgentConfig, AgentActionType } from './types';

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
      const knownTotal = context.myCard + context.revealedCommunityCards.reduce((s, c) => s + c, 0);
      const unknownCount = (context.playerCount - 1) + (3 - context.revealedCommunityCards.length);
      const deckMean = 130 / 17;
      const fairValue = knownTotal + unknownCount * deckMean;

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
