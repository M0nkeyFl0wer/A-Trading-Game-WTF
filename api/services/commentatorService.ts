import { roomEvents } from '../lib/roomEvents';
import { logger } from '../lib/logger';
import type { RoomRecord } from './roomService';
import type { MatchedTrade } from '@trading-game/shared';

// ---------------------------------------------------------------------------
// Commentary types
// ---------------------------------------------------------------------------

export type CommentaryCharacter = 'DEALER' | 'BULL' | 'BEAR' | 'WHALE' | 'ROOKIE';

export interface Commentary {
  text: string;
  priority: 'low' | 'medium' | 'high';
  character: CommentaryCharacter;
}

// ---------------------------------------------------------------------------
// Commentator service
// ---------------------------------------------------------------------------

class CommentatorService {
  /**
   * Track previous room states so we can detect transitions.
   * Keyed by room ID; stores a lightweight snapshot of the fields we compare.
   */
  private previousStates = new Map<string, {
    status: string;
    roundNumber: number;
    matchedTradeCount: number;
  }>();

  /**
   * Lines the trading bots wanted to say, waiting for the next room update to
   * carry them to the clients. The floor coordinator ticks on its own timer,
   * independently of room events, so it drops its commentary here rather than
   * emitting directly. Keyed by room ID.
   *
   * The coordinator already throttles itself (commentaryThrottleMs), but we cap
   * the queue anyway so a stalled room can never accumulate lines without bound.
   */
  private pendingAgentCommentary = new Map<string, Commentary[]>();

  private static readonly MAX_PENDING_AGENT_LINES = 3;

  /**
   * Queue a line spoken by one of the bot personalities. Called by the floor
   * coordinator when an agent's activate() returns commentary.
   */
  pushAgentCommentary(roomId: string, character: CommentaryCharacter, text: string): void {
    const queue = this.pendingAgentCommentary.get(roomId) ?? [];
    queue.push({ text, priority: 'low', character });
    // Keep only the most recent lines -- stale banter is worse than silence.
    this.pendingAgentCommentary.set(
      roomId,
      queue.slice(-CommentatorService.MAX_PENDING_AGENT_LINES),
    );
  }

  /**
   * Generate commentary based on room state changes.
   * Returns an array of commentary items, sorted highest priority first.
   */
  generateCommentary(room: RoomRecord): Commentary[] {
    const comments: Commentary[] = [];
    const gs = room.gameState;
    const prev = this.previousStates.get(room.id);

    // Snapshot current state for next comparison
    this.previousStates.set(room.id, {
      status: room.status,
      roundNumber: room.roundNumber,
      matchedTradeCount: gs?.matchedTrades?.length ?? 0,
    });

    if (!gs) return comments;

    // ----- Phase transitions -----
    if (room.status !== prev?.status) {
      switch (gs.phase) {
        case 'blind':
          comments.push({
            text: `Round ${gs.roundNumber} begins! Cards are dealt. ${room.players.length} traders at the table. Trade blind!`,
            priority: 'high',
            character: 'DEALER',
          });
          break;

        case 'flop': {
          const card = gs.revealedCommunityCards?.[0];
          comments.push({
            text: card !== undefined
              ? `First community card revealed: ${card}! ${card >= 15 ? "That's a big one!" : card <= 3 ? 'Low card — bears might be smiling.' : 'Interesting...'}`
              : 'First community card flipped!',
            priority: 'high',
            character: 'DEALER',
          });
          break;
        }

        case 'turn': {
          const card = gs.revealedCommunityCards?.[1];
          comments.push({
            text: card !== undefined
              ? `Second card shows ${card}! ${card === 20 ? 'Twenty! The market is going to move!' : card === -10 ? 'Negative ten! That changes everything!' : 'The picture is getting clearer.'}`
              : 'Second community card revealed!',
            priority: 'high',
            character: 'DEALER',
          });
          break;
        }

        case 'finished': {
          const total = gs.settlementTotal;
          if (total !== undefined) {
            comments.push({
              text: `All cards revealed! Settlement total: ${total}. ${total > 70 ? 'Bulls had the right idea!' : total < 50 ? 'Bears called it!' : 'Right down the middle.'}`,
              priority: 'high',
              character: 'DEALER',
            });
          }
          break;
        }
      }
    }

    // ----- New matched trades -----
    const prevTradeCount = prev?.matchedTradeCount ?? 0;
    const currentTradeCount = gs.matchedTrades?.length ?? 0;

    if (currentTradeCount > prevTradeCount) {
      const newTrades = gs.matchedTrades.slice(prevTradeCount);
      for (const trade of newTrades) {
        if (trade.quantity >= 3) {
          comments.push({
            text: `Big trade! ${trade.quantity} contracts at ${trade.price}!`,
            priority: 'medium',
            character: 'DEALER',
          });
        } else if (trade.price > 80 || trade.price < 40) {
          comments.push({
            text: `${trade.price > 80 ? 'Aggressive' : 'Contrarian'} trade at ${trade.price}. Someone's making a statement.`,
            priority: 'low',
            character: 'DEALER',
          });
        }
      }
    }

    // Drain whatever the bots wanted to say since the last room update.
    const agentLines = this.pendingAgentCommentary.get(room.id);
    if (agentLines?.length) {
      comments.push(...agentLines);
      this.pendingAgentCommentary.delete(room.id);
    }

    return comments;
  }

  /**
   * Clean up tracked state for a room that has been removed.
   */
  removeRoom(roomId: string): void {
    this.previousStates.delete(roomId);
    this.pendingAgentCommentary.delete(roomId);
  }
}

// ---------------------------------------------------------------------------
// Singleton + event wiring
// ---------------------------------------------------------------------------

export const commentatorService = new CommentatorService();

roomEvents.on('room:removed', (payload: { id: string }) => {
  commentatorService.removeRoom(payload.id);
});
