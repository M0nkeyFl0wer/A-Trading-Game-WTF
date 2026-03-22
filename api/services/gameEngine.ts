import { OrderBook } from '@trading-game/core';
import {
  DEFAULT_DECK,
  PHASE_SEQUENCE,
} from '@trading-game/shared';
import type {
  TradingPhase,
  Order,
  MatchedTrade,
  DeckValue,
} from '@trading-game/shared';
import type { RoomPlayer, RoomRecord } from './roomService';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RoomGameState {
  roundNumber: number;
  phase: TradingPhase | 'waiting' | 'finished';
  /** All 3 community card values (stored server-side, not all visible). */
  communityCards: number[];
  /** Only the community cards visible in the current phase. */
  revealedCommunityCards: number[];
  orders: Order[];
  matchedTrades: MatchedTrade[];
  playerCards: Array<{ id: string; value: number; revealed: boolean }>;
  /** Unix-ms timestamp when current phase timer expires. */
  phaseEndsAt: number;
  updatedAt: number;
  /** Sum of all 8 cards (player + community). Set after settlement. */
  settlementTotal?: number;
  /** Per-player PnL from CFD settlement. Set after settlement. */
  pnl?: Record<string, number>;
}

export interface GameResult {
  players: RoomPlayer[];
  status: 'finished';
  roundNumber: number;
  gameState: RoomGameState;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shuffleDeck(deck: DeckValue[]): DeckValue[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function revealedCardsForPhase(
  communityCards: number[],
  phase: TradingPhase | 'waiting' | 'finished',
): number[] {
  if (phase === 'waiting') return [];
  if (phase === 'finished') return communityCards;

  const config = PHASE_SEQUENCE.find((p) => p.phase === phase);
  if (!config) return [];
  return communityCards.slice(0, config.revealedCards);
}

// ---------------------------------------------------------------------------
// GameEngine
// ---------------------------------------------------------------------------

export class GameEngine {
  /**
   * Deal a new round: shuffle, assign player cards & community cards,
   * enter the 'blind' phase.
   */
  dealRound(room: RoomRecord): RoomGameState {
    const roundNumber = room.roundNumber;
    const deck = shuffleDeck([...DEFAULT_DECK]);

    const playerCards: RoomGameState['playerCards'] = room.players.map((p) => {
      const value = deck.pop();
      if (value === undefined) throw new Error('deck empty');
      return { id: p.id, value, revealed: false };
    });

    const communityCards: number[] = [];
    for (let i = 0; i < 3; i++) {
      const value = deck.pop();
      if (value === undefined) throw new Error('deck empty');
      communityCards.push(value);
    }

    const blindConfig = PHASE_SEQUENCE[0];
    const now = Date.now();

    const gameState: RoomGameState = {
      roundNumber,
      phase: 'blind',
      communityCards,
      revealedCommunityCards: revealedCardsForPhase(communityCards, 'blind'),
      orders: [],
      matchedTrades: [],
      playerCards,
      phaseEndsAt: now + blindConfig.durationMs,
      updatedAt: now,
    };

    logger.info(
      { roomId: room.id, roundNumber, playerCount: room.players.length },
      'dealt new round',
    );

    return gameState;
  }

  /**
   * Advance to the next phase. Reveals the next community card(s).
   * Returns null if already past the last trading phase.
   */
  advancePhase(room: RoomRecord): RoomGameState | null {
    const gs = room.gameState;
    if (!gs) return null;

    const currentIdx = PHASE_SEQUENCE.findIndex((p) => p.phase === gs.phase);
    const nextIdx = currentIdx + 1;

    if (nextIdx >= PHASE_SEQUENCE.length) {
      // No more trading phases; caller should settle instead.
      return null;
    }

    const nextConfig = PHASE_SEQUENCE[nextIdx];
    const now = Date.now();

    const updated: RoomGameState = {
      ...gs,
      phase: nextConfig.phase,
      revealedCommunityCards: revealedCardsForPhase(gs.communityCards, nextConfig.phase),
      phaseEndsAt: now + nextConfig.durationMs,
      updatedAt: now,
    };

    logger.info(
      { roomId: room.id, from: gs.phase, to: nextConfig.phase },
      'phase advanced',
    );

    return updated;
  }

  /**
   * Submit an order to the order book. Returns updated gameState and any
   * new trades that resulted from matching.
   */
  submitOrder(
    room: RoomRecord,
    playerId: string,
    playerName: string,
    orderInput: { price: number; quantity: number; side: 'bid' | 'ask' },
  ): { gameState: RoomGameState; newTrades: MatchedTrade[] } {
    const gs = room.gameState;
    if (!gs) throw new Error('no active game state');

    // Reconstruct the order book from persisted state
    const book = OrderBook.fromState(gs.orders, gs.matchedTrades);

    const order: Order = {
      id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      playerId,
      playerName,
      side: orderInput.side,
      price: orderInput.price,
      quantity: orderInput.quantity,
      remainingQty: orderInput.quantity,
      status: 'open',
      timestamp: Date.now(),
    };

    const newTrades = book.submit(order);

    // Merge the new order into orders list, and update any resting orders
    // that got filled/partially filled during matching.
    const allOrders = this.mergeOrders(gs.orders, order, book);
    const allTrades = [...gs.matchedTrades, ...newTrades];

    const now = Date.now();
    const gameState: RoomGameState = {
      ...gs,
      orders: allOrders,
      matchedTrades: allTrades,
      updatedAt: now,
    };

    return { gameState, newTrades };
  }

  /**
   * Cancel an open order. Returns updated gameState.
   */
  cancelOrder(room: RoomRecord, orderId: string): RoomGameState {
    const gs = room.gameState;
    if (!gs) throw new Error('no active game state');

    const book = OrderBook.fromState(gs.orders, gs.matchedTrades);
    const cancelled = book.cancel(orderId);

    if (!cancelled) {
      // If not found on the book, just mark it in our list
      const idx = gs.orders.findIndex((o) => o.id === orderId && o.status === 'open');
      if (idx === -1) throw new Error('order not found or already settled');
      gs.orders[idx].status = 'cancelled';
      gs.orders[idx].remainingQty = 0;
    }

    // Rebuild the full orders list reflecting cancellation
    const updatedOrders = gs.orders.map((o) => {
      if (o.id === orderId) {
        return { ...o, status: 'cancelled' as const, remainingQty: 0 };
      }
      return o;
    });

    return {
      ...gs,
      orders: updatedOrders,
      updatedAt: Date.now(),
    };
  }

  /**
   * Settle the round: compute the total of all 8 cards, then PnL for
   * every player based on their matched trades (CFD-style).
   *
   * Settlement formula per trade:
   *   buyerPnL  += (total - price) * qty
   *   sellerPnL += (price - total) * qty
   */
  settleRound(room: RoomRecord): GameResult {
    const gs = room.gameState;
    if (!gs) throw new Error('no active game state');

    const playerCardTotal = gs.playerCards.reduce((sum, c) => sum + c.value, 0);
    const communityTotal = gs.communityCards.reduce((sum, c) => sum + c, 0);
    const settlementTotal = playerCardTotal + communityTotal;

    // Compute per-player PnL
    const pnl: Record<string, number> = {};
    for (const p of room.players) {
      pnl[p.id] = 0;
    }

    for (const trade of gs.matchedTrades) {
      const buyerPnL = (settlementTotal - trade.price) * trade.quantity;
      const sellerPnL = (trade.price - settlementTotal) * trade.quantity;

      if (pnl[trade.buyerId] !== undefined) {
        pnl[trade.buyerId] += buyerPnL;
      }
      if (pnl[trade.sellerId] !== undefined) {
        pnl[trade.sellerId] += sellerPnL;
      }
    }

    // Round PnL and apply to balances
    const updatedPlayers: RoomPlayer[] = room.players.map((player) => {
      const playerPnl = Number((pnl[player.id] ?? 0).toFixed(2));
      pnl[player.id] = playerPnl;
      return {
        ...player,
        balance: Number((player.balance + playerPnl).toFixed(2)),
      };
    });

    // Mark winner(s)
    const winningBalance = Math.max(...updatedPlayers.map((p) => p.balance));
    const finalPlayers = updatedPlayers.map((p) => ({
      ...p,
      isWinner: p.balance === winningBalance,
    }));

    // Reveal all cards in final state
    const finalGameState: RoomGameState = {
      ...gs,
      phase: 'finished',
      revealedCommunityCards: gs.communityCards,
      playerCards: gs.playerCards.map((c) => ({ ...c, revealed: true })),
      settlementTotal,
      pnl,
      updatedAt: Date.now(),
    };

    logger.info(
      { roomId: room.id, settlementTotal, trades: gs.matchedTrades.length },
      'round settled',
    );

    return {
      players: finalPlayers,
      status: 'finished',
      roundNumber: gs.roundNumber,
      gameState: finalGameState,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Merge the newly submitted order into the canonical orders list, and
   * update any existing orders that were modified by matching.
   */
  private mergeOrders(existing: Order[], newOrder: Order, book: OrderBook): Order[] {
    const restingMap = new Map<string, Order>();
    for (const o of book.getRestingOrders()) {
      restingMap.set(o.id, o);
    }

    // Update existing orders whose status/remainingQty changed
    const updated = existing.map((o) => {
      const resting = restingMap.get(o.id);
      if (resting) {
        return { ...o, remainingQty: resting.remainingQty, status: resting.status };
      }
      // If it was resting before but is no longer, it got filled
      if (o.status === 'open' || o.status === 'partial') {
        // Check if it's still in the book
        if (!restingMap.has(o.id)) {
          return { ...o, remainingQty: 0, status: 'filled' as const };
        }
      }
      return o;
    });

    // Add the new order
    updated.push(newOrder);
    return updated;
  }
}

export const gameEngine = new GameEngine();
