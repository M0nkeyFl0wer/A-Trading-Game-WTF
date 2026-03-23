import { logger } from '../lib/logger';
import { roomService, RoomServiceError, type RoomRecord, type RoomPlayer } from './roomService';
import { roomEvents } from '../lib/roomEvents';
import { FloorCoordinator } from '../agents/floorCoordinator';
import { createPersonalityAgent } from '../agents/personalities';

// ---------------------------------------------------------------------------
// Coordinator singleton
// ---------------------------------------------------------------------------

const coordinator = new FloorCoordinator();

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
