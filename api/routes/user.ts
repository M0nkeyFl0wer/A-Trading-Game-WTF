import { Router, Request, Response } from 'express';
import { validateInput, validationSchemas } from '@trading-game/shared';

const router = Router();

/**
 * User profile routes
 */

// Get user profile
router.get('/profile', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  // TODO: Get actual user profile from database
  return res.status(200).json({
    id: req.user.id,
    username: req.user.username || 'testuser',
    email: req.user.email || 'test@example.com',
    stats: {
      gamesPlayed: 0,
      wins: 0,
      totalProfit: 0
    },
    preferences: {
      voiceEnabled: true,
      defaultCharacter: 'DEALER',
      volume: 0.5
    },
    createdAt: Date.now(),
    lastActive: Date.now()
  });
});

// Update user profile
router.put('/profile', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  const { username, preferences } = req.body;

  // Validate username if provided
  if (username) {
    const usernameValidation = validateInput(username, validationSchemas.username);
    if (!usernameValidation.isValid) {
      return res.status(400).json({
        error: 'Invalid username',
        message: usernameValidation.error
      });
    }
  }

  // TODO: Update user profile in database

  return res.status(200).json({
    success: true,
    message: 'Profile updated successfully'
  });
});

// Get user stats
router.get('/stats', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  // TODO: Get actual stats from database
  return res.status(200).json({
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalProfit: 0,
    bestTrade: null,
    worstTrade: null,
    averageProfit: 0,
    favoriteCharacter: 'DEALER',
    totalTrades: 0
  });
});

// Get leaderboard
router.get('/leaderboard', async (req: Request, res: Response) => {
  // Public endpoint - no auth required
  // TODO: Get actual leaderboard from database
  return res.status(200).json({
    leaderboard: [
      {
        rank: 1,
        username: 'TopTrader',
        score: 50000,
        wins: 100,
        winRate: 0.75
      },
      {
        rank: 2,
        username: 'WhaleKing',
        score: 45000,
        wins: 90,
        winRate: 0.72
      },
      {
        rank: 3,
        username: 'BullMaster',
        score: 40000,
        wins: 85,
        winRate: 0.70
      }
    ]
  });
});

// Delete account
router.delete('/account', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  const { password } = req.body;

  if (!password) {
    return res.status(400).json({
      error: 'Password required',
      message: 'Please provide your password to delete account'
    });
  }

  // TODO: Verify password and delete account

  return res.status(200).json({
    success: true,
    message: 'Account deleted successfully'
  });
});

export default router;
