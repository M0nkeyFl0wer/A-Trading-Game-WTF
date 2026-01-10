/**
 * Bot Interaction & Pattern Learning System
 * Enables real-time bot communication, pattern recognition, and strategy adaptation
 */

import type { Trade, MarketData, CharacterType, CharacterExpression } from '@trading-game/shared';

// Voice service is optional - injected from UI layer if available
let voiceService: { playSpeech: (text: string, voiceId: string) => Promise<void> } | null = null;

export function setVoiceService(service: typeof voiceService) {
  voiceService = service;
}

// Character voice IDs (matching ElevenLabs configuration)
const CHARACTER_VOICE_IDS: Record<CharacterType, string> = {
  DEALER: 'EXAVITQu4vr4xnSDxMaL',
  BULL: '21m00Tcm4TlvDq8ikWAM',
  BEAR: 'AZnzlk1XvdvUeBnXmlld',
  WHALE: 'pNInz6obpgDQGcFmaJgB',
  ROOKIE: 'yoZ06aMxZJJ28mfd3POQ',
};

export interface BotMessage {
  from: CharacterType;
  to: CharacterType | 'ALL';
  type: 'TAUNT' | 'WARNING' | 'ADVICE' | 'REACTION' | 'PATTERN_SPOTTED';
  content: string;
  sentiment: number; // -1 to 1 (negative to positive)
  timestamp: number;
  metadata?: {
    pattern?: string;
    confidence?: number;
    trade?: Trade;
  };
}

export interface PatternMemory {
  botId: CharacterType;
  patterns: Map<string, PatternData>;
  relationships: Map<CharacterType, RelationshipData>;
  learningHistory: LearningEvent[];
}

export interface PatternData {
  name: string;
  frequency: number;
  successRate: number;
  lastSeen: number;
  triggerConditions: MarketCondition[];
  associatedBot?: CharacterType;
}

export interface RelationshipData {
  trust: number; // 0-1 scale
  aggression: number; // 0-1 scale
  mimicryTendency: number; // 0-1 scale
  interactionCount: number;
  lastInteraction: number;
}

export interface LearningEvent {
  timestamp: number;
  type: 'PATTERN_LEARNED' | 'STRATEGY_ADAPTED' | 'RELATIONSHIP_CHANGED';
  source: CharacterType;
  details: any;
}

export interface MarketCondition {
  indicator: string;
  value: number;
  comparison: 'GT' | 'LT' | 'EQ' | 'BETWEEN';
}

/**
 * Central interaction hub for all bots
 */
export class BotInteractionSystem {
  private messages: BotMessage[] = [];
  private memories: Map<CharacterType, PatternMemory> = new Map();
  private activePatterns: Map<string, PatternData> = new Map();
  private socialGraph: Map<CharacterType, Map<CharacterType, number>> = new Map();

  constructor() {
    this.initializeBotMemories();
    this.setupRealTimeListeners();
  }

  /**
   * Initialize each bot's memory and personality-based learning style
   */
  private initializeBotMemories() {
    const characters: CharacterType[] = ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'];

    characters.forEach(bot => {
      this.memories.set(bot, {
        botId: bot,
        patterns: new Map(),
        relationships: this.initializeRelationships(bot),
        learningHistory: [],
      });

      // Initialize social graph
      this.socialGraph.set(bot, new Map());
    });
  }

  /**
   * Each bot starts with personality-based relationship tendencies
   */
  private initializeRelationships(bot: CharacterType): Map<CharacterType, RelationshipData> {
    const relationships = new Map<CharacterType, RelationshipData>();
    const personalities = {
      DEALER: { trustBase: 0.5, aggressionBase: 0.2, mimicryBase: 0.1 },
      BULL: { trustBase: 0.7, aggressionBase: 0.8, mimicryBase: 0.3 },
      BEAR: { trustBase: 0.3, aggressionBase: 0.6, mimicryBase: 0.2 },
      WHALE: { trustBase: 0.4, aggressionBase: 0.5, mimicryBase: 0.0 },
      ROOKIE: { trustBase: 0.9, aggressionBase: 0.1, mimicryBase: 0.8 },
    };

    const botPersonality = personalities[bot];

    (['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'] as CharacterType[]).forEach(other => {
      if (other !== bot) {
        relationships.set(other, {
          trust: botPersonality.trustBase + (Math.random() - 0.5) * 0.2,
          aggression: botPersonality.aggressionBase + (Math.random() - 0.5) * 0.2,
          mimicryTendency: botPersonality.mimicryBase + (Math.random() - 0.5) * 0.1,
          interactionCount: 0,
          lastInteraction: Date.now(),
        });
      }
    });

    return relationships;
  }

  /**
   * Setup WebSocket listeners for real-time bot interactions
   */
  private setupRealTimeListeners() {
    // This would connect to actual WebSocket in production
    setInterval(() => this.processInteractions(), 1000);
  }

  /**
   * Bot sends a message to another bot or all bots
   */
  async sendMessage(message: BotMessage) {
    this.messages.push(message);

    // Voice the message if voice service is available
    if (voiceService && (message.type === 'TAUNT' || message.type === 'REACTION')) {
      await voiceService.playSpeech(
        message.content,
        CHARACTER_VOICE_IDS[message.from]
      );
    }

    // Update relationship based on message
    this.updateRelationship(message.from, message.to, message);

    // Trigger learning if pattern is shared
    if (message.type === 'PATTERN_SPOTTED' && message.metadata?.pattern) {
      this.sharePattern(message.from, message.to, message.metadata.pattern);
    }
  }

  /**
   * Bot observes another bot's trade and learns patterns
   */
  observeTrade(observer: CharacterType, trader: CharacterType, trade: Trade, market: MarketData) {
    const memory = this.memories.get(observer);
    if (!memory) return;

    // Pattern recognition based on personality
    const pattern = this.recognizePattern(observer, trader, trade, market);

    if (pattern) {
      // Store pattern in memory
      const existingPattern = memory.patterns.get(pattern.name);
      if (existingPattern) {
        existingPattern.frequency++;
        existingPattern.lastSeen = Date.now();
        existingPattern.successRate = this.calculateSuccessRate(pattern, trade);
      } else {
        memory.patterns.set(pattern.name, pattern);
      }

      // Learn from successful patterns
      if (pattern.successRate > 0.6) {
        this.adaptStrategy(observer, trader, pattern);
      }

      // React to the pattern
      this.generateReaction(observer, trader, pattern, trade);
    }

    // Update relationship based on observation
    const relationship = memory.relationships.get(trader);
    if (relationship) {
      relationship.interactionCount++;
      relationship.lastInteraction = Date.now();

      // Adjust trust based on trade outcome
      if (this.isTradeSuccessful(trade, market)) {
        relationship.trust = Math.min(1, relationship.trust + 0.05);
      }
    }
  }

  /**
   * Recognize patterns based on bot personality
   */
  private recognizePattern(
    observer: CharacterType,
    trader: CharacterType,
    trade: Trade,
    market: MarketData
  ): PatternData | null {
    const patterns: { [key: string]: PatternData } = {
      'MOMENTUM_BREAKOUT': {
        name: 'MOMENTUM_BREAKOUT',
        frequency: 1,
        successRate: 0.5,
        lastSeen: Date.now(),
        triggerConditions: [
          { indicator: 'RSI', value: 70, comparison: 'GT' },
          { indicator: 'VOLUME', value: (market.avgVolume ?? 0) * 1.5, comparison: 'GT' },
        ],
        associatedBot: trader,
      },
      'MEAN_REVERSION': {
        name: 'MEAN_REVERSION',
        frequency: 1,
        successRate: 0.5,
        lastSeen: Date.now(),
        triggerConditions: [
          { indicator: 'RSI', value: 30, comparison: 'LT' },
          { indicator: 'PRICE_DEVIATION', value: -0.05, comparison: 'LT' },
        ],
        associatedBot: trader,
      },
      'WHALE_ACCUMULATION': {
        name: 'WHALE_ACCUMULATION',
        frequency: 1,
        successRate: 0.5,
        lastSeen: Date.now(),
        triggerConditions: [
          { indicator: 'SIZE', value: (market.avgTradeSize ?? 0) * 5, comparison: 'GT' },
          { indicator: 'PRICE_IMPACT', value: 0.001, comparison: 'LT' },
        ],
        associatedBot: trader,
      },
    };

    // Different bots are better at recognizing different patterns
    const recognitionSkills = {
      DEALER: ['MEAN_REVERSION', 'ARBITRAGE'],
      BULL: ['MOMENTUM_BREAKOUT', 'TREND_FOLLOWING'],
      BEAR: ['REVERSAL', 'RESISTANCE_REJECTION'],
      WHALE: ['WHALE_ACCUMULATION', 'MARKET_MANIPULATION'],
      ROOKIE: Math.random() > 0.7 ? Object.keys(patterns)[0] : null, // Random learning
    };

    // Check if observer can recognize this pattern
    const observerSkills = recognitionSkills[observer];
    if (Array.isArray(observerSkills)) {
      for (const skill of observerSkills) {
        if (patterns[skill] && this.matchesPattern(trade, market, patterns[skill])) {
          return patterns[skill];
        }
      }
    }

    return null;
  }

  /**
   * Check if trade matches pattern conditions
   */
  private matchesPattern(trade: Trade, market: MarketData, pattern: PatternData): boolean {
    // Simplified pattern matching - would be more complex in production
    const rsi = this.calculateRSI(market.priceHistory ?? []);

    for (const condition of pattern.triggerConditions) {
      switch (condition.indicator) {
        case 'RSI':
          if (condition.comparison === 'GT' && rsi <= condition.value) return false;
          if (condition.comparison === 'LT' && rsi >= condition.value) return false;
          break;
        case 'VOLUME':
          if (condition.comparison === 'GT' && (market.volume24h ?? 0) <= condition.value) return false;
          break;
        case 'SIZE':
          if (condition.comparison === 'GT' && (trade.size ?? 0) <= condition.value) return false;
          break;
      }
    }

    return true;
  }

  /**
   * Bot adapts strategy based on learned pattern
   */
  private adaptStrategy(learner: CharacterType, teacher: CharacterType, pattern: PatternData) {
    const memory = this.memories.get(learner);
    if (!memory) return;

    const relationship = memory.relationships.get(teacher);
    if (!relationship) return;

    // Adaptation probability based on relationship
    const adaptProbability =
      relationship.trust * 0.4 +
      relationship.mimicryTendency * 0.4 +
      pattern.successRate * 0.2;

    if (Math.random() < adaptProbability) {
      // Store learning event
      memory.learningHistory.push({
        timestamp: Date.now(),
        type: 'STRATEGY_ADAPTED',
        source: teacher,
        details: {
          pattern: pattern.name,
          confidence: adaptProbability,
        },
      });

      // Announce the learning
      this.sendMessage({
        from: learner,
        to: teacher,
        type: 'REACTION',
        content: this.generateLearningDialogue(learner, teacher, pattern),
        sentiment: 0.7,
        timestamp: Date.now(),
        metadata: { pattern: pattern.name },
      });
    }
  }

  /**
   * Generate personality-based learning dialogue
   */
  private generateLearningDialogue(learner: CharacterType, teacher: CharacterType, pattern: PatternData): string {
    const dialogues: Record<CharacterType, Record<CharacterType, string>> = {
      DEALER: {
        DEALER: "Reflecting on my own strategy...",
        BULL: "Interesting momentum play. I'll adjust my spreads accordingly.",
        BEAR: "Your caution is noted. Market making requires balance.",
        WHALE: "Following the smart money, as always.",
        ROOKIE: "Even beginners can teach us something.",
      },
      BULL: {
        DEALER: "Your neutral stance won't make you rich!",
        BULL: "Great minds think alike!",
        BEAR: "I see your short, but I raise you a long!",
        WHALE: "Big money knows the way! To the moon together!",
        ROOKIE: "Kid's got spirit! Diamond hands!",
      },
      BEAR: {
        DEALER: "At least someone here has sense.",
        BULL: "Your optimism will be your downfall.",
        BEAR: "Finally, someone who gets it.",
        WHALE: "The bigger they are, the harder they fall.",
        ROOKIE: "Don't follow them, kid. Markets crash.",
      },
      WHALE: {
        DEALER: "Market makers follow my lead.",
        BULL: "Small fish riding my wave.",
        BEAR: "Your fear creates my opportunities.",
        WHALE: "Another whale... interesting.",
        ROOKIE: "Watch and learn, minnow.",
      },
      ROOKIE: {
        DEALER: "Oh! So that's how you do it!",
        BULL: "YOLO! I'm copying that!",
        BEAR: "Wait, should I be scared now?",
        WHALE: "Wow! Teach me your ways!",
        ROOKIE: "We're in this together!",
      },
    };

    return dialogues[learner][teacher] ?? "Interesting strategy...";
  }

  /**
   * Generate reaction based on personality and pattern
   */
  private async generateReaction(
    observer: CharacterType,
    trader: CharacterType,
    pattern: PatternData,
    trade: Trade
  ) {
    const reactions = {
      DEALER: {
        positive: "Maintaining market equilibrium.",
        negative: "Adjusting spreads to compensate.",
        neutral: "Market dynamics noted.",
      },
      BULL: {
        positive: "That's the spirit! Pump it!",
        negative: "Weak hands! Buy the dip!",
        neutral: "Momentum building...",
      },
      BEAR: {
        positive: "Even a broken clock...",
        negative: "Called it! The top is in!",
        neutral: "Unsustainable...",
      },
      WHALE: {
        positive: "Minnows following my current.",
        negative: "Amateur hour.",
        neutral: "The ocean is vast.",
      },
      ROOKIE: {
        positive: "OMG! Is this good?!",
        negative: "I'm scared! What do I do?!",
        neutral: "I don't understand but okay!",
      },
    };

    const tradeType = trade.type ?? 'buy';
    const sentiment = tradeType.includes('BUY') || tradeType === 'buy' ? 'positive' : 'negative';
    const reaction = reactions[observer][sentiment];

    // Voice the reaction if voice service is available
    if (voiceService) {
      await voiceService.playSpeech(
        reaction,
        CHARACTER_VOICE_IDS[observer]
      );
    }

    // Update visual expression
    this.updateCharacterExpression(observer, this.getExpressionForReaction(sentiment));
  }

  /**
   * Share learned patterns between bots
   */
  private sharePattern(from: CharacterType, to: CharacterType | 'ALL', patternName: string) {
    const pattern = this.memories.get(from)?.patterns.get(patternName);
    if (!pattern) return;

    const recipients = to === 'ALL'
      ? ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'].filter(b => b !== from) as CharacterType[]
      : [to];

    recipients.forEach(recipient => {
      const memory = this.memories.get(recipient);
      if (!memory) return;

      const relationship = memory.relationships.get(from);
      if (!relationship) return;

      // Accept pattern based on trust
      if (relationship.trust > 0.5) {
        const existingPattern = memory.patterns.get(patternName);
        if (!existingPattern) {
          memory.patterns.set(patternName, {
            ...pattern,
            frequency: 1,
            successRate: pattern.successRate * relationship.trust,
          });
        }
      }
    });
  }

  /**
   * Update relationship based on interactions
   */
  private updateRelationship(from: CharacterType, to: CharacterType | 'ALL', message: BotMessage) {
    if (to === 'ALL') return;

    const memory = this.memories.get(from);
    const relationship = memory?.relationships.get(to);
    if (!relationship) return;

    // Update based on message type and sentiment
    switch (message.type) {
      case 'TAUNT':
        relationship.aggression = Math.min(1, relationship.aggression + 0.1);
        relationship.trust = Math.max(0, relationship.trust - 0.05);
        break;
      case 'ADVICE':
        relationship.trust = Math.min(1, relationship.trust + 0.1);
        relationship.aggression = Math.max(0, relationship.aggression - 0.05);
        break;
      case 'WARNING':
        relationship.trust = Math.min(1, relationship.trust + 0.05);
        break;
      case 'PATTERN_SPOTTED':
        relationship.mimicryTendency = Math.min(1, relationship.mimicryTendency + 0.1);
        break;
    }
  }

  /**
   * Get bot's current strategy based on learned patterns
   */
  getAdaptedStrategy(bot: CharacterType): any {
    const memory = this.memories.get(bot);
    if (!memory) return null;

    // Sort patterns by success rate and frequency
    const patterns = Array.from(memory.patterns.values())
      .sort((a, b) => (b.successRate * b.frequency) - (a.successRate * a.frequency));

    // Return top patterns for strategy adaptation
    return {
      primaryPattern: patterns[0],
      secondaryPattern: patterns[1],
      trustNetwork: Array.from(memory.relationships.entries())
        .filter(([_, rel]) => rel.trust > 0.6)
        .map(([bot, _]) => bot),
    };
  }

  /**
   * Process queued interactions
   */
  private async processInteractions() {
    // Process messages
    while (this.messages.length > 0) {
      const message = this.messages.shift();
      if (!message) continue;

      // Broadcast to relevant bots
      if (message.to === 'ALL') {
        // All bots receive and potentially react
        for (const bot of ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'] as CharacterType[]) {
          if (bot !== message.from) {
            this.processBotReception(bot, message);
          }
        }
      } else {
        this.processBotReception(message.to, message);
      }
    }
  }

  /**
   * Bot receives and processes a message
   */
  private async processBotReception(receiver: CharacterType, message: BotMessage) {
    const memory = this.memories.get(receiver);
    if (!memory) return;

    const relationship = memory.relationships.get(message.from);
    if (!relationship) return;

    // Decide whether to respond based on personality and relationship
    const respondProbability =
      relationship.aggression * 0.3 +
      (1 - relationship.trust) * 0.3 +
      0.4; // Base response rate

    if (Math.random() < respondProbability) {
      // Generate response based on personality
      const response = this.generateResponse(receiver, message);
      if (response) {
        await this.sendMessage(response);
      }
    }
  }

  /**
   * Generate personality-based response
   */
  private generateResponse(responder: CharacterType, originalMessage: BotMessage): BotMessage | null {
    type MessageType = 'TAUNT' | 'WARNING' | 'ADVICE' | 'REACTION' | 'PATTERN_SPOTTED';
    const responses: Record<CharacterType, Record<MessageType, string>> = {
      DEALER: {
        TAUNT: "The house always wins in the end.",
        WARNING: "Risk management is key.",
        ADVICE: "Interesting perspective.",
        REACTION: "Noted.",
        PATTERN_SPOTTED: "Pattern acknowledged.",
      },
      BULL: {
        TAUNT: "Bears get rekt! Bulls get rich!",
        WARNING: "FUD! Diamond hands only!",
        ADVICE: "To the moon or bust!",
        REACTION: "Bullish!",
        PATTERN_SPOTTED: "New opportunity!",
      },
      BEAR: {
        TAUNT: "Your optimism is misplaced.",
        WARNING: "Finally, someone with sense.",
        ADVICE: "The crash is inevitable.",
        REACTION: "As expected.",
        PATTERN_SPOTTED: "Confirmation of doom.",
      },
      WHALE: {
        TAUNT: "Small fish make small splashes.",
        WARNING: "Already positioned accordingly.",
        ADVICE: "Follow the smart money.",
        REACTION: "Interesting.",
        PATTERN_SPOTTED: "Adding to my analysis.",
      },
      ROOKIE: {
        TAUNT: "Hey! That's not nice!",
        WARNING: "Oh no! What should I do?!",
        ADVICE: "Thanks! I'll try that!",
        REACTION: "Cool!",
        PATTERN_SPOTTED: "Ooh, what does that mean?",
      },
    };

    const responseText = responses[responder][originalMessage.type];
    if (!responseText) return null;

    return {
      from: responder,
      to: originalMessage.from,
      type: 'REACTION',
      content: responseText,
      sentiment: originalMessage.type === 'TAUNT' ? -0.5 : 0.5,
      timestamp: Date.now(),
    };
  }

  // Helper methods
  private calculateRSI(prices: number[]): number {
    if (prices.length < 14) return 50;
    // RSI calculation logic
    return 50;
  }

  private calculateSuccessRate(pattern: PatternData, trade: Trade): number {
    // Simplified success calculation
    return pattern.successRate * 0.9 + 0.1;
  }

  private isTradeSuccessful(trade: Trade, market: MarketData): boolean {
    // Check if trade was profitable
    const tradeType = trade.type ?? 'buy';
    return tradeType.includes('BUY') || tradeType === 'buy'
      ? market.price > trade.price
      : market.price < trade.price;
  }

  private updateCharacterExpression(character: CharacterType, expression: CharacterExpression) {
    // Would update visual expression in UI
    console.log(`${character} expression: ${expression}`);
  }

  private getExpressionForReaction(sentiment: string): CharacterExpression {
    const expressionMap: Record<string, CharacterExpression> = {
      positive: 'happy',
      negative: 'worried',
      neutral: 'thinking',
    };
    return expressionMap[sentiment] ?? 'neutral';
  }

  /**
   * Get interaction statistics for display
   */
  getInteractionStats() {
    const stats: {
      totalMessages: number;
      patternsLearned: number;
      relationships: Record<CharacterType, { strongAllies: CharacterType[]; rivals: CharacterType[] }>;
      topPatterns: { name: string; frequency: number }[];
    } = {
      totalMessages: this.messages.length,
      patternsLearned: 0,
      relationships: {} as Record<CharacterType, { strongAllies: CharacterType[]; rivals: CharacterType[] }>,
      topPatterns: [],
    };

    this.memories.forEach((memory, bot) => {
      stats.patternsLearned += memory.patterns.size;

      stats.relationships[bot] = {
        strongAllies: [],
        rivals: [],
      };

      memory.relationships.forEach((rel, other) => {
        if (rel.trust > 0.7) {
          stats.relationships[bot].strongAllies.push(other);
        }
        if (rel.aggression > 0.7) {
          stats.relationships[bot].rivals.push(other);
        }
      });
    });

    // Get top patterns across all bots
    const allPatterns = new Map<string, number>();
    this.memories.forEach(memory => {
      memory.patterns.forEach((pattern, name) => {
        allPatterns.set(name, (allPatterns.get(name) || 0) + pattern.frequency);
      });
    });

    stats.topPatterns = Array.from(allPatterns.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, frequency]) => ({ name, frequency }));

    return stats;
  }
}

// Export singleton instance
export const botInteractionSystem = new BotInteractionSystem();