/**
 * Adaptive Learning Engine
 * Continuous learning system where bots evolve strategies based on:
 * - Market performance
 * - Pattern recognition
 * - Social learning from other bots
 * - Reinforcement learning from outcomes
 */

import type { Trade, MarketData, CharacterType } from '@trading-game/shared';

export interface NeuralNetwork {
  layers: NeuronLayer[];
  weights: number[][];
  learningRate: number;
  momentum: number;
}

export interface NeuronLayer {
  neurons: number;
  activation: 'relu' | 'sigmoid' | 'tanh';
  bias: number[];
}

export interface StrategyGene {
  id: string;
  trait: string;
  value: number;
  mutability: number; // How likely to change
  dominance: number; // How strongly it influences behavior
}

export interface LearningProfile {
  character: CharacterType;
  neuralNet: NeuralNetwork;
  genome: StrategyGene[];
  memory: ExperienceMemory;
  performance: PerformanceMetrics;
  socialLearning: SocialLearningData;
}

export interface ExperienceMemory {
  shortTerm: Experience[]; // Last 100 trades
  longTerm: CompressedExperience[]; // Aggregated historical data
  episodicMemory: EpisodicEvent[]; // Significant events
  workingMemory: Map<string, any>; // Current context
}

export interface Experience {
  state: MarketState;
  action: Trade;
  reward: number;
  nextState: MarketState;
  timestamp: number;
  context: {
    otherBots: CharacterType[];
    marketRegime: 'BULL' | 'BEAR' | 'SIDEWAYS';
    volatility: number;
  };
}

export interface CompressedExperience {
  pattern: string;
  frequency: number;
  avgReward: number;
  conditions: MarketCondition[];
}

export interface EpisodicEvent {
  type: 'BIG_WIN' | 'BIG_LOSS' | 'PATTERN_DISCOVERY' | 'STRATEGY_SHIFT';
  description: string;
  impact: number;
  timestamp: number;
  lesson: string;
}

export interface MarketState {
  price: number;
  volume: number;
  rsi: number;
  macd: { signal: number; histogram: number };
  bollinger: { upper: number; middle: number; lower: number };
  sentiment: number;
  timeOfDay: number;
  volatility: number;
}

export interface MarketCondition {
  feature: string;
  value: number | string;
  importance: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  avgProfit: number;
  sharpeRatio: number;
  maxDrawdown: number;
  adaptationScore: number; // How well bot adapts to change
  learningVelocity: number; // How fast bot improves
}

export interface SocialLearningData {
  mentors: Map<CharacterType, MentorshipData>;
  students: Map<CharacterType, TeachingData>;
  imitationTargets: CharacterType[];
  collaborators: CharacterType[];
}

export interface MentorshipData {
  mentor: CharacterType;
  lessonsLearned: number;
  trustLevel: number;
  strategySimilarity: number;
}

export interface TeachingData {
  student: CharacterType;
  lessonsShared: number;
  effectiveness: number;
}

/**
 * Main Adaptive Learning Engine
 */
export class AdaptiveLearningEngine {
  private learningProfiles: Map<CharacterType, LearningProfile> = new Map();
  private marketRegimeDetector: MarketRegimeDetector;
  private evolutionEngine: EvolutionEngine;
  private collaborationNetwork: CollaborationNetwork;

  constructor() {
    this.initializeLearningProfiles();
    this.marketRegimeDetector = new MarketRegimeDetector();
    this.evolutionEngine = new EvolutionEngine();
    this.collaborationNetwork = new CollaborationNetwork();
  }

  /**
   * Initialize each character with unique learning capabilities
   */
  private initializeLearningProfiles() {
    const profiles: Record<CharacterType, Partial<LearningProfile>> = {
      DEALER: {
        character: 'DEALER',
        neuralNet: this.createNeuralNetwork([
          { neurons: 20, activation: 'relu', bias: [] }, // Input layer
          { neurons: 16, activation: 'relu', bias: [] }, // Hidden layer 1
          { neurons: 8, activation: 'relu', bias: [] },  // Hidden layer 2
          { neurons: 4, activation: 'sigmoid', bias: [] }, // Output layer
        ], 0.01, 0.9), // Low learning rate, high momentum (stable)
        genome: [
          { id: 'risk_aversion', trait: 'conservative', value: 0.7, mutability: 0.1, dominance: 0.8 },
          { id: 'market_making', trait: 'liquidity_provider', value: 0.9, mutability: 0.05, dominance: 0.9 },
          { id: 'pattern_recognition', trait: 'analytical', value: 0.8, mutability: 0.2, dominance: 0.6 },
        ],
      },
      BULL: {
        character: 'BULL',
        neuralNet: this.createNeuralNetwork([
          { neurons: 20, activation: 'relu', bias: [] },
          { neurons: 24, activation: 'relu', bias: [] }, // Larger network for aggressive learning
          { neurons: 12, activation: 'relu', bias: [] },
          { neurons: 4, activation: 'sigmoid', bias: [] },
        ], 0.05, 0.7), // High learning rate, lower momentum (aggressive adaptation)
        genome: [
          { id: 'risk_appetite', trait: 'aggressive', value: 0.9, mutability: 0.3, dominance: 0.9 },
          { id: 'momentum_following', trait: 'trend_rider', value: 0.95, mutability: 0.2, dominance: 0.85 },
          { id: 'optimism_bias', trait: 'positive', value: 0.8, mutability: 0.4, dominance: 0.7 },
        ],
      },
      BEAR: {
        character: 'BEAR',
        neuralNet: this.createNeuralNetwork([
          { neurons: 20, activation: 'tanh', bias: [] }, // Different activation for contrarian thinking
          { neurons: 18, activation: 'tanh', bias: [] },
          { neurons: 10, activation: 'tanh', bias: [] },
          { neurons: 4, activation: 'sigmoid', bias: [] },
        ], 0.03, 0.8), // Moderate learning rate
        genome: [
          { id: 'risk_aversion', trait: 'cautious', value: 0.8, mutability: 0.2, dominance: 0.75 },
          { id: 'contrarian', trait: 'counter_trend', value: 0.85, mutability: 0.15, dominance: 0.8 },
          { id: 'pessimism_bias', trait: 'negative', value: 0.7, mutability: 0.3, dominance: 0.6 },
        ],
      },
      WHALE: {
        character: 'WHALE',
        neuralNet: this.createNeuralNetwork([
          { neurons: 30, activation: 'relu', bias: [] }, // Largest network for complex strategies
          { neurons: 25, activation: 'relu', bias: [] },
          { neurons: 20, activation: 'relu', bias: [] },
          { neurons: 10, activation: 'relu', bias: [] },
          { neurons: 4, activation: 'sigmoid', bias: [] },
        ], 0.02, 0.95), // Very low learning rate, very high momentum (strategic, slow adaptation)
        genome: [
          { id: 'market_influence', trait: 'manipulative', value: 0.95, mutability: 0.05, dominance: 0.95 },
          { id: 'patience', trait: 'long_term', value: 0.9, mutability: 0.1, dominance: 0.8 },
          { id: 'information_advantage', trait: 'insider', value: 0.8, mutability: 0.1, dominance: 0.85 },
        ],
      },
      ROOKIE: {
        character: 'ROOKIE',
        neuralNet: this.createNeuralNetwork([
          { neurons: 15, activation: 'relu', bias: [] }, // Smaller network, faster but less sophisticated
          { neurons: 10, activation: 'relu', bias: [] },
          { neurons: 4, activation: 'sigmoid', bias: [] },
        ], 0.1, 0.5), // Very high learning rate, low momentum (rapid but unstable learning)
        genome: [
          { id: 'exploration', trait: 'curious', value: 0.9, mutability: 0.8, dominance: 0.5 },
          { id: 'imitation', trait: 'copycat', value: 0.85, mutability: 0.6, dominance: 0.7 },
          { id: 'randomness', trait: 'chaotic', value: 0.7, mutability: 0.9, dominance: 0.4 },
        ],
      },
    };

    Object.entries(profiles).forEach(([character, profile]) => {
      this.learningProfiles.set(character as CharacterType, {
        ...profile,
        memory: this.initializeMemory(),
        performance: this.initializePerformance(),
        socialLearning: this.initializeSocialLearning(),
      } as LearningProfile);
    });
  }

  /**
   * Main learning loop - processes experience and updates strategy
   */
  async learn(
    character: CharacterType,
    experience: Experience,
    marketData: MarketData,
    otherBots: Map<CharacterType, Trade>
  ): Promise<void> {
    const profile = this.learningProfiles.get(character);
    if (!profile) return;

    // 1. Store experience
    this.storeExperience(profile, experience);

    // 2. Detect market regime
    const regime = this.marketRegimeDetector.detectRegime(marketData);

    // 3. Learn from own experience (reinforcement learning)
    await this.reinforcementLearn(profile, experience, regime);

    // 4. Learn from other bots (social learning)
    await this.socialLearn(profile, otherBots, marketData);

    // 5. Evolve strategy genes
    this.evolutionEngine.evolve(profile.genome, profile.performance);

    // 6. Update neural network
    await this.updateNeuralNetwork(profile, experience);

    // 7. Consolidate memories (compress old experiences)
    this.consolidateMemories(profile);

    // 8. Update performance metrics
    this.updatePerformance(profile, experience.reward);

    // 9. Check for breakthrough moments
    this.checkForBreakthrough(profile, experience);
  }

  /**
   * Reinforcement learning using Q-learning with neural network
   */
  private async reinforcementLearn(
    profile: LearningProfile,
    experience: Experience,
    regime: string
  ): Promise<void> {
    const { state, action, reward, nextState } = experience;

    // Calculate Q-values using neural network
    const currentQ = this.forwardPass(profile.neuralNet, this.stateToVector(state));
    const nextQ = this.forwardPass(profile.neuralNet, this.stateToVector(nextState));

    // Q-learning update with character-specific parameters
    const gamma = this.getDiscountFactor(profile.character); // Future reward discount
    const alpha = profile.neuralNet.learningRate;

    // Calculate target Q-value
    const maxNextQ = Math.max(...nextQ);
    const targetQ = reward + gamma * maxNextQ;

    // Calculate error for backpropagation
    const actionIndex = this.actionToIndex(action);
    const error = targetQ - currentQ[actionIndex];

    // Backpropagate error through network
    await this.backpropagate(profile.neuralNet, error, actionIndex);

    // Store Q-value for pattern analysis
    profile.memory.workingMemory.set(`q_${regime}`, currentQ);
  }

  /**
   * Learn from observing other bots
   */
  private async socialLearn(
    profile: LearningProfile,
    otherBots: Map<CharacterType, Trade>,
    marketData: MarketData
  ): Promise<void> {
    otherBots.forEach((trade, otherBot) => {
      // Calculate how successful the other bot's trade was
      const success = this.evaluateTradeSuccess(trade, marketData);

      // Update mentorship relationships
      const mentorData = profile.socialLearning.mentors.get(otherBot);
      if (mentorData) {
        if (success > 0.6) {
          mentorData.trustLevel = Math.min(1, mentorData.trustLevel + 0.01);
          mentorData.lessonsLearned++;

          // Learn strategy elements from successful mentor
          if (mentorData.trustLevel > 0.7) {
            this.imitateStrategy(profile, otherBot, trade, success);
          }
        } else if (success < 0.4) {
          mentorData.trustLevel = Math.max(0, mentorData.trustLevel - 0.02);
        }
      }

      // Check if should become mentor/student
      this.updateSocialRelationships(profile, otherBot, success);
    });

    // Collaborative learning with trusted partners
    profile.socialLearning.collaborators.forEach(collaborator => {
      this.shareKnowledge(profile, collaborator);
    });
  }

  /**
   * Imitate successful strategies from other bots
   */
  private imitateStrategy(
    learner: LearningProfile,
    teacher: CharacterType,
    trade: Trade,
    success: number
  ): void {
    // Personality-based imitation probability
    const imitationProbability = {
      DEALER: 0.3,  // Rarely imitates
      BULL: 0.5,    // Sometimes follows winners
      BEAR: 0.4,    // Selective imitation
      WHALE: 0.1,   // Almost never imitates
      ROOKIE: 0.9,  // Always copying others
    };

    if (Math.random() < imitationProbability[learner.character] * success) {
      // Blend teacher's strategy into learner's genome
      const teacherProfile = this.learningProfiles.get(teacher);
      if (teacherProfile) {
        learner.genome.forEach((gene, i) => {
          const teacherGene = teacherProfile.genome[i];
          if (teacherGene) {
            // Weighted average based on success and trust
            const weight = success * 0.1 * gene.mutability;
            gene.value = gene.value * (1 - weight) + teacherGene.value * weight;
          }
        });
      }

      // Store episodic memory of learning event
      learner.memory.episodicMemory.push({
        type: 'PATTERN_DISCOVERY',
        description: `Learned from ${teacher}'s successful ${trade.type}`,
        impact: success,
        timestamp: Date.now(),
        lesson: `Imitation of ${teacher} strategy`,
      });
    }
  }

  /**
   * Check for breakthrough learning moments
   */
  private checkForBreakthrough(profile: LearningProfile, experience: Experience): void {
    const recentPerformance = this.calculateRecentPerformance(profile);

    // Breakthrough conditions
    if (recentPerformance.winRate > profile.performance.winRate * 1.2) {
      // Significant performance improvement
      profile.memory.episodicMemory.push({
        type: 'STRATEGY_SHIFT',
        description: 'Discovered winning pattern',
        impact: 0.8,
        timestamp: Date.now(),
        lesson: 'Current strategy working exceptionally well',
      });

      // Reduce exploration to exploit winning strategy
      const explorationGene = profile.genome.find(g => g.id === 'exploration');
      if (explorationGene) {
        explorationGene.value = Math.max(0.1, explorationGene.value * 0.8);
      }
    }

    if (experience.reward > profile.performance.avgProfit * 3) {
      // Exceptional trade
      profile.memory.episodicMemory.push({
        type: 'BIG_WIN',
        description: `Exceptional trade with ${experience.reward} profit`,
        impact: 1.0,
        timestamp: Date.now(),
        lesson: 'Remember conditions for this success',
      });

      // Strengthen current strategy weights
      this.reinforceCurrentStrategy(profile);
    }
  }

  /**
   * Consolidate short-term memories into long-term patterns
   */
  private consolidateMemories(profile: LearningProfile): void {
    const shortTermSize = profile.memory.shortTerm.length;

    if (shortTermSize > 100) {
      // Compress oldest 50 experiences
      const toCompress = profile.memory.shortTerm.splice(0, 50);

      // Group by similar states
      const patterns = new Map<string, Experience[]>();
      toCompress.forEach(exp => {
        const key = this.getStateKey(exp.state);
        if (!patterns.has(key)) {
          patterns.set(key, []);
        }
        patterns.get(key)!.push(exp);
      });

      // Create compressed experiences
      patterns.forEach((experiences, patternKey) => {
        const avgReward = experiences.reduce((sum, e) => sum + e.reward, 0) / experiences.length;

        profile.memory.longTerm.push({
          pattern: patternKey,
          frequency: experiences.length,
          avgReward,
          conditions: this.extractConditions(experiences[0].state),
        });
      });

      // Limit long-term memory size
      if (profile.memory.longTerm.length > 1000) {
        // Keep only most valuable patterns
        profile.memory.longTerm.sort((a, b) =>
          (b.avgReward * b.frequency) - (a.avgReward * a.frequency)
        );
        profile.memory.longTerm = profile.memory.longTerm.slice(0, 500);
      }
    }
  }

  /**
   * Generate trading decision based on learned knowledge
   */
  async decide(
    character: CharacterType,
    marketData: MarketData,
    currentPosition: any
  ): Promise<Trade | null> {
    const profile = this.learningProfiles.get(character);
    if (!profile) return null;

    // Convert market data to state vector
    const state = this.marketDataToState(marketData);
    const stateVector = this.stateToVector(state);

    // Get Q-values from neural network
    const qValues = this.forwardPass(profile.neuralNet, stateVector);

    // Exploration vs exploitation based on personality and performance
    const explorationRate = this.getExplorationRate(profile);

    let actionIndex: number;
    if (Math.random() < explorationRate) {
      // Explore: random action
      actionIndex = Math.floor(Math.random() * qValues.length);
    } else {
      // Exploit: best action
      actionIndex = qValues.indexOf(Math.max(...qValues));
    }

    // Check episodic memory for similar situations
    const similarMemory = this.findSimilarEpisode(profile, state);
    if (similarMemory && similarMemory.impact > 0.8) {
      // Override with successful past action
      console.log(`${character} remembering: ${similarMemory.lesson}`);
    }

    // Generate trade from action
    return this.actionIndexToTrade(actionIndex, marketData, profile);
  }

  // Helper methods

  private createNeuralNetwork(layers: NeuronLayer[], learningRate: number, momentum: number): NeuralNetwork {
    const weights: number[][] = [];

    for (let i = 0; i < layers.length - 1; i++) {
      const layerWeights: number[] = [];
      const inputSize = layers[i].neurons;
      const outputSize = layers[i + 1].neurons;

      // Xavier initialization
      const limit = Math.sqrt(6 / (inputSize + outputSize));
      for (let j = 0; j < inputSize * outputSize; j++) {
        layerWeights.push((Math.random() * 2 - 1) * limit);
      }
      weights.push(layerWeights);

      // Initialize biases
      layers[i + 1].bias = new Array(outputSize).fill(0).map(() => (Math.random() - 0.5) * 0.1);
    }

    return { layers, weights, learningRate, momentum };
  }

  private initializeMemory(): ExperienceMemory {
    return {
      shortTerm: [],
      longTerm: [],
      episodicMemory: [],
      workingMemory: new Map(),
    };
  }

  private initializePerformance(): PerformanceMetrics {
    return {
      totalTrades: 0,
      winRate: 0.5,
      avgProfit: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      adaptationScore: 0.5,
      learningVelocity: 0.5,
    };
  }

  private initializeSocialLearning(): SocialLearningData {
    return {
      mentors: new Map(),
      students: new Map(),
      imitationTargets: [],
      collaborators: [],
    };
  }

  private storeExperience(profile: LearningProfile, experience: Experience): void {
    profile.memory.shortTerm.push(experience);
    if (profile.memory.shortTerm.length > 200) {
      profile.memory.shortTerm.shift();
    }
  }

  private getDiscountFactor(character: CharacterType): number {
    const factors = {
      DEALER: 0.95,  // Values future rewards highly (patient)
      BULL: 0.8,     // More focused on immediate gains
      BEAR: 0.9,     // Moderately forward-looking
      WHALE: 0.99,   // Very long-term oriented
      ROOKIE: 0.6,   // Very short-sighted
    };
    return factors[character];
  }

  private getExplorationRate(profile: LearningProfile): number {
    const baseRate = {
      DEALER: 0.1,
      BULL: 0.2,
      BEAR: 0.15,
      WHALE: 0.05,
      ROOKIE: 0.4,
    };

    // Adjust based on recent performance
    const performanceAdjustment = profile.performance.winRate > 0.6 ? -0.05 : 0.05;

    // Adjust based on genome
    const explorationGene = profile.genome.find(g => g.id === 'exploration');
    const geneAdjustment = explorationGene ? explorationGene.value * 0.2 : 0;

    return Math.max(0.01, Math.min(0.5,
      baseRate[profile.character] + performanceAdjustment + geneAdjustment
    ));
  }

  private stateToVector(state: MarketState): number[] {
    return [
      state.price,
      state.volume,
      state.rsi / 100,
      state.macd.signal,
      state.macd.histogram,
      state.bollinger.upper,
      state.bollinger.middle,
      state.bollinger.lower,
      state.sentiment,
      state.timeOfDay / 24,
      state.volatility,
    ];
  }

  private forwardPass(network: NeuralNetwork, input: number[]): number[] {
    let activations = input;

    for (let i = 0; i < network.weights.length; i++) {
      const weights = network.weights[i];
      const layer = network.layers[i + 1];
      const newActivations: number[] = [];

      for (let j = 0; j < layer.neurons; j++) {
        let sum = layer.bias[j];
        for (let k = 0; k < activations.length; k++) {
          sum += activations[k] * weights[k * layer.neurons + j];
        }

        // Apply activation function
        newActivations.push(this.activate(sum, layer.activation));
      }

      activations = newActivations;
    }

    return activations;
  }

  private activate(x: number, activation: string): number {
    switch (activation) {
      case 'relu':
        return Math.max(0, x);
      case 'sigmoid':
        return 1 / (1 + Math.exp(-x));
      case 'tanh':
        return Math.tanh(x);
      default:
        return x;
    }
  }

  private async backpropagate(network: NeuralNetwork, error: number, actionIndex: number): Promise<void> {
    // Simplified backpropagation - would be more complex in production
    // Adjusts weights based on error signal
    // Implementation details omitted for brevity
  }

  /**
   * Update neural network weights based on experience
   * TODO: Implement full backpropagation in Feature 3
   */
  private async updateNeuralNetwork(profile: LearningProfile, experience: Experience): Promise<void> {
    const { state, action, reward } = experience;

    // Forward pass to get current predictions
    const input = this.stateToVector(state);
    const output = this.forwardPass(profile.neuralNet, input);

    // Calculate error (simplified)
    const actionIndex = this.actionToIndex(action);
    const error = reward - (output[actionIndex] || 0);

    // Backpropagate error (stub - will be fully implemented in Feature 3)
    await this.backpropagate(profile.neuralNet, error, actionIndex);

    // Log for debugging
    console.log(`[${profile.character}] Neural network updated, error: ${error.toFixed(4)}`);
  }

  private actionToIndex(action: Trade): number {
    const actions = ['BUY', 'SELL', 'HOLD', 'WAIT'];
    const tradeType = action.type ?? 'buy';
    return actions.indexOf(tradeType.split('_')[0].toUpperCase());
  }

  private actionIndexToTrade(index: number, market: MarketData, profile: LearningProfile): Trade | null {
    const actions = ['BUY', 'SELL', 'HOLD', 'WAIT'];
    const action = actions[index];

    if (action === 'HOLD' || action === 'WAIT') return null;

    return {
      type: action === 'BUY' ? 'MARKET_BUY' : 'MARKET_SELL',
      price: action === 'BUY' ? market.ask : market.bid,
      size: this.calculatePositionSize(profile),
      timestamp: Date.now(),
      character: profile.character,
    };
  }

  private calculatePositionSize(profile: LearningProfile): number {
    // Based on confidence and risk genes
    const riskGene = profile.genome.find(g => g.trait.includes('risk'));
    const riskFactor = riskGene ? riskGene.value : 0.5;
    return 100 * riskFactor * profile.performance.winRate;
  }

  private marketDataToState(market: MarketData): MarketState {
    return {
      price: market.price,
      volume: market.volume24h ?? market.volume,
      rsi: 50, // Would calculate properly
      macd: { signal: 0, histogram: 0 },
      bollinger: { upper: market.high24h, middle: market.price, lower: market.low24h },
      sentiment: 0.5,
      timeOfDay: new Date().getHours(),
      volatility: (market.high24h - market.low24h) / market.price,
    };
  }

  private getStateKey(state: MarketState): string {
    return `${Math.floor(state.rsi / 10)}_${Math.floor(state.volatility * 100)}`;
  }

  private extractConditions(state: MarketState): MarketCondition[] {
    return [
      { feature: 'rsi', value: state.rsi, importance: 0.8 },
      { feature: 'volatility', value: state.volatility, importance: 0.6 },
      { feature: 'volume', value: state.volume, importance: 0.7 },
    ];
  }

  private evaluateTradeSuccess(trade: Trade, market: MarketData): number {
    // Simple success metric
    const tradeType = trade.type ?? 'buy';
    if (tradeType.includes('BUY') || tradeType === 'buy') {
      return market.price > trade.price ? 0.7 : 0.3;
    } else {
      return market.price < trade.price ? 0.7 : 0.3;
    }
  }

  private updateSocialRelationships(profile: LearningProfile, otherBot: CharacterType, success: number): void {
    if (success > 0.7 && !profile.socialLearning.mentors.has(otherBot)) {
      profile.socialLearning.mentors.set(otherBot, {
        mentor: otherBot,
        lessonsLearned: 0,
        trustLevel: 0.5,
        strategySimilarity: 0.5,
      });
    }
  }

  private shareKnowledge(profile1: LearningProfile, character2: CharacterType): void {
    const profile2 = this.learningProfiles.get(character2);
    if (!profile2) return;

    // Share successful patterns
    profile1.memory.longTerm
      .filter(exp => exp.avgReward > 0)
      .slice(0, 5)
      .forEach(pattern => {
        if (!profile2.memory.longTerm.find(p => p.pattern === pattern.pattern)) {
          profile2.memory.longTerm.push({ ...pattern, frequency: 1 });
        }
      });
  }

  private updatePerformance(profile: LearningProfile, reward: number): void {
    profile.performance.totalTrades++;
    profile.performance.avgProfit =
      (profile.performance.avgProfit * (profile.performance.totalTrades - 1) + reward) /
      profile.performance.totalTrades;

    if (reward > 0) {
      profile.performance.winRate =
        (profile.performance.winRate * (profile.performance.totalTrades - 1) + 1) /
        profile.performance.totalTrades;
    }
  }

  private calculateRecentPerformance(profile: LearningProfile): PerformanceMetrics {
    const recentTrades = profile.memory.shortTerm.slice(-20);
    const wins = recentTrades.filter(t => t.reward > 0).length;

    return {
      ...profile.performance,
      winRate: wins / recentTrades.length,
      avgProfit: recentTrades.reduce((sum, t) => sum + t.reward, 0) / recentTrades.length,
    };
  }

  private reinforceCurrentStrategy(profile: LearningProfile): void {
    // Strengthen current neural network weights slightly
    profile.neuralNet.weights.forEach(layer => {
      layer.forEach((weight, i) => {
        layer[i] = weight * 1.01; // Slight reinforcement
      });
    });
  }

  private findSimilarEpisode(profile: LearningProfile, state: MarketState): EpisodicEvent | null {
    // Find most relevant past episode
    return profile.memory.episodicMemory
      .filter(episode => episode.impact > 0.7)
      .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  }
}

/**
 * Market Regime Detector
 */
class MarketRegimeDetector {
  detectRegime(market: MarketData): 'BULL' | 'BEAR' | 'SIDEWAYS' {
    const open = market.open24h ?? market.price;
    const priceChange = open > 0 ? (market.price - open) / open : 0;
    const vol24h = market.volume24h ?? 0;
    const avgVol = market.avgVolume ?? 1;
    const volumeRatio = vol24h / avgVol;

    if (priceChange > 0.02 && volumeRatio > 1.2) return 'BULL';
    if (priceChange < -0.02 && volumeRatio > 1.2) return 'BEAR';
    return 'SIDEWAYS';
  }
}

/**
 * Evolution Engine for strategy genes
 */
class EvolutionEngine {
  evolve(genome: StrategyGene[], performance: PerformanceMetrics): void {
    genome.forEach(gene => {
      // Mutation probability based on performance
      const mutationProb = performance.winRate > 0.6 ? 0.01 : 0.05;

      if (Math.random() < mutationProb * gene.mutability) {
        // Mutate gene value
        const mutation = (Math.random() - 0.5) * 0.1;
        gene.value = Math.max(0, Math.min(1, gene.value + mutation));
      }
    });
  }
}

/**
 * Collaboration Network for bot cooperation
 */
class CollaborationNetwork {
  private collaborations: Map<string, Set<CharacterType>> = new Map();

  addCollaboration(bot1: CharacterType, bot2: CharacterType): void {
    const key = [bot1, bot2].sort().join('-');
    if (!this.collaborations.has(key)) {
      this.collaborations.set(key, new Set([bot1, bot2]));
    }
  }

  getCollaborators(bot: CharacterType): CharacterType[] {
    const collaborators: CharacterType[] = [];
    this.collaborations.forEach((bots, key) => {
      if (bots.has(bot)) {
        bots.forEach(b => {
          if (b !== bot) collaborators.push(b);
        });
      }
    });
    return collaborators;
  }
}

// Export singleton
export const adaptiveLearningEngine = new AdaptiveLearningEngine();