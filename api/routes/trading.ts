import { Router, Request, Response } from 'express';
import { tradingLimiter } from '../middleware/rateLimiting';
import { validateInput, validationSchemas } from '@trading-game/shared';
import { roomService } from '../services/roomService';
import { logger } from '../lib/logger';

const router = Router();

router.post('/execute', tradingLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { roomId, price, quantity, side } = req.body;
    if (!roomId || typeof roomId !== 'string') return res.status(400).json({ error: 'Missing roomId' });
    const v = validateInput(price, validationSchemas.tradeAmount);
    if (!v.isValid) return res.status(400).json({ error: 'Invalid trade', message: v.error });
    if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'Invalid side' });
    const room = await roomService.submitTrade(roomId, req.user.id, {
      price: Number(price), quantity: Math.max(1, Math.floor(Number(quantity) || 1)), side,
    });
    const latestTrade = room.pendingTrades?.[room.pendingTrades.length - 1];
    return res.status(200).json({ success: true, trade: latestTrade ?? { price, quantity, side, timestamp: Date.now() } });
  } catch (error: any) {
    logger.error({ err: error }, 'Trading error');
    return res.status(error?.status || 500).json({ error: 'Trading failed', message: error?.message || 'An error occurred' });
  }
});

router.get('/portfolio', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const rooms = await roomService.listRooms();
    let totalBalance = 0, gamesPlayed = 0;
    for (const room of rooms) {
      const player = room.players.find((p) => p.id === req.user!.id);
      if (player) { totalBalance += player.balance; gamesPlayed++; }
    }
    return res.status(200).json({ balance: totalBalance || 1000, gamesPlayed, positions: [], trades: [] });
  } catch (error) {
    logger.error({ err: error }, 'Portfolio fetch failed');
    return res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

router.get('/market', async (_req: Request, res: Response) => {
  try {
    const rooms = await roomService.listRooms();
    const activeTrades = rooms.filter((r) => r.gameState?.trades).flatMap((r) => r.gameState!.trades);
    const prices = activeTrades.map((t) => t.price).filter(Boolean);
    const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 100;
    return res.status(200).json({ price: Number(avgPrice.toFixed(2)), volume: activeTrades.length, activeTables: rooms.filter((r) => r.status === 'playing').length, totalPlayers: rooms.reduce((acc, r) => acc + r.players.length, 0) });
  } catch {
    return res.status(200).json({ price: 100, volume: 0, activeTables: 0, totalPlayers: 0 });
  }
});

router.get('/history', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const rooms = await roomService.listRooms();
    const userTrades = rooms.filter((r) => r.gameState?.trades).flatMap((r) => r.gameState!.trades).filter((t) => t.playerId === req.user!.id || t.counterpartyId === req.user!.id).sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
    return res.status(200).json({ trades: userTrades });
  } catch {
    return res.status(200).json({ trades: [] });
  }
});

export default router;
