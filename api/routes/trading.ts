import { Router, Request, Response } from 'express';
import { tradingLimiter } from '../middleware/rateLimiting';
import { validateInput, validationSchemas } from '@trading-game/shared';
import { roomService } from '../services/roomService';
import { logger } from '../lib/logger';

const router = Router();

/**
 * Trading routes — wraps roomService.submitTrade for convenience.
 *
 * The primary trade flow is POST /api/room/:roomId/trade (in room.ts).
 * These routes provide an alternative entry point and portfolio/market data.
 */

// Execute trade within a room
router.post('/execute', tradingLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    const { roomId, price, quantity, side } = req.body;

    if (!roomId || typeof roomId !== 'string') {
      return res.status(400).json({
        error: 'Missing roomId',
        message: 'Provide the room ID for the trade',
      });
    }

    const amountValidation = validateInput(price, validationSchemas.tradeAmount);
    if (!amountValidation.isValid) {
      return res.status(400).json({
        error: 'Invalid trade',
        message: amountValidation.error,
      });
    }

    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({
        error: 'Invalid side',
        message: 'Side must be buy or sell',
      });
    }

    const room = await roomService.submitTrade(roomId, req.user.id, {
      price: Number(price),
      quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
      side,
    });

    const latestTrade = room.pendingTrades?.[room.pendingTrades.length - 1];

    return res.status(200).json({
      success: true,
      trade: latestTrade ?? { price, quantity, side, timestamp: Date.now() },
    });
  } catch (error: any) {
    logger.error({ err: error }, 'Trading error');
    const status = error?.status || 500;
    return res.status(status).json({
      error: 'Trading failed',
      message: error?.message || 'An error occurred while executing trade',
    });
  }
});

// Get portfolio — aggregated from room balances
router.get('/portfolio', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  try {
    const rooms = await roomService.listRooms();
    let totalBalance = 0;
    let gamesPlayed = 0;

    for (const room of rooms) {
      const player = room.players.find((p) => p.id === req.user!.id);
      if (player) {
        totalBalance += player.balance;
        gamesPlayed++;
      }
    }

    return res.status(200).json({
      balance: totalBalance || 1000,
      gamesPlayed,
      positions: [],
      trades: [],
    });
  } catch (error) {
    logger.error({ err: error }, 'Portfolio fetch failed');
    return res.status(500).json({
      error: 'Failed to fetch portfolio',
      message: 'An error occurred',
    });
  }
});

// Get market data — derived from active rooms
router.get('/market', async (_req: Request, res: Response) => {
  try {
    const rooms = await roomService.listRooms();
    const activeTrades = rooms
      .filter((r) => r.gameState?.trades)
      .flatMap((r) => r.gameState!.trades);

    const prices = activeTrades.map((t) => t.price).filter(Boolean);
    const avgPrice = prices.length > 0
      ? prices.reduce((a, b) => a + b, 0) / prices.length
      : 100;

    return res.status(200).json({
      price: Number(avgPrice.toFixed(2)),
      volume: activeTrades.length,
      activeTables: rooms.filter((r) => r.status === 'playing').length,
      totalPlayers: rooms.reduce((acc, r) => acc + r.players.length, 0),
    });
  } catch {
    return res.status(200).json({
      price: 100,
      volume: 0,
      activeTables: 0,
      totalPlayers: 0,
    });
  }
});

// Get trade history
router.get('/history', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  try {
    const rooms = await roomService.listRooms();
    const userTrades = rooms
      .filter((r) => r.gameState?.trades)
      .flatMap((r) => r.gameState!.trades)
      .filter((t) => t.playerId === req.user!.id || t.counterpartyId === req.user!.id)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);

    return res.status(200).json({ trades: userTrades });
  } catch {
    return res.status(200).json({ trades: [] });
  }
});

export default router;
