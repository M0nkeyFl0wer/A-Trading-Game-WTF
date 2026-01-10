/**
 * Character-based Trading Bot Strategies
 * Each character personality translates to a unique trading algorithm
 */

import type { Trade, MarketData, Indicator, Position, CharacterType } from '@trading-game/shared';

export interface TradingStrategy {
  name: string;
  character: CharacterType;
  riskTolerance: number; // 0-1 scale
  execute(market: MarketData, position: Position): Promise<Trade | null>;
  analyzeMarket(market: MarketData): MarketSentiment;
  calculatePositionSize(balance: number, risk: number): number;
}

export interface MarketSentiment {
  bullish: number;  // 0-1 scale
  bearish: number;  // 0-1 scale
  neutral: number;  // 0-1 scale
  confidence: number; // 0-1 scale
}

/**
 * The Dealer - Market Maker Strategy
 * Provides liquidity and profits from spreads
 */
export class DealerStrategy implements TradingStrategy {
  name = 'Market Maker';
  character: CharacterType = 'DEALER';
  riskTolerance = 0.3;

  async execute(market: MarketData, position: Position): Promise<Trade | null> {
    const spread = market.ask - market.bid;
    const midPrice = (market.ask + market.bid) / 2;

    // Only trade if spread is profitable
    if (spread < market.price * 0.002) return null; // Less than 0.2% spread

    // Place limit orders on both sides
    if (position.size === 0) {
      return {
        type: 'LIMIT_BUY',
        price: market.bid + (spread * 0.1), // Improve bid by 10%
        size: this.calculatePositionSize(position.balance, 0.02),
        timestamp: Date.now(),
        character: this.character,
      };
    }

    // Market make around position
    if (Math.abs(position.size) > position.balance * 0.1) {
      // Reduce position if too large
      return {
        type: position.size > 0 ? 'LIMIT_SELL' : 'LIMIT_BUY',
        price: position.size > 0 ? market.ask - (spread * 0.1) : market.bid + (spread * 0.1),
        size: Math.abs(position.size) * 0.5,
        timestamp: Date.now(),
        character: this.character,
      };
    }

    return null;
  }

  analyzeMarket(market: MarketData): MarketSentiment {
    const buyVol = market.buyVolume ?? 0;
    const sellVol = market.sellVolume ?? 0;
    const totalVol = buyVol + sellVol;
    const volumeRatio = totalVol > 0 ? buyVol / totalVol : 0.5;
    return {
      bullish: volumeRatio * 0.5,
      bearish: (1 - volumeRatio) * 0.5,
      neutral: 0.5, // Market maker stays neutral
      confidence: 0.7,
    };
  }

  calculatePositionSize(balance: number, risk: number): number {
    return balance * risk * this.riskTolerance;
  }
}

/**
 * Bull Runner - Momentum Long Strategy
 * Aggressively buys on upward momentum
 */
export class BullStrategy implements TradingStrategy {
  name = 'Momentum Long';
  character: CharacterType = 'BULL';
  riskTolerance = 0.8;

  async execute(market: MarketData, position: Position): Promise<Trade | null> {
    const rsi = this.calculateRSI(market.priceHistory ?? []);
    const momentum = this.calculateMomentum(market.priceHistory ?? []);

    // Strong buy signal
    if (rsi > 60 && rsi < 80 && momentum > 0.02) {
      const size = this.calculatePositionSize(position.balance, 0.05);

      return {
        type: 'MARKET_BUY',
        price: market.ask,
        size: size,
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "To the moon! This is just the beginning!",
      };
    }

    // Pyramid into winning position
    if (position.size > 0 && position.pnl > position.size * 0.05) {
      if (rsi < 70 && momentum > 0) {
        return {
          type: 'MARKET_BUY',
          price: market.ask,
          size: position.size * 0.5, // Add 50% more
          timestamp: Date.now(),
          character: this.character,
          voiceLine: "Diamond hands! Buy the dip!",
        };
      }
    }

    // Take profit on extreme overbought
    if (rsi > 85 && position.size > 0) {
      return {
        type: 'MARKET_SELL',
        price: market.bid,
        size: position.size * 0.3, // Sell 30%
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "Taking some profits, but still bullish!",
      };
    }

    return null;
  }

  analyzeMarket(market: MarketData): MarketSentiment {
    const rsi = this.calculateRSI(market.priceHistory ?? []);
    const momentum = this.calculateMomentum(market.priceHistory ?? []);

    const bullishScore = Math.min(1, (rsi / 100) + (momentum > 0 ? 0.3 : 0));

    return {
      bullish: bullishScore,
      bearish: Math.max(0, 1 - bullishScore - 0.2),
      neutral: 0.2,
      confidence: Math.min(1, Math.abs(momentum) * 10),
    };
  }

  calculatePositionSize(balance: number, risk: number): number {
    return balance * risk * this.riskTolerance * 1.5; // Aggressive sizing
  }

  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i < period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;

    return 100 - (100 / (1 + rs));
  }

  private calculateMomentum(prices: number[], period: number = 10): number {
    if (prices.length < period) return 0;

    const oldPrice = prices[prices.length - period];
    const currentPrice = prices[prices.length - 1];

    return (currentPrice - oldPrice) / oldPrice;
  }
}

/**
 * Bear Necessities - Contrarian Short Strategy
 * Pessimistically shorts overextended moves
 */
export class BearStrategy implements TradingStrategy {
  name = 'Contrarian Short';
  character: CharacterType = 'BEAR';
  riskTolerance = 0.6;

  async execute(market: MarketData, position: Position): Promise<Trade | null> {
    const rsi = this.calculateRSI(market.priceHistory ?? []);
    const resistance = this.findResistance(market.priceHistory ?? []);

    // Short signal on overbought
    if (rsi > 70 && market.price > resistance * 0.98) {
      return {
        type: 'MARKET_SELL',
        price: market.bid,
        size: this.calculatePositionSize(position.balance, 0.03),
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "The crash is coming! Time to short!",
      };
    }

    // Add to short on failed breakout
    if (position.size < 0 && market.price < resistance && rsi > 60) {
      return {
        type: 'MARKET_SELL',
        price: market.bid,
        size: Math.abs(position.size) * 0.3,
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "I warned you! Markets always correct!",
      };
    }

    // Cover shorts if oversold
    if (rsi < 30 && position.size < 0) {
      return {
        type: 'MARKET_BUY',
        price: market.ask,
        size: Math.abs(position.size) * 0.5,
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "Taking profits on shorts, but stay cautious",
      };
    }

    return null;
  }

  analyzeMarket(market: MarketData): MarketSentiment {
    const rsi = this.calculateRSI(market.priceHistory ?? []);
    const trend = this.calculateTrend(market.priceHistory ?? []);

    const bearishScore = (rsi > 70 ? 0.8 : rsi > 50 ? 0.5 : 0.2) + (trend < 0 ? 0.2 : 0);

    return {
      bullish: Math.max(0, 1 - bearishScore - 0.3),
      bearish: bearishScore,
      neutral: 0.3,
      confidence: rsi > 70 || rsi < 30 ? 0.8 : 0.5,
    };
  }

  calculatePositionSize(balance: number, risk: number): number {
    return balance * risk * this.riskTolerance * 0.8; // Conservative sizing
  }

  private calculateRSI(prices: number[], period: number = 14): number {
    // Same as Bull's RSI calculation
    if (prices.length < period) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i < period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;

    return 100 - (100 / (1 + rs));
  }

  private findResistance(prices: number[]): number {
    // Simple resistance: recent high
    return Math.max(...prices.slice(-20));
  }

  private calculateTrend(prices: number[]): number {
    if (prices.length < 2) return 0;
    const recent = prices.slice(-10);
    const older = prices.slice(-20, -10);

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    return (recentAvg - olderAvg) / olderAvg;
  }
}

/**
 * The Whale - Large Order Strategy
 * Moves markets with calculated large positions
 */
export class WhaleStrategy implements TradingStrategy {
  name = 'Iceberg Orders';
  character: CharacterType = 'WHALE';
  riskTolerance = 0.5;

  private accumulationTarget = 0;
  private distributionTarget = 0;

  async execute(market: MarketData, position: Position): Promise<Trade | null> {
    const vwap = this.calculateVWAP(market);
    const volume = market.volume24h ?? 0;

    // Accumulation phase
    if (this.isAccumulationZone(market) && position.size < position.balance * 0.3) {
      // Split large order into chunks
      const chunkSize = Math.min(
        (volume * 0.001) || 1, // 0.1% of daily volume, min 1
        this.calculatePositionSize(position.balance, 0.1)
      );

      return {
        type: 'LIMIT_BUY',
        price: vwap * 0.995, // Buy below VWAP
        size: chunkSize,
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "Accumulating quietly... Small fish don't notice",
      };
    }

    // Distribution phase
    if (this.isDistributionZone(market) && position.size > 0) {
      const chunkSize = Math.min(
        (volume * 0.001) || 1,
        position.size * 0.1 // Sell 10% at a time
      );

      return {
        type: 'LIMIT_SELL',
        price: vwap * 1.005, // Sell above VWAP
        size: chunkSize,
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "I move markets... Time to distribute",
      };
    }

    // Market moving trade
    if (this.shouldMoveMarket(market, position)) {
      const direction = this.analyzeMarket(market);
      const size = position.balance * 0.2; // Large 20% position

      return {
        type: direction.bullish > 0.6 ? 'MARKET_BUY' : 'MARKET_SELL',
        price: direction.bullish > 0.6 ? market.ask : market.bid,
        size: size,
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "Follow the smart money!",
      };
    }

    return null;
  }

  analyzeMarket(market: MarketData): MarketSentiment {
    const volumeProfile = this.analyzeVolumeProfile(market);
    const accumulation = this.detectAccumulation(market);

    return {
      bullish: accumulation > 0.6 ? 0.7 : 0.3,
      bearish: accumulation < 0.4 ? 0.7 : 0.3,
      neutral: 0,
      confidence: 0.9, // Whales are always confident
    };
  }

  calculatePositionSize(balance: number, risk: number): number {
    return balance * risk * this.riskTolerance * 2; // Large positions
  }

  private calculateVWAP(market: MarketData): number {
    // Simplified VWAP
    return market.price; // Would calculate properly with price/volume data
  }

  private isAccumulationZone(market: MarketData): boolean {
    const rsi = this.calculateRSI(market.priceHistory ?? []);
    const vol24h = market.volume24h ?? 0;
    const avgVol = market.avgVolume ?? 1;
    return rsi < 40 && vol24h > avgVol;
  }

  private isDistributionZone(market: MarketData): boolean {
    const rsi = this.calculateRSI(market.priceHistory ?? []);
    const vol24h = market.volume24h ?? 0;
    const avgVol = market.avgVolume ?? 1;
    return rsi > 65 && vol24h > avgVol;
  }

  private shouldMoveMarket(market: MarketData, position: Position): boolean {
    // Move market when position is small and opportunity is big
    const vol24h = market.volume24h ?? 0;
    const avgVol = market.avgVolume ?? 1;
    return position.size < position.balance * 0.1 &&
           vol24h > avgVol * 1.5;
  }

  private analyzeVolumeProfile(market: MarketData): number {
    const buyVol = market.buyVolume ?? 0;
    const sellVol = market.sellVolume ?? 1;
    return buyVol / sellVol;
  }

  private detectAccumulation(market: MarketData): number {
    // Detect if whales are accumulating
    const open = market.open24h ?? market.price;
    const priceChange = open > 0 ? (market.price - open) / open : 0;
    const vol24h = market.volume24h ?? 0;
    const avgVol = market.avgVolume ?? 1;
    const volumeIncrease = vol24h / avgVol;

    if (priceChange < 0 && volumeIncrease > 1.5) return 0.8; // Accumulation
    if (priceChange > 0 && volumeIncrease > 1.5) return 0.2; // Distribution
    return 0.5; // Neutral
  }

  private calculateRSI(prices: number[]): number {
    // Reuse RSI calculation
    if (prices.length < 14) return 50;
    // ... same implementation as above
    return 50;
  }
}

/**
 * Fresh Trader - Learning Algorithm
 * Uses reinforcement learning and mimics successful strategies
 */
export class RookieStrategy implements TradingStrategy {
  name = 'Random Walk Learning';
  character: CharacterType = 'ROOKIE';
  riskTolerance = 0.9;

  private learningRate = 0.1;
  private explorationRate = 0.2;
  private qTable: Map<string, number> = new Map();

  async execute(market: MarketData, position: Position): Promise<Trade | null> {
    const state = this.getState(market, position);

    // Exploration vs Exploitation
    if (Math.random() < this.explorationRate) {
      // Random exploration
      return this.randomTrade(market, position);
    }

    // Copy best performing strategy from other bots
    const bestStrategy = this.findBestStrategy();
    if (bestStrategy) {
      return this.mimicStrategy(bestStrategy, market, position);
    }

    // Default chaotic behavior
    const actions = ['BUY', 'SELL', 'HOLD'];
    const action = actions[Math.floor(Math.random() * actions.length)];

    if (action === 'BUY') {
      return {
        type: 'MARKET_BUY',
        price: market.ask,
        size: this.calculatePositionSize(position.balance, 0.02),
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "Is this good? I read about this online!",
      };
    } else if (action === 'SELL' && position.size > 0) {
      return {
        type: 'MARKET_SELL',
        price: market.bid,
        size: position.size * 0.5,
        timestamp: Date.now(),
        character: this.character,
        voiceLine: "Oh no! Should I sell? YOLO!",
      };
    }

    return null;
  }

  analyzeMarket(market: MarketData): MarketSentiment {
    // Rookie has no idea, random sentiment
    const random = Math.random();

    return {
      bullish: random,
      bearish: 1 - random,
      neutral: Math.random() * 0.5,
      confidence: Math.random() * 0.3, // Low confidence
    };
  }

  calculatePositionSize(balance: number, risk: number): number {
    // Random position sizing (chaotic)
    const randomMultiplier = 0.5 + Math.random() * 1.5;
    return balance * risk * this.riskTolerance * randomMultiplier;
  }

  private getState(market: MarketData, position: Position): string {
    // Simplified state representation
    const priceLevel = Math.floor(market.price / 100) * 100;
    const positionLevel = position.size > 0 ? 'LONG' : position.size < 0 ? 'SHORT' : 'FLAT';
    return `${priceLevel}_${positionLevel}`;
  }

  private randomTrade(market: MarketData, position: Position): Trade {
    const actions = ['MARKET_BUY', 'MARKET_SELL', 'LIMIT_BUY', 'LIMIT_SELL'];
    const action = actions[Math.floor(Math.random() * actions.length)];

    return {
      type: action as any,
      price: action.includes('BUY') ? market.ask : market.bid,
      size: this.calculatePositionSize(position.balance, Math.random() * 0.05),
      timestamp: Date.now(),
      character: this.character,
      voiceLine: "YOLO! Let's see what happens!",
    };
  }

  private findBestStrategy(): TradingStrategy | null {
    // Would look at other bot performances and copy the best
    return null; // Placeholder
  }

  private async mimicStrategy(
    strategy: TradingStrategy,
    market: MarketData,
    position: Position
  ): Promise<Trade | null> {
    // Copy the strategy but with rookie's chaotic twist
    const originalTrade = await strategy.execute(market, position);
    if (!originalTrade) return null;

    // Add random noise to the copied strategy
    return {
      ...originalTrade,
      size: (originalTrade.size ?? 1) * (0.8 + Math.random() * 0.4),
      character: this.character,
      voiceLine: "I'm doing what they're doing!",
    };
  }

  private updateQLearning(state: string, action: string, reward: number): void {
    const key = `${state}_${action}`;
    const oldValue = this.qTable.get(key) || 0;
    this.qTable.set(key, oldValue + this.learningRate * (reward - oldValue));
  }
}

// Export strategy factory
export function createStrategy(character: string): TradingStrategy {
  switch (character) {
    case 'DEALER':
      return new DealerStrategy();
    case 'BULL':
      return new BullStrategy();
    case 'BEAR':
      return new BearStrategy();
    case 'WHALE':
      return new WhaleStrategy();
    case 'ROOKIE':
      return new RookieStrategy();
    default:
      throw new Error(`Unknown character: ${character}`);
  }
}