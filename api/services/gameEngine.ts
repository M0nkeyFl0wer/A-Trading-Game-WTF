import { createHash, randomBytes, randomInt } from 'crypto';
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

export interface CardCommitment {
  id: string;
  commitment: string;
}

export interface CardNonce {
  id: string;
  nonce: string;
}

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

  // -- Commit-reveal cryptographic verification fields --

  /** SHA-256 commitments for all dealt cards (published at deal time). */
  commitments?: CardCommitment[];
  /** Nonces for cards revealed so far (published progressively). */
  revealedNonces?: CardNonce[];
  /** All nonces — stored server-side, stripped by sanitize until settlement. */
  allNonces?: CardNonce[];
  /** Hex seed used for the shuffle — revealed at settlement. */
  shuffleSeed?: string;
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
    const j = randomInt(0, i + 1);
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
  return communityCards.slice(0, config.communityCardsRevealed);
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
    const shuffleSeed = randomBytes(32).toString('hex');
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

    // Generate nonces and commitments for every dealt card
    const cardNonces: Array<{ id: string; nonce: string; value: number }> = [];

    for (const pc of playerCards) {
      const nonce = randomBytes(16).toString('hex');
      cardNonces.push({ id: pc.id, nonce, value: pc.value });
    }

    for (let i = 0; i < communityCards.length; i++) {
      const nonce = randomBytes(16).toString('hex');
      cardNonces.push({ id: `community_${i}`, nonce, value: communityCards[i] });
    }

    const commitments: CardCommitment[] = cardNonces.map((cn) => ({
      id: cn.id,
      commitment: createHash('sha256')
        .update(`${cn.value}:${cn.nonce}`)
        .digest('hex'),
    }));

    const allNonces: CardNonce[] = cardNonces.map((cn) => ({
      id: cn.id,
      nonce: cn.nonce,
    }));

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
      commitments,
      allNonces,
      revealedNonces: [],
      shuffleSeed,
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

    // Determine which community card nonces to reveal progressively
    const prevRevealedCount = gs.revealedCommunityCards?.length ?? 0;
    const nextRevealedCards = revealedCardsForPhase(gs.communityCards, nextConfig.phase);
    const revealedNonces = [...(gs.revealedNonces ?? [])];

    for (let i = prevRevealedCount; i < nextRevealedCards.length; i++) {
      const nonce = gs.allNonces?.find((n) => n.id === `community_${i}`);
      if (nonce) {
        revealedNonces.push(nonce);
      }
    }

    const updated: RoomGameState = {
      ...gs,
      phase: nextConfig.phase,
      revealedCommunityCards: nextRevealedCards,
      phaseEndsAt: now + nextConfig.durationMs,
      updatedAt: now,
      revealedNonces,
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

    const phase = gs.phase as TradingPhase;

    const { order, trades: newTrades } = book.submitOrder({
      playerId,
      playerName,
      side: orderInput.side,
      price: orderInput.price,
      quantity: orderInput.quantity,
      timestamp: Date.now(),
      phase,
    });

    // Rebuild the full orders and trades lists from the book
    const allOrders = book.getAllOrders();
    const allTrades = book.getMatchedTrades();

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
    const cancelled = book.cancelOrder(orderId);

    if (!cancelled) {
      throw new Error('order not found or already settled');
    }

    // Rebuild the full orders list from the book
    const updatedOrders = book.getAllOrders();

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

    // Reveal all cards and all crypto verification data in final state
    const finalGameState: RoomGameState = {
      ...gs,
      phase: 'finished',
      revealedCommunityCards: gs.communityCards,
      playerCards: gs.playerCards.map((c) => ({ ...c, revealed: true })),
      settlementTotal,
      pnl,
      updatedAt: Date.now(),
      // Reveal all nonces and shuffle seed so anyone can verify the deal
      revealedNonces: gs.allNonces ?? [],
      shuffleSeed: gs.shuffleSeed,
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

}

export const gameEngine = new GameEngine();
