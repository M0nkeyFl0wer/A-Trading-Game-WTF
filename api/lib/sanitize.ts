import type { RoomRecord } from '../services/roomService';
import type { RoomGameState } from '../services/gameEngine';

/**
 * Strip hidden information from room state for a specific player.
 * - Only show the player's own card value (others get value: null)
 * - Only show revealedCommunityCards (strip raw communityCards)
 * - Anonymize other players' orders (strip playerId/playerName)
 * - Anonymize matched trades (only reveal the requesting player's identity)
 * - Strip allNonces and shuffleSeed during active play (commit-reveal)
 */
export function sanitizeRoomForPlayer(room: RoomRecord, playerId: string | undefined): any {
  if (!room.gameState) return room;

  const gs = room.gameState;
  const isFinished = gs.phase === 'finished';

  // Build a safe gameState from scratch -- never spread the raw gs directly.
  // This allowlist approach prevents new fields from leaking automatically.
  const safeGameState: Record<string, unknown> = {
    roundNumber: gs.roundNumber,
    phase: gs.phase,
    // NEVER send raw community cards to clients -- only revealed ones
    revealedCommunityCards: gs.revealedCommunityCards,
    phaseEndsAt: gs.phaseEndsAt,
    updatedAt: gs.updatedAt,
    // Only show own card value, others get null
    playerCards: gs.playerCards?.map(pc => ({
      id: pc.id,
      value: pc.id === playerId ? pc.value : (pc.revealed ? pc.value : null),
      revealed: pc.revealed,
    })),
    // Anonymize other players' orders (keep own orders with full info)
    orders: gs.orders?.map(order => ({
      id: order.id,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      timestamp: order.timestamp,
      phase: order.phase,
      status: order.status,
      playerId: order.playerId === playerId ? order.playerId : undefined,
      playerName: order.playerId === playerId ? order.playerName : undefined,
      isMine: order.playerId === playerId,
    })),
    // Anonymize matched trades: only reveal identity for the requesting player
    matchedTrades: gs.matchedTrades?.map(trade => ({
      id: trade.id,
      price: trade.price,
      quantity: trade.quantity,
      buyOrderId: trade.buyOrderId,
      sellOrderId: trade.sellOrderId,
      phase: trade.phase,
      timestamp: trade.timestamp,
      buyerId: trade.buyerId === playerId ? trade.buyerId : undefined,
      buyerName: trade.buyerId === playerId ? trade.buyerName : 'Another trader',
      sellerId: trade.sellerId === playerId ? trade.sellerId : undefined,
      sellerName: trade.sellerId === playerId ? trade.sellerName : 'Another trader',
    })),
    // Commitments are always safe to send (they are the hashes)
    commitments: gs.commitments,
    // Revealed nonces are published progressively (safe)
    revealedNonces: gs.revealedNonces,
  };

  // Only reveal secrets after settlement
  if (isFinished) {
    safeGameState.allNonces = gs.allNonces;
    safeGameState.shuffleSeed = gs.shuffleSeed;
    safeGameState.settlementTotal = gs.settlementTotal;
    safeGameState.pnl = gs.pnl;
    safeGameState.settlementReceipt = gs.settlementReceipt;
  }

  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    hostName: room.hostName,
    maxPlayers: room.maxPlayers,
    status: room.status,
    players: room.players?.map(p => ({
      id: p.id,
      name: p.name,
      balance: p.balance,
      character: p.character,
      isBot: p.isBot,
      isWinner: p.isWinner,
    })),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    roundNumber: room.roundNumber,
    gameState: safeGameState,
  };
}
