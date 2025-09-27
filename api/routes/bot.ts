import { Router, Request, Response } from 'express';
import { botLimiter } from '../middleware/rateLimiting';
import { validateInput, validationSchemas } from '../../apps/web/src/lib/security';
import { SecureBotSandbox } from '../../packages/bot/src/sandbox/SecureBotSandbox';

const router = Router();
const botSandbox = new SecureBotSandbox();

/**
 * Bot trading routes with sandbox execution
 */

// Submit bot code
router.post('/submit', botLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    const { code, name } = req.body;

    // Validate bot code
    const codeValidation = validateInput(code, validationSchemas.botCode);
    if (!codeValidation.isValid) {
      return res.status(400).json({
        error: 'Invalid bot code',
        message: codeValidation.error
      });
    }

    // Execute bot in sandbox
    const marketData = {
      price: 100,
      volume: 1000000,
      trend: 'neutral',
      volatility: 0.15,
      momentum: 0.5,
      support: 95,
      resistance: 105
    };

    const portfolio = {
      balance: 10000,
      positions: [],
      trades: []
    };

    const botId = `bot_${req.user.id}_${Date.now()}`;
    const result = await botSandbox.executeBot(botId, code, marketData, portfolio);

    if (!result.success) {
      return res.status(400).json({
        error: 'Bot execution failed',
        message: result.error
      });
    }

    return res.status(200).json({
      success: true,
      botId,
      result: result.trade,
      executionTime: result.executionTime,
      memoryUsed: result.memoryUsed
    });
  } catch (error) {
    console.error('Bot submission error:', error);
    return res.status(500).json({
      error: 'Bot submission failed',
      message: 'An error occurred while processing bot'
    });
  }
});

// Get bot strategies (requires auth)
router.get('/strategies', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required to view strategies'
    });
  }

  // TODO: Get user's saved strategies from database
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

// Get bot statistics
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

// Terminate bot execution
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