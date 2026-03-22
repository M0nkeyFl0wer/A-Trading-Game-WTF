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
export declare const DEFAULT_TICK_PRESETS: number[];
export declare const DEFAULT_DECK: Deck;
export declare const DEFAULT_TABLE_CONFIG: TableConfig;
export declare function computeEV(cardDelta: number): number;
export * from './security';
export * from './voice';
export type CharacterType = 'DEALER' | 'BULL' | 'BEAR' | 'WHALE' | 'ROOKIE';
export type CharacterExpression = 'neutral' | 'happy' | 'sad' | 'excited' | 'worried' | 'thinking' | 'celebrating' | 'shocked';
export interface MarketData {
    price: number;
    bid: number;
    ask: number;
    volume: number;
    high24h: number;
    low24h: number;
    change24h: number;
    timestamp: number;
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
    from?: string;
    to?: string;
    price: number;
    quantity?: number;
    size?: number;
    timestamp?: number;
    type?: TradeType;
    character?: CharacterType;
    voiceLine?: string;
}
export interface BotResult {
    success: boolean;
    trade?: Trade;
    error?: string;
    executionTime: number;
    memoryUsed: number;
}
export type Indicator = 'RSI' | 'MACD' | 'VWAP' | 'SMA' | 'EMA' | 'BOLLINGER';
//# sourceMappingURL=index.d.ts.map