import type { RoomRecord } from '../services/roomService';
import type { RoomGameState } from '../services/gameEngine';

/**
 * Strip hidden information from room state for a specific player.
 * - Only show the player's own card value (others get value: null)
 * - Only show revealedCommunityCards (strip raw communityCards)
 * - Anonymize other players' orders (strip playerId/playerName)
 */
export function sanitizeRoomForPlayer(room: RoomRecord, playerId: string | undefined): any {
  if (!room.gameState) return room;

  const gs = room.gameState;

  return {
    ...room,
    gameState: {
      ...gs,
      // NEVER send raw community cards to clients
      communityCards: undefined,
      // Only send revealed community cards
      revealedCommunityCards: gs.revealedCommunityCards,
      // Only show own card value, others get null
      playerCards: gs.playerCards?.map(pc => ({
        id: pc.id,
        value: pc.id === playerId ? pc.value : (pc.revealed ? pc.value : null),
        revealed: pc.revealed,
      })),
      // Anonymize other players' orders (keep own orders with full info)
      orders: gs.orders?.map(order => ({
        ...order,
        playerId: order.playerId === playerId ? order.playerId : undefined,
        playerName: order.playerId === playerId ? order.playerName : undefined,
        isMine: order.playerId === playerId,
      })),
    },
  };
}
