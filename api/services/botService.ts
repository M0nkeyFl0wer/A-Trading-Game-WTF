import { logger } from '../lib/logger';
import { roomService, RoomServiceError, type RoomRecord, type RoomPlayer } from './roomService';
import { roomEvents } from '../lib/roomEvents';
import { gameEvents, type GameEvent } from '../lib/gameEvents';
import { FloorCoordinator } from '../agents/floorCoordinator';
import { createPersonalityAgent } from '../agents/personalities';
import { getStrategyForCharacter } from '../agents/strategy';
import { isFloorModeEnabled } from '../lib/featureFlags';

// A targeted quote request deserves a faster answer than the passive 3s tick
// loop that drives ordinary order-book flow.
const QUOTE_RESPONSE_DELAY_MIN_MS = 800;
const QUOTE_RESPONSE_DELAY_JITTER_MS = 700;

// ---------------------------------------------------------------------------
// Coordinator singleton
// ---------------------------------------------------------------------------

// Floor mode (issue #25/#28) is read once here, when the singleton is built.
// On -> bots trade only through quotes (Strategy) and the order book is retired
// for them; off -> the legacy order-book path drives bots exactly as before.
const coordinator = new FloorCoordinator({ floorMode: isFloorModeEnabled() });

// Track which rooms are actively ticking
const activeRooms = new Set<string>();

// ---------------------------------------------------------------------------
// Bot service
// ---------------------------------------------------------------------------

class BotService {
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
      // Register the bot as a trading agent with the coordinator
      const agent = createPersonalityAgent(
        addedBot.id,
        addedBot.name,
        addedBot.character,
      );
      coordinator.registerAgent(agent);

      logger.info(
        { roomId, botId: addedBot.id, character: addedBot.character },
        'bot added to room and registered as agent',
      );
    }

    return updated;
  }

  // -----------------------------------------------------------------------
  // Event handler: react to room updates
  // -----------------------------------------------------------------------

  handleRoomUpdate(room: RoomRecord): void {
    if (!room?.id) return;

    const phase = room.status;
    const isTradingPhase = phase === 'blind' || phase === 'flop' || phase === 'turn';

    if (isTradingPhase && !activeRooms.has(room.id)) {
      // Ensure all bots in this room are registered as agents
      for (const player of room.players.filter(p => p.isBot)) {
        if (!coordinator.hasAgent(player.id)) {
          const agent = createPersonalityAgent(
            player.id,
            player.name,
            player.character,
          );
          coordinator.registerAgent(agent);
        }
      }

      coordinator.startTicking(room.id);
      activeRooms.add(room.id);
      logger.info(
        {
          roomId: room.id,
          phase,
          botCount: room.players.filter(p => p.isBot).length,
        },
        'floor coordinator started',
      );
    }

    if (!isTradingPhase && activeRooms.has(room.id)) {
      coordinator.stopTicking(room.id);
      activeRooms.delete(room.id);
      logger.info({ roomId: room.id, phase }, 'floor coordinator stopped');
    }
  }

  // -----------------------------------------------------------------------
  // Quote requests: auto-respond on behalf of a bot target
  // -----------------------------------------------------------------------

  async handleQuoteRequest(event: GameEvent): Promise<void> {
    const { roomId, payload } = event;
    const quoteId = payload.quoteId as string | undefined;
    const targetId = payload.targetId as string | undefined;
    if (!quoteId || !targetId) return;

    try {
      const room = await roomService.getRoom(roomId);
      const target = room.players.find((p) => p.id === targetId);
      if (!target?.isBot) return;

      const delay = QUOTE_RESPONSE_DELAY_MIN_MS + Math.random() * QUOTE_RESPONSE_DELAY_JITTER_MS;
      setTimeout(() => {
        this.respondToQuoteAsBot(roomId, quoteId, targetId).catch((err) =>
          logger.error({ err, roomId, quoteId }, 'bot quote auto-response failed'),
        );
      }, delay);
    } catch (err) {
      logger.error({ err, roomId, quoteId }, 'bot quote-request handling failed');
    }
  }

  private async respondToQuoteAsBot(roomId: string, quoteId: string, botId: string): Promise<void> {
    const room = await roomService.getRoom(roomId);
    const gs = room.gameState;
    if (!gs) return;

    // Quote may already be expired, answered by a human hand, or the phase
    // may have moved on and dropped it -- silently no-op, never crash the timer.
    const quote = gs.quotes?.find((q) => q.id === quoteId);
    if (!quote || quote.status !== 'pending') return;

    const bot = room.players.find((p) => p.id === botId);
    const botCard = gs.playerCards.find((c) => c.id === botId);
    if (!bot || !botCard) return;

    // Route the answer through the SINGLE Strategy interface (issue #25). The
    // strategy's RESPOND branch still produces the exact #27 bluff -- the Bull
    // talks it up, the Bear down, the Whale quotes loud to drag the crowd -- but
    // now via `decide`, so there is one and only one place bot pricing lives.
    // This handles the HUMAN -> bot quote (a human asked a bot for a price);
    // bot -> bot quotes are answered inside the FloorCoordinator's floor tick.
    const strategy = getStrategyForCharacter(bot.character);
    const action = strategy.decide(
      {
        consensus: gs.consensus,
        // Timing does not affect a bluffed response; the RESPOND branch ignores
        // it, so a neutral placeholder is fine here.
        timeRemainingMs: 0,
        phaseDurationMs: 1,
        targets: [],
        rng: Math.random,
      },
      {
        myId: botId,
        myCard: botCard.value,
        revealedCommunityCards: gs.revealedCommunityCards,
        playerCount: room.players.length,
        myNetPosition: 0,
        pendingForMe: { quoteId },
      },
    );
    if (action.type !== 'respondQuote') return;

    await roomService.respondToQuote(roomId, botId, quoteId, action.bid, action.ask);
  }

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  shutdown(): void {
    coordinator.shutdown();
    activeRooms.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton + event wiring
// ---------------------------------------------------------------------------

export const botService = new BotService();

// Listen for room updates to trigger bot behavior
roomEvents.on('room:updated', (room: unknown) => {
  try {
    const r = room as RoomRecord;
    botService.handleRoomUpdate(r);
  } catch (err) {
    logger.error({ err }, 'botService room:updated handler error');
  }
});

// Listen for quote requests targeting a bot, so it can answer without
// waiting on the passive tick loop.
gameEvents.on('game_event', (event: GameEvent) => {
  if (event.type !== 'quote_request') return;
  botService.handleQuoteRequest(event).catch((err) =>
    logger.error({ err }, 'botService quote_request handler error'),
  );
});
