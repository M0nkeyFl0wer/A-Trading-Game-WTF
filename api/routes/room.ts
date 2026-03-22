import { Router, Request, Response } from 'express';
import { sanitizeInput } from '@trading-game/shared';
import { roomService, RoomServiceError } from '../services/roomService';

const router: Router = Router();

const parseRoomName = (value: unknown): string => {
  const sanitized = sanitizeInput(String(value ?? '')).trim();
  if (sanitized.length < 3 || sanitized.length > 50) {
    throw new RoomServiceError(400, 'Room name must be between 3 and 50 characters');
  }
  return sanitized;
};

const parseMaxPlayers = (value: unknown): number => {
  const num = Number(value ?? 5);
  if (!Number.isInteger(num) || num < 2 || num > 8) {
    throw new RoomServiceError(400, 'Max players must be between 2 and 8');
  }
  return num;
};

const parseOrderPayload = (body: any) => {
  const price = Number(body?.price);
  const quantity = Number(body?.quantity ?? 1);
  const side = body?.side;

  if (!Number.isFinite(price) || price <= 0) {
    throw new RoomServiceError(400, 'Price must be greater than zero');
  }
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new RoomServiceError(400, 'Quantity must be a positive integer');
  }
  if (side !== 'bid' && side !== 'ask') {
    throw new RoomServiceError(400, 'Side must be "bid" or "ask"');
  }

  return { price, quantity, side: side as 'bid' | 'ask' };
};

const normalizeRoomId = (value: string | string[] | undefined): string => {
  const id = Array.isArray(value) ? value[0] : value;
  return sanitizeInput(id ?? '').trim();
};

const getDisplayName = (req: Request): string => {
  const provided = typeof req.body?.displayName === 'string' ? req.body.displayName : undefined;
  if (provided) {
    return sanitizeInput(provided).slice(0, 32) || 'Trader';
  }
  return req.user?.email?.split('@')[0] || 'Trader';
};

const handleRoomError = (error: unknown, res: Response) => {
  if (error instanceof RoomServiceError) {
    return res.status(error.status).json({
      error: error.message,
    });
  }
  console.error('Room route error:', error);
  return res.status(500).json({
    error: 'Room operation failed',
  });
};

// Public list of rooms
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rooms = await roomService.listRooms();
    return res.status(200).json({ rooms });
  } catch (error) {
    return handleRoomError(error, res);
  }
});

// Create a new room (auth required via middleware)
router.post('/create', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const name = parseRoomName(req.body?.name);
    const maxPlayers = parseMaxPlayers(req.body?.maxPlayers);
    const hostName = getDisplayName(req);
    const room = await roomService.createRoom(name, maxPlayers, req.user.id, hostName);
    return res.status(201).json({ success: true, room });
  } catch (error) {
    return handleRoomError(error, res);
  }
});

// Join a room
router.post('/join/:roomId', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }
  try {
    const room = await roomService.joinRoom(roomId, {
      id: req.user.id,
      name: getDisplayName(req),
    });
    return res.status(200).json({ success: true, room });
  } catch (error) {
    return handleRoomError(error, res);
  }
});

// Leave a room
router.post('/leave/:roomId', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }
  try {
    const room = await roomService.leaveRoom(roomId, req.user.id);
    return res.status(200).json({ success: true, room });
  } catch (error) {
    return handleRoomError(error, res);
  }
});

// Submit order to order book
router.post('/:roomId/order', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }
  try {
    const order = parseOrderPayload(req.body);
    const room = await roomService.submitOrder(roomId, req.user.id, order);
    return res.status(200).json({ success: true, room });
  } catch (error) {
    return handleRoomError(error, res);
  }
});

// Cancel an order
router.delete('/:roomId/order/:orderId', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const roomId = normalizeRoomId(req.params.roomId);
  const orderId = normalizeRoomId(req.params.orderId);
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }
  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }
  try {
    const room = await roomService.cancelOrder(roomId, req.user.id, orderId);
    return res.status(200).json({ success: true, room });
  } catch (error) {
    return handleRoomError(error, res);
  }
});

// Legacy trade endpoint (deprecated -- use POST /:roomId/order instead)
router.post('/:roomId/trade', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  // Map old trade payload to new order format
  try {
    const price = Number(req.body?.price);
    const quantity = Number(req.body?.quantity ?? 1);
    const oldSide = req.body?.side;
    const side: 'bid' | 'ask' = oldSide === 'sell' ? 'ask' : 'bid';

    if (!Number.isFinite(price) || price <= 0) {
      throw new RoomServiceError(400, 'Price must be greater than zero');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new RoomServiceError(400, 'Quantity must be greater than zero');
    }

    const room = await roomService.submitOrder(roomId, req.user.id, {
      price,
      quantity: Math.round(quantity),
      side,
    });

    res.setHeader('X-Deprecated', 'Use POST /:roomId/order instead');
    return res.status(200).json({ success: true, room });
  } catch (error) {
    return handleRoomError(error, res);
  }
});

// Get room details
router.get('/:roomId', async (req: Request, res: Response) => {
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }
  try {
    const room = await roomService.getRoom(roomId);
    return res.status(200).json(room);
  } catch (error) {
    return handleRoomError(error, res);
  }
});

// Start game in room
router.post('/:roomId/start', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const roomId = normalizeRoomId(req.params.roomId);
  if (!roomId) {
    return res.status(400).json({ error: 'Room ID is required' });
  }
  try {
    const room = await roomService.startRoom(roomId, req.user.id);
    return res.status(200).json({ success: true, room });
  } catch (error) {
    return handleRoomError(error, res);
  }
});

// Get available characters (static)
router.get('/characters', async (_req: Request, res: Response) => {
  return res.status(200).json({
    characters: [
      {
        id: 'DEALER',
        name: 'The Dealer',
        description: 'Professional and neutral',
        voiceId: 'EXAVITQu4vr4xnSDxMaL'
      },
      {
        id: 'BULL',
        name: 'Bull Runner',
        description: 'Optimistic trader',
        voiceId: '21m00Tcm4TlvDq8ikWAM'
      },
      {
        id: 'BEAR',
        name: 'Bear Necessities',
        description: 'Pessimistic analyst',
        voiceId: 'AZnzlk1XvdvUeBnXmlld'
      },
      {
        id: 'WHALE',
        name: 'The Whale',
        description: 'Big player',
        voiceId: 'pNInz6obpgDQGcFmaJgB'
      },
      {
        id: 'ROOKIE',
        name: 'Fresh Trader',
        description: 'Enthusiastic beginner',
        voiceId: 'yoZ06aMxZJJ28mfd3POQ'
      }
    ]
  });
});

export default router;
