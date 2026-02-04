import { Router, Request, Response } from 'express';
import { roomService } from '../services/roomService';
import { metrics } from '../lib/metrics';

const router: Router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'A Trading Game WTF API',
    version: '1.0.0',
    status: 'running',
    metrics: metrics.snapshotMetrics(),
    endpoints: {
      health: '/api/health',
      rooms: '/api/rooms',
      characters: '/api/characters',
      voice: '/api/voice',
      bot: '/api/bot',
    },
  });
});

router.get('/characters', (_req: Request, res: Response) => {
  res.status(200).json({
    characters: [
      { id: 'DEALER', name: 'The Dealer', description: 'Professional and neutral', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
      { id: 'BULL', name: 'Bull Runner', description: 'Optimistic trader', voiceId: '21m00Tcm4TlvDq8ikWAM' },
      { id: 'BEAR', name: 'Bear Necessities', description: 'Pessimistic analyst', voiceId: 'AZnzlk1XvdvUeBnXmlld' },
      { id: 'WHALE', name: 'The Whale', description: 'Big player', voiceId: 'pNInz6obpgDQGcFmaJgB' },
      { id: 'ROOKIE', name: 'Fresh Trader', description: 'Enthusiastic beginner', voiceId: 'yoZ06aMxZJJ28mfd3POQ' },
    ],
  });
});

router.get('/rooms', async (_req: Request, res: Response) => {
  try {
    const rooms = await roomService.listRooms();
    res.status(200).json({ rooms });
  } catch (error) {
    res.status(500).json({ error: 'Unable to list rooms' });
  }
});

export default router;
