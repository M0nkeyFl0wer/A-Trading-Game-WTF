/**
 * KG Order Listener
 *
 * Listens for phase_advance and settlement events on the game event bus
 * and records phase-level summaries into the knowledge graph.
 *
 * Auto-subscribes on import (same pattern as auditService).
 */

import type { TradingPhase, MatchedTrade } from '@trading-game/shared';
import { gameEvents } from '../lib/gameEvents';
import { knowledgeGraph } from './knowledgeGraph';
import { logger } from '../lib/logger';

function handlePhaseEvent(event: {
  type: string;
  roomId: string;
  roundNumber: number;
  payload: Record<string, unknown>;
}): void {
  if (event.type !== 'phase_advance' && event.type !== 'settlement') return;

  try {
    const { roomId, roundNumber, payload } = event;

    // Extract the phase that just ended from the payload.
    // phase_advance fires when moving *to* a new phase, so previousPhase
    // is the one we're summarizing. For settlement the phase is 'turn'.
    const phase = (payload.previousPhase ?? payload.phase ?? 'turn') as TradingPhase;

    // Extract matched trades from the payload (injected by roomService)
    const trades = (payload.matchedTrades ?? payload.trades ?? []) as MatchedTrade[];

    if (trades.length === 0) {
      // Still record a summary even with no trades -- it's useful signal
      knowledgeGraph.recordPhaseSummary(roomId, roundNumber, phase, {
        totalTrades: 0,
        avgPrice: 0,
        priceRange: [0, 0],
        volumeByPlayer: {},
      });
      return;
    }

    // Compute summary stats
    let priceSum = 0;
    let priceMin = Infinity;
    let priceMax = -Infinity;
    const volumeByPlayer: Record<string, number> = {};

    for (const trade of trades) {
      priceSum += trade.price;
      if (trade.price < priceMin) priceMin = trade.price;
      if (trade.price > priceMax) priceMax = trade.price;

      volumeByPlayer[trade.buyerId] = (volumeByPlayer[trade.buyerId] ?? 0) + trade.quantity;
      volumeByPlayer[trade.sellerId] = (volumeByPlayer[trade.sellerId] ?? 0) + trade.quantity;
    }

    const avgPrice = trades.length > 0 ? priceSum / trades.length : 0;

    knowledgeGraph.recordPhaseSummary(roomId, roundNumber, phase, {
      totalTrades: trades.length,
      avgPrice: Math.round(avgPrice * 100) / 100,
      priceRange: [
        priceMin === Infinity ? 0 : priceMin,
        priceMax === -Infinity ? 0 : priceMax,
      ],
      volumeByPlayer,
    });

    logger.debug(
      { roomId, roundNumber, phase, totalTrades: trades.length },
      'kg: recorded phase summary',
    );
  } catch (err) {
    // Non-fatal: KG recording should never break gameplay
    logger.debug({ err, roomId: event.roomId }, 'kg: phase summary recording failed (non-fatal)');
  }
}

// Auto-subscribe on import
gameEvents.on('game_event', handlePhaseEvent);

logger.info('KG order listener subscribed to game events');
