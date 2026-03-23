import type { Order, MatchedTrade, TradingPhase } from '@trading-game/shared';

export interface AgentContext {
  agentId: string;
  myCard: number;
  revealedCommunityCards: number[];
  orderBook: {
    bids: Array<{ price: number; quantity: number }>;
    asks: Array<{ price: number; quantity: number }>;
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
    lastTradePrice: number | null;
  };
  matchedTrades: MatchedTrade[];
  phase: TradingPhase;
  timeRemainingMs: number;
  playerCount: number;
  socialState: {
    lastTrader: string | null;
    priceDirection: 'up' | 'down' | 'flat';
    recentVolume: number;  // trades in last 10 seconds
    myOpenOrders: Order[];
    myNetPosition: number;  // positive = long, negative = short
    myBalance: number;
  };
}

export type AgentActionType =
  | { type: 'bid'; price: number; quantity: number }
  | { type: 'ask'; price: number; quantity: number }
  | { type: 'cancel'; orderId: string }
  | { type: 'cancel_all' }
  | { type: 'wait' };

export interface AgentResponse {
  activation: number;        // 0.0-1.0 how strongly this agent wants to act
  wantsFloor: boolean;       // does it want to submit orders?
  interrupt: boolean;        // is it crossing the spread aggressively?
  yieldTo: string | null;    // defer to another agent ID
  actions: AgentActionType[];
  commentary: string | null; // what the agent would say (voice line)
}

export interface AgentConfig {
  // Personality parameters that users can tune
  aggressiveness: number;    // 0.0-1.0 -- maps to activation curve steepness
  riskTolerance: number;     // 0.0-1.0 -- how much of balance to risk
  spreadWidth: number;       // how wide bid-ask spread (in price points)
  maxPosition: number;       // max net contracts (positive or negative)
  maxOrdersPerTick: number;  // max orders to submit per tick
  commentFrequency: number;  // 0.0-1.0 -- how chatty
}

export interface TradingAgent {
  id: string;
  name: string;
  character: string;
  config: AgentConfig;

  // Called every tick by the coordinator
  activate(context: AgentContext): AgentResponse;

  // Called when agent's cooldown resets
  onCooldownReset?(): void;
}
