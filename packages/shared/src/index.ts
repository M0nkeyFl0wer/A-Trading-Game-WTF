export type DeckValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 20 | -10;

export type Deck = DeckValue[];

export interface TickConfig {
  tickSize: number;
}

export interface TableConfig {
  seats: number;
  roundSeconds: number;
  deck: Deck;
  tick: TickConfig;
  houseFee: number;
}

export const DEFAULT_TICK_PRESETS = [0.1, 1, 5];
export const DEFAULT_DECK: Deck = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,20,-10];
export const DEFAULT_TABLE_CONFIG: TableConfig = {
  seats: 5,
  roundSeconds: 120,
  deck: DEFAULT_DECK,
  tick: { tickSize: 0.1 },
  houseFee: 0.01,
};

export function computeEV(cardDelta: number): number {
  return 61.2 + cardDelta;
}

export * from './security';
export * from './voice';

// ============================================================================
// Character Types (moved from web app for cross-package use)
// ============================================================================

export type CharacterType = 'DEALER' | 'BULL' | 'BEAR' | 'WHALE' | 'ROOKIE';

export type CharacterExpression =
  | 'neutral' | 'happy' | 'sad' | 'excited'
  | 'worried' | 'thinking' | 'celebrating' | 'shocked';

// ============================================================================
// Market & Trading Types (for bot package)
// ============================================================================

export interface MarketData {
  price: number;
  bid: number;
  ask: number;
  volume: number;
  high24h: number;
  low24h: number;
  change24h: number;
  timestamp: number;
  // Extended fields for bot strategies
  open24h?: number;
  volume24h?: number;
  avgVolume?: number;
  buyVolume?: number;
  sellVolume?: number;
  avgTradeSize?: number;
  priceHistory?: number[];
}

export interface Position {
  size: number;
  entryPrice: number;
  pnl: number;
  balance: number;
}

export type TradeType = 'buy' | 'sell' | 'MARKET_BUY' | 'MARKET_SELL' | 'LIMIT_BUY' | 'LIMIT_SELL';

export interface Trade {
  from?: string;  // Optional for internal bot trades
  to?: string;    // Optional for internal bot trades
  price: number;
  quantity?: number;  // Use size for bot strategies
  size?: number;  // Alternative to quantity for bot strategies
  timestamp?: number;
  type?: TradeType;
  character?: CharacterType;  // Bot character that made the trade
  voiceLine?: string;  // Character voice line to play
}

export interface BotResult {
  success: boolean;
  trade?: Trade;
  error?: string;
  executionTime: number;
  memoryUsed: number;
}

export type Indicator = 'RSI' | 'MACD' | 'VWAP' | 'SMA' | 'EMA' | 'BOLLINGER';
