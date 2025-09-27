import { Router, Request, Response } from 'express';

const router = Router();

/**
 * API root and health check routes
 */

// API root
router.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'A Trading Game WTF API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      trading: '/api/trading',
      bot: '/api/bot',
      room: '/api/room',
      user: '/api/user',
      characters: '/api/characters',
      rooms: '/api/rooms'
    }
  });
});

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Characters endpoint (public)
router.get('/characters', (req: Request, res: Response) => {
  res.status(200).json({
    characters: [
      {
        id: 'DEALER',
        name: 'The Dealer',
        description: 'Professional and neutral narrator',
        voiceId: 'EXAVITQu4vr4xnSDxMaL',
        riskTolerance: 0.5,
        emoji: '🎰'
      },
      {
        id: 'BULL',
        name: 'Bull Runner',
        description: 'Optimistic trader who loves the uptrend',
        voiceId: '21m00Tcm4TlvDq8ikWAM',
        riskTolerance: 0.8,
        emoji: '🐂'
      },
      {
        id: 'BEAR',
        name: 'Bear Necessities',
        description: 'Pessimistic analyst who sees the downside',
        voiceId: 'AZnzlk1XvdvUeBnXmlld',
        riskTolerance: 0.3,
        emoji: '🐻'
      },
      {
        id: 'WHALE',
        name: 'The Whale',
        description: 'Big player who moves markets',
        voiceId: 'pNInz6obpgDQGcFmaJgB',
        riskTolerance: 0.9,
        emoji: '🐋'
      },
      {
        id: 'ROOKIE',
        name: 'Fresh Trader',
        description: 'Enthusiastic beginner learning the ropes',
        voiceId: 'yoZ06aMxZJJ28mfd3POQ',
        riskTolerance: 0.5,
        emoji: '🎯'
      }
    ]
  });
});

// Rooms endpoint (public list)
router.get('/rooms', (req: Request, res: Response) => {
  res.status(200).json({
    rooms: [
      {
        id: 'lobby',
        name: 'Main Lobby',
        players: 0,
        maxPlayers: 100,
        status: 'open',
        type: 'lobby'
      }
    ]
  });
});

// 404 handler for undefined API routes
router.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `API endpoint ${req.originalUrl} does not exist`,
    availableEndpoints: [
      '/api/health',
      '/api/auth/login',
      '/api/auth/signup',
      '/api/characters',
      '/api/rooms'
    ]
  });
});

export default router;