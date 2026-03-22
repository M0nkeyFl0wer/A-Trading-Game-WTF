import { logger } from '../lib/logger';
import { roomService, RoomServiceError, type RoomRecord, type RoomPlayer } from './roomService';
import { roomEvents } from '../lib/roomEvents';
import { knowledgeGraph } from './knowledgeGraph';
import type { TradingPhase } from '@trading-game/shared';

// ---------------------------------------------------------------------------
// Bot personality definitions
// ---------------------------------------------------------------------------

type BotPersonality = 'BULL' | 'BEAR' | 'WHALE' | 'ROOKIE' | 'DEALER';

const TRADING_PHASES: ReadonlySet<string> = new Set(['blind', 'flop', 'turn']);

// Delay range (ms) before a bot submits orders after a phase starts
const BOT_MIN_DELAY = 2_000;
const BOT_MAX_DELAY = 5_000;

// If an existing order deviates from the new fair value by more than this, cancel it
const MISPRICE_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Fair value estimation
// ---------------------------------------------------------------------------

/**
 * Estimate the settlement total (sum of all player cards + 3 community cards).
 *
 * Known info: the bot's own card + any revealed community cards.
 * Unknown: other players' cards + unrevealed community cards.
 * Each unknown card has EV = deckMean ≈ 130/17 ≈ 7.65.
 */
function estimateFairValue(
  myCardValue: number,
  revealedCommunityCards: number[],
  playerCount: number,
): number {
  const knownTotal = myCardValue + revealedCommunityCards.reduce((s, c) => s + c, 0);
  const unknownCount =
    (playerCount - 1) + // other players' cards
    (3 - revealedCommunityCards.length); // unrevealed community cards
  const deckMean = 130 / 17;
  return knownTotal + unknownCount * deckMean;
}

// ---------------------------------------------------------------------------
// Order generation per personality
// ---------------------------------------------------------------------------

interface OrderDecision {
  price: number;
  quantity: number;
  side: 'bid' | 'ask';
}

/**
 * Generate a set of orders for a bot based on its personality and fair value.
 * Returns 1-2 orders (typically a bid and/or an ask).
 */
function generateOrders(
  personality: BotPersonality,
  fairValue: number,
): OrderDecision[] {
  const orders: OrderDecision[] = [];

  // Math.random() is intentional here — bot jitter is not security-sensitive
  const jitter = () => (Math.random() - 0.5) * 4; // +/- 2 noise
  const randInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;

  switch (personality) {
    case 'BULL': {
      // Aggressive bids above fair value, asks wide above
      orders.push({
        side: 'bid',
        price: Math.round(fairValue + randInt(1, 5) + jitter()),
        quantity: randInt(1, 3),
      });
      if (Math.random() > 0.4) {
        orders.push({
          side: 'ask',
          price: Math.round(fairValue + randInt(5, 10) + jitter()),
          quantity: randInt(1, 2),
        });
      }
      break;
    }
    case 'BEAR': {
      // Aggressive asks below fair value, bids wide below
      orders.push({
        side: 'ask',
        price: Math.round(fairValue + randInt(-5, -1) + jitter()),
        quantity: randInt(1, 2),
      });
      if (Math.random() > 0.4) {
        orders.push({
          side: 'bid',
          price: Math.round(fairValue + randInt(-10, -5) + jitter()),
          quantity: randInt(1, 2),
        });
      }
      break;
    }
    case 'WHALE': {
      // Tight market-maker spread, large quantity
      orders.push({
        side: 'bid',
        price: Math.round(fairValue + randInt(-2, -1) + jitter()),
        quantity: randInt(2, 5),
      });
      orders.push({
        side: 'ask',
        price: Math.round(fairValue + randInt(1, 2) + jitter()),
        quantity: randInt(2, 5),
      });
      break;
    }
    case 'ROOKIE': {
      // Wide random spread, small qty, sometimes on the wrong side
      orders.push({
        side: 'bid',
        price: Math.round(fairValue + randInt(-8, 3) + jitter()),
        quantity: 1,
      });
      if (Math.random() > 0.3) {
        orders.push({
          side: 'ask',
          price: Math.round(fairValue + randInt(-3, 8) + jitter()),
          quantity: 1,
        });
      }
      break;
    }
    case 'DEALER':
    default: {
      // Tight spread, small qty, balanced
      orders.push({
        side: 'bid',
        price: Math.round(fairValue - 3 + jitter()),
        quantity: randInt(1, 2),
      });
      orders.push({
        side: 'ask',
        price: Math.round(fairValue + 3 + jitter()),
        quantity: randInt(1, 2),
      });
      break;
    }
  }

  // Ensure all prices are at least 1 and quantities at least 1
  return orders.map((o) => ({
    ...o,
    price: Math.max(1, o.price),
    quantity: Math.max(1, o.quantity),
  }));
}

// ---------------------------------------------------------------------------
// Bot service
// ---------------------------------------------------------------------------

class BotService {
  private activeTimers = new Map<string, NodeJS.Timeout[]>();

  /**
   * Tracking keys for phases we have already scheduled, to avoid duplicates.
   * Format: `${roomId}:${roundNumber}:${phase}`
   */
  private scheduledPhases = new Set<string>();

  // -----------------------------------------------------------------------
  // Public: add a bot to a room
  // -----------------------------------------------------------------------

  async addBot(
    roomId: string,
    requesterId: string,
    character?: string,
  ): Promise<RoomRecord> {
    const updated = await roomService.addBot(roomId, requesterId, character);

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

  // -----------------------------------------------------------------------
  // Event handler: react to room updates
  // -----------------------------------------------------------------------

  handleRoomUpdate(room: RoomRecord): void {
    // Seed KG entities for all players
    this.seedBotEntities(room);

    // If the room is in a trading phase, schedule bot actions
    if (TRADING_PHASES.has(room.status)) {
      this.scheduleBotsForPhase(room);
    }

    // Record outcomes when a round finishes
    if (room.status === 'finished' && room.gameState) {
      this.recordRoundResults(room);
    }
  }

  // -----------------------------------------------------------------------
  // Phase-aware scheduling
  // -----------------------------------------------------------------------

  private scheduleBotsForPhase(room: RoomRecord): void {
    const bots = room.players.filter((p) => p.isBot);
    if (bots.length === 0) return;

    const phase = room.status as TradingPhase;
    const scheduleKey = `${room.id}:${room.roundNumber}:${phase}`;

    // Already scheduled for this exact room+round+phase
    if (this.scheduledPhases.has(scheduleKey)) return;
    this.scheduledPhases.add(scheduleKey);

    // Clear any timers from a previous phase in this room
    const timerKey = `${room.id}:${room.roundNumber}`;
    this.clearTimers(timerKey);

    const timers: NodeJS.Timeout[] = [];

    for (const bot of bots) {
      // Math.random() is intentional: scheduling jitter is not security-sensitive
      const delay = BOT_MIN_DELAY + Math.random() * (BOT_MAX_DELAY - BOT_MIN_DELAY);

      const timer = setTimeout(() => {
        this.executeBotPhaseAction(room.id, bot, phase).catch((err) => {
          logger.error(
            { err, botId: bot.id, roomId: room.id, phase },
            'bot phase action failed',
          );
        });
      }, delay);

      timers.push(timer);
    }

    this.activeTimers.set(timerKey, timers);
  }

  // -----------------------------------------------------------------------
  // Execute a single bot's phase action
  // -----------------------------------------------------------------------

  private async executeBotPhaseAction(
    roomId: string,
    bot: RoomPlayer,
    phase: TradingPhase,
  ): Promise<void> {
    // Re-fetch the room to get the latest state (cards may have been revealed)
    let room: RoomRecord;
    try {
      room = await roomService.getRoom(roomId);
    } catch {
      logger.warn({ roomId, botId: bot.id }, 'room not found for bot action');
      return;
    }

    // Verify we're still in a trading phase
    if (!TRADING_PHASES.has(room.status)) {
      logger.debug({ roomId, botId: bot.id, status: room.status }, 'room no longer in trading phase');
      return;
    }

    // Cancel mispriced orders from previous phases first
    await this.cancelMispricedOrders(roomId, bot, room);

    // Decide and submit new orders
    const orders = this.decideOrders(bot, room);

    for (const order of orders) {
      try {
        await roomService.submitOrder(roomId, bot.id, order);

        logger.info(
          {
            botId: bot.id,
            character: bot.character,
            roomId,
            round: room.roundNumber,
            phase,
            side: order.side,
            price: order.price,
            quantity: order.quantity,
          },
          'bot submitted order',
        );

        // Light KG integration: seed entity after each submission
        knowledgeGraph.ensurePlayerEntity(
          bot.id,
          bot.name,
          true,
          bot.character,
        );
      } catch (err) {
        // Log and continue — don't let one failed order crash the bot
        if (err instanceof RoomServiceError) {
          logger.warn(
            { botId: bot.id, roomId, order, status: err.status, message: err.message },
            'bot order rejected',
          );
        } else {
          logger.error({ err, botId: bot.id, roomId, order }, 'bot order submission failed');
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Bot decision logic
  // -----------------------------------------------------------------------

  private decideOrders(
    bot: RoomPlayer,
    room: RoomRecord,
  ): OrderDecision[] {
    const personality = (bot.character as BotPersonality) || 'ROOKIE';
    const gs = room.gameState;
    if (!gs) return [];

    // Read the bot's private card
    const botCard = gs.playerCards?.find((pc) => pc.id === bot.id);
    const cardValue = botCard?.value ?? 0;

    // Get revealed community cards for the current phase
    const revealedCards = gs.revealedCommunityCards ?? [];
    const playerCount = room.players.length;

    const fairValue = estimateFairValue(cardValue, revealedCards, playerCount);

    return generateOrders(personality, fairValue);
  }

  // -----------------------------------------------------------------------
  // Cancel mispriced orders
  // -----------------------------------------------------------------------

  private async cancelMispricedOrders(
    roomId: string,
    bot: RoomPlayer,
    room: RoomRecord,
  ): Promise<void> {
    const gs = room.gameState;
    if (!gs) return;

    const botCard = gs.playerCards?.find((pc) => pc.id === bot.id);
    const cardValue = botCard?.value ?? 0;
    const revealedCards = gs.revealedCommunityCards ?? [];
    const fairValue = estimateFairValue(cardValue, revealedCards, room.players.length);

    // Find this bot's open orders that are now mispriced
    const botOrders = gs.orders.filter(
      (o) => o.playerId === bot.id && o.status === 'open',
    );

    for (const order of botOrders) {
      const deviation = Math.abs(order.price - fairValue);
      if (deviation > MISPRICE_THRESHOLD) {
        try {
          await roomService.cancelOrder(roomId, bot.id, order.id);
          logger.debug(
            { botId: bot.id, roomId, orderId: order.id, deviation: deviation.toFixed(1) },
            'bot cancelled mispriced order',
          );
        } catch (err) {
          // Order may have already been filled or cancelled
          logger.debug(
            { err, botId: bot.id, orderId: order.id },
            'failed to cancel mispriced order (may be filled)',
          );
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // KG bookkeeping
  // -----------------------------------------------------------------------

  private seedBotEntities(room: RoomRecord): void {
    for (const player of room.players) {
      knowledgeGraph.ensurePlayerEntity(
        player.id,
        player.name,
        player.isBot ?? false,
        player.character,
      );
    }
  }

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

  // -----------------------------------------------------------------------
  // Timer management
  // -----------------------------------------------------------------------

  private clearTimers(key: string): void {
    const existing = this.activeTimers.get(key);
    if (existing) {
      existing.forEach(clearTimeout);
      this.activeTimers.delete(key);
    }
  }

  /**
   * Cancel all pending bot timers. Use on server shutdown.
   */
  shutdown(): void {
    for (const [, timers] of this.activeTimers) {
      timers.forEach(clearTimeout);
    }
    this.activeTimers.clear();
    this.scheduledPhases.clear();
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
