import { Router, Request, Response } from 'express';
import { botLimiter } from '../middleware/rateLimiting';
import { validateInput, validationSchemas, sanitizeInput } from '@trading-game/shared';
import type { MarketData } from '@trading-game/shared';
import { SecureBotSandbox } from '@trading-game/bot';
import { logger } from '../lib/logger';
import { metrics } from '../lib/metrics';

const router: Router = Router();
const botSandbox = new SecureBotSandbox();

router.post('/submit', botLimiter, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  const { code, name } = req.body;

  const codeValidation = validateInput(code, validationSchemas.botCode);
  if (!codeValidation.isValid) {
    metrics.recordBot(false);
    return res.status(400).json({
      error: 'Invalid bot code',
      message: codeValidation.error
    });
  }

  const marketData = buildSimulatedMarketData();
  const portfolio = {
    balance: 10000,
    positions: [],
    trades: []
  };

  const botId = `bot_${req.user.id}_${Date.now()}`;
  const logContext = { botId, userId: req.user.id };

  try {
    const result = await botSandbox.executeBot(botId, code, marketData, portfolio);

    if (!result.success) {
      metrics.recordBot(false);
      logger.warn({ ...logContext, error: result.error }, 'Bot execution failed');
      return res.status(400).json({
        error: 'Bot execution failed',
        message: result.error
      });
    }

    metrics.recordBot(true);
    logger.info({ ...logContext, executionTime: result.executionTime }, 'Bot executed successfully');

    return res.status(200).json({
      success: true,
      botId,
      name: sanitizeInput(name || 'Unnamed Strategy'),
      result: result.trade,
      executionTime: result.executionTime,
      memoryUsed: result.memoryUsed
    });
  } catch (error) {
    metrics.recordBot(false);
    logger.error({ ...logContext, err: error }, 'Bot submission error');
    return res.status(500).json({
      error: 'Bot submission failed',
      message: 'An error occurred while processing bot'
    });
  }
});

router.get('/strategies', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required to view strategies'
    });
  }

  return res.status(200).json({
    strategies: [
      {
        id: '1',
        name: 'Bull Momentum',
        character: 'BULL',
        wins: 0,
        losses: 0
      },
      {
        id: '2',
        name: 'Bear Defense',
        character: 'BEAR',
        wins: 0,
        losses: 0
      }
    ]
  });
});

router.get('/stats/:botId', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  const { botId } = req.params;
  const stats = botSandbox.getStats(botId);

  if (!stats) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Bot statistics not found'
    });
  }

  return res.status(200).json(stats);
});

router.delete('/kill/:botId', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  const { botId } = req.params;
  const killed = botSandbox.killWorker(botId);

  if (!killed) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Bot not found or already terminated'
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Bot terminated successfully'
  });
});

export default router;

const buildSimulatedMarketData = (): MarketData => ({
  price: 100,
  bid: 99.5,
  ask: 100.5,
  volume: 1_000_000,
  high24h: 110,
  low24h: 90,
  change24h: 0.02,
  timestamp: Date.now(),
  open24h: 98,
  volume24h: 5_000_000,
  avgVolume: 200_000,
  buyVolume: 2_600_000,
  sellVolume: 2_400_000,
  avgTradeSize: 250,
  priceHistory: [95, 100, 105, 102, 100],
});
