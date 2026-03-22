import { logger } from '../lib/logger';
import { roomService, RoomServiceError, type RoomRecord, type RoomPlayer } from './roomService';
import { roomEvents } from '../lib/roomEvents';
import {
  knowledgeGraph,
  type PlayerProfile,
  type MatchupHistory,
  type MarketSentiment,
  type TradeObservation,
} from './knowledgeGraph';

// ---------------------------------------------------------------------------
// Bot personality definitions
// ---------------------------------------------------------------------------

type BotPersonality = 'BULL' | 'BEAR' | 'WHALE' | 'ROOKIE' | 'DEALER';

interface PersonalityConfig {
  /** Base price bias: positive = pay more, negative = pay less */
  priceBias: number;
  /** Probability of buying vs selling (0-1) */
  buyProbability: number;
  /** Maximum quantity per trade */
  maxQuantity: number;
  /** Risk tolerance 0-1 */
  riskTolerance: number;
  /** How much to adapt based on KG insights (0-1) */
  adaptability: number;
}

const PERSONALITIES: Record<BotPersonality, PersonalityConfig> = {
  BULL: {
    priceBias: 8,
    buyProbability: 0.8,
    maxQuantity: 3,
    riskTolerance: 0.8,
    adaptability: 0.5,
  },
  BEAR: {
    priceBias: -8,
    buyProbability: 0.2,
    maxQuantity: 2,
    riskTolerance: 0.3,
    adaptability: 0.6,
  },
  WHALE: {
    priceBias: 5,
    buyProbability: 0.6,
    maxQuantity: 5,
    riskTolerance: 0.9,
    adaptability: 0.3,
  },
  ROOKIE: {
    priceBias: 0,
    buyProbability: 0.5,
    maxQuantity: 2,
    riskTolerance: 0.5,
    adaptability: 0.7,
  },
  DEALER: {
    priceBias: 0,
    buyProbability: 0.5,
    maxQuantity: 2,
    riskTolerance: 0.4,
    adaptability: 0.4,
  },
};

// ---------------------------------------------------------------------------
// Graph context passed to the decision function
// ---------------------------------------------------------------------------

interface GraphContext {
  opponentProfiles: PlayerProfile[];
  matchupHistories: MatchupHistory[];
  sentiment: MarketSentiment;
}

// ---------------------------------------------------------------------------
// Trade decision output
// ---------------------------------------------------------------------------

interface BotTradeDecision {
  price: number;
  quantity: number;
  side: 'buy' | 'sell';
}

// ---------------------------------------------------------------------------
// Core decision logic
// ---------------------------------------------------------------------------

function decideTrade(
  bot: RoomPlayer,
  opponents: RoomPlayer[],
  personality: PersonalityConfig,
  graphCtx: GraphContext | null,
  cardValue?: number,
): BotTradeDecision {
  const basePrice = 100;
  let priceAdjustment = personality.priceBias;
  let buyProb = personality.buyProbability;
  let maxQty = personality.maxQuantity;

  // -- Factor in private card information if available ----------------------
  // High cards (above midpoint ~50) make buying more attractive since the
  // settlement value is likely to be higher. Low cards favor selling.
  if (cardValue && cardValue > 0) {
    const cardMidpoint = 50;
    const cardSignal = (cardValue - cardMidpoint) / cardMidpoint; // -1 to +1
    // Shift buy probability toward buying for high cards, selling for low
    buyProb = Math.max(0.05, Math.min(0.95, buyProb + cardSignal * 0.3));
    // Adjust price: willing to pay more with a strong hand
    priceAdjustment += cardSignal * 8;
  }

  // -- Apply knowledge graph insights if available -------------------------

  if (graphCtx) {
    const { opponentProfiles, matchupHistories, sentiment } = graphCtx;

    // Market sentiment adjustment: if market is bullish, nudge price up
    if (sentiment.tradeCount > 0) {
      const sentimentShift = (sentiment.buyPressure - 0.5) * 10 * personality.adaptability;
      priceAdjustment += sentimentShift;

      // High volatility -> reduce position size for low-risk bots
      if (sentiment.volatility > 10 && personality.riskTolerance < 0.5) {
        maxQty = Math.max(1, maxQty - 1);
      }
    }

    // Opponent profiling: adjust against aggressive opponents
    for (const profile of opponentProfiles) {
      if (profile.totalTrades === 0) continue;

      // If opponent is very aggressive, bear bots can exploit by selling high
      if (profile.aggressionScore > 0.7 && personality.buyProbability < 0.4) {
        priceAdjustment += 3 * personality.adaptability;
      }

      // If opponent consistently buys, raise sell prices
      if (profile.buySellRatio > 0.7) {
        priceAdjustment += 2 * personality.adaptability;
      }

      // If opponent has a low win rate, be more aggressive
      if (profile.winRate < 0.35) {
        maxQty = Math.min(maxQty + 1, 5);
      }
    }

    // Matchup history: adjust against specific opponents
    for (const matchup of matchupHistories) {
      if (matchup.totalEncounters === 0) continue;

      // Losing to this opponent? Flip strategy
      if (matchup.opponentWins > matchup.botWins && matchup.totalEncounters >= 3) {
        buyProb = 1 - buyProb; // reverse direction
        priceAdjustment *= -0.5; // reverse bias
        logger.debug(
          { botId: bot.id, matchup },
          'bot flipping strategy against dominant opponent',
        );
      }
    }
  }

  // -- Base randomness for variety -----------------------------------------

  const jitter = (Math.random() - 0.5) * 6;
  const finalPrice = Math.max(50, Math.round(basePrice + priceAdjustment + jitter));
  const side: 'buy' | 'sell' = Math.random() < buyProb ? 'buy' : 'sell';
  const quantity = Math.max(1, Math.ceil(Math.random() * maxQty));

  return { price: finalPrice, quantity, side };
}

// ---------------------------------------------------------------------------
// Bot service
// ---------------------------------------------------------------------------

/** Delay range (ms) before a bot submits a trade after round starts */
const BOT_MIN_DELAY = 2_000;
const BOT_MAX_DELAY = 8_000;

const BOT_NAMES: Record<BotPersonality, string> = {
  BULL: 'Bull Runner',
  BEAR: 'Bear Necessities',
  WHALE: 'The Whale',
  ROOKIE: 'Fresh Trader',
  DEALER: 'Dealer Bot',
};

const BOT_CHARACTERS: BotPersonality[] = ['BULL', 'BEAR', 'WHALE', 'ROOKIE'];
let botCounter = 0;

class BotService {
  private activeTimers = new Map<string, NodeJS.Timeout[]>();

  /**
   * Add a bot player to a room. Only the host may do this.
   * Delegates to roomService.addBot() which creates the player with isBot: true
   * from the start, then seeds the knowledge graph entity.
   */
  async addBot(
    roomId: string,
    requesterId: string,
    character?: BotPersonality,
  ): Promise<RoomRecord> {
    // roomService.addBot() handles all validation (host check, room full,
    // status check) and creates the bot player with isBot: true atomically.
    const updated = await roomService.addBot(roomId, requesterId, character);

    // Find the newly added bot to seed its KG entity
    const addedBot = updated.players.find(
      (p) => p.isBot && p.character === (character ?? p.character),
    );
    if (addedBot) {
      knowledgeGraph.ensurePlayerEntity(
        addedBot.id,
        addedBot.name,
        true,
        addedBot.character,
      );
      logger.info(
        { roomId, botId: addedBot.id, character: addedBot.character },
        'bot added to room',
      );
    }

    return updated;
  }

  /**
   * Call this when a room transitions to 'playing'. Schedules trades for
   * every bot in the room with a random delay within the trading window.
   */
  scheduleBotsForRound(room: RoomRecord): void {
    const bots = room.players.filter((p) => p.isBot);
    if (bots.length === 0) return;

    const timers: NodeJS.Timeout[] = [];
    const timerKey = `${room.id}:${room.roundNumber}`;

    for (const bot of bots) {
      const delay = BOT_MIN_DELAY + Math.random() * (BOT_MAX_DELAY - BOT_MIN_DELAY);
      const timer = setTimeout(() => {
        this.executeBotTrade(room.id, bot, room).catch((err) => {
          logger.error({ err, botId: bot.id, roomId: room.id }, 'bot trade execution failed');
        });
      }, delay);
      timers.push(timer);
    }

    // Clear any previous timers for this room+round
    this.clearTimers(timerKey);
    this.activeTimers.set(timerKey, timers);
  }

  /**
   * Executes a single bot trade with knowledge graph context.
   */
  private async executeBotTrade(
    roomId: string,
    bot: RoomPlayer,
    roomSnapshot: RoomRecord,
  ): Promise<void> {
    const personality = PERSONALITIES[(bot.character as BotPersonality)] ?? PERSONALITIES.ROOKIE;
    const opponents = roomSnapshot.players.filter((p) => p.id !== bot.id);

    // -- Query the knowledge graph for context (graceful degradation) ------

    let graphCtx: GraphContext | null = null;

    try {
      const opponentProfiles = opponents.map((opp) =>
        knowledgeGraph.getPlayerProfile(opp.id),
      );
      const matchupHistories = opponents.map((opp) =>
        knowledgeGraph.getMatchupHistory(bot.id, opp.id),
      );
      const sentiment = knowledgeGraph.getMarketSentiment(roomId);

      graphCtx = { opponentProfiles, matchupHistories, sentiment };
    } catch (err) {
      // Graph queries failed — proceed with default personality behavior
      logger.warn({ err, botId: bot.id }, 'kg queries failed, using default personality');
    }

    // -- Look up the bot's dealt card for informed trading -------------------

    const botCard = roomSnapshot.gameState?.playerCards?.find((pc) => pc.id === bot.id);
    const cardValue = botCard?.value ?? 0;

    // -- Make the decision -------------------------------------------------

    const decision = decideTrade(bot, opponents, personality, graphCtx, cardValue || undefined);

    // -- Submit the trade via roomService ----------------------------------

    try {
      await roomService.submitTrade(roomId, bot.id, decision);

      logger.info(
        {
          botId: bot.id,
          character: bot.character,
          roomId,
          round: roomSnapshot.roundNumber,
          ...decision,
          hadGraphCtx: graphCtx !== null,
        },
        'bot submitted trade',
      );

      // -- Record the observation in the knowledge graph --------------------

      const counterparty = opponents[Math.floor(Math.random() * opponents.length)];
      if (counterparty) {
        const observation: TradeObservation = {
          playerId: bot.id,
          counterpartyId: counterparty.id,
          side: decision.side,
          price: decision.price,
          quantity: decision.quantity,
          value: decision.price * decision.quantity,
        };

        knowledgeGraph.recordTradeObservation(bot.id, observation, {
          roomId,
          roundNumber: roomSnapshot.roundNumber,
        });
      }
    } catch (err) {
      logger.error({ err, botId: bot.id, roomId, decision }, 'bot trade submission failed');
    }
  }

  /**
   * Process a room update event to record round outcomes and trigger bot
   * trades when a new round starts.
   */
  handleRoomUpdate(room: RoomRecord): void {
    // Seed entities for any new players/bots on every update
    this.seedBotEntities(room);

    // New round started — schedule bot trades
    if (room.status === 'playing') {
      this.scheduleBotsForRound(room);
    }

    // Round finished — record outcomes in the knowledge graph
    if (room.status === 'finished' && room.gameState) {
      this.recordRoundResults(room);
    }
  }

  /**
   * Record round results into the knowledge graph.
   */
  private recordRoundResults(room: RoomRecord): void {
    try {
      if (!room.gameState || !room.players.length) return;

      const avgBalance =
        room.players.reduce((sum, p) => sum + p.balance, 0) / room.players.length;

      const results = room.players.map((p) => ({
        playerId: p.id,
        balanceDelta: p.balance - avgBalance,
        isWinner: p.isWinner ?? false,
      }));

      knowledgeGraph.recordRoundOutcome(room.id, room.roundNumber, results);

      logger.debug(
        { roomId: room.id, round: room.roundNumber, playerCount: results.length },
        'recorded round outcomes in knowledge graph',
      );
    } catch (err) {
      logger.error({ err, roomId: room.id }, 'failed to record round results');
    }
  }

  /**
   * Ensure all bots in a room have entity nodes in the knowledge graph.
   * Call this when bots join a room.
   */
  seedBotEntities(room: RoomRecord): void {
    for (const player of room.players) {
      knowledgeGraph.ensurePlayerEntity(
        player.id,
        player.name,
        player.isBot ?? false,
        player.character,
      );
    }
  }

  private clearTimers(key: string): void {
    const existing = this.activeTimers.get(key);
    if (existing) {
      existing.forEach(clearTimeout);
      this.activeTimers.delete(key);
    }
  }

  /**
   * Cancel all pending bot timers. Use on shutdown.
   */
  shutdown(): void {
    for (const [key, timers] of this.activeTimers) {
      timers.forEach(clearTimeout);
    }
    this.activeTimers.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton + event wiring
// ---------------------------------------------------------------------------

export const botService = new BotService();

// Listen for room updates to trigger bot behavior and record outcomes
roomEvents.on('room:updated', (room: unknown) => {
  try {
    const r = room as RoomRecord;
    botService.handleRoomUpdate(r);
  } catch (err) {
    logger.error({ err }, 'botService room:updated handler error');
  }
});
