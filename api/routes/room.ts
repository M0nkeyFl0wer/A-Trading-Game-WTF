import { Router, Request, Response } from 'express';
import { validateInput, validationSchemas } from '../../apps/web/src/lib/security';

const router = Router();

/**
 * Game room routes
 */

// Get all rooms
router.get('/', async (req: Request, res: Response) => {
  // Public endpoint - anyone can see available rooms
  // TODO: Get actual rooms from Firebase
  return res.status(200).json({
    rooms: [
      {
        id: 'room1',
        name: 'High Stakes Table',
        players: 2,
        maxPlayers: 8,
        status: 'waiting'
      },
      {
        id: 'room2',
        name: 'Beginner Friendly',
        players: 4,
        maxPlayers: 8,
        status: 'playing'
      }
    ]
  });
});

// Create a new room
router.post('/create', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required to create room'
    });
  }

  const { name, maxPlayers } = req.body;

  // Validate room name
  if (!name || name.length < 3 || name.length > 50) {
    return res.status(400).json({
      error: 'Invalid room name',
      message: 'Room name must be between 3 and 50 characters'
    });
  }

  // Validate max players
  if (!maxPlayers || maxPlayers < 2 || maxPlayers > 8) {
    return res.status(400).json({
      error: 'Invalid player count',
      message: 'Max players must be between 2 and 8'
    });
  }

  // TODO: Create room in Firebase
  const roomId = `room_${Date.now()}`;

  return res.status(201).json({
    success: true,
    room: {
      id: roomId,
      name,
      host: req.user.id,
      players: [req.user.id],
      maxPlayers,
      status: 'waiting',
      createdAt: Date.now()
    }
  });
});

// Join a room
router.post('/join/:roomId', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required to join room'
    });
  }

  const { roomId } = req.params;

  // Validate room code
  const roomCodeValidation = validateInput(roomId, validationSchemas.roomCode);
  if (!roomCodeValidation.isValid && roomId.length !== 6) {
    return res.status(400).json({
      error: 'Invalid room code',
      message: 'Room code must be 6 characters'
    });
  }

  // TODO: Check if room exists and has space
  // TODO: Add player to room in Firebase

  return res.status(200).json({
    success: true,
    message: 'Joined room successfully',
    roomId
  });
});

// Leave a room
router.post('/leave/:roomId', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  const { roomId } = req.params;

  // TODO: Remove player from room in Firebase

  return res.status(200).json({
    success: true,
    message: 'Left room successfully'
  });
});

// Get room details
router.get('/:roomId', async (req: Request, res: Response) => {
  const { roomId } = req.params;

  // TODO: Get room details from Firebase

  return res.status(200).json({
    id: roomId,
    name: 'Test Room',
    players: [],
    maxPlayers: 8,
    status: 'waiting',
    gameState: null
  });
});

// Start game in room
router.post('/:roomId/start', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  const { roomId } = req.params;

  // TODO: Verify user is room host
  // TODO: Start game in Firebase

  return res.status(200).json({
    success: true,
    message: 'Game started',
    roomId
  });
});

// Get available characters
router.get('/characters', async (req: Request, res: Response) => {
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