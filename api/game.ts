// Vercel Serverless Function for Game API
import { VercelRequest, VercelResponse } from '@vercel/node';

interface GameSession {
  id: string;
  players: string[];
  state: 'waiting' | 'playing' | 'finished';
  gameData?: any;
}

// In production, this would use a database
const sessions = new Map<string, GameSession>();

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action } = req.query;

  switch (action) {
    case 'create':
      return createSession(req, res);
    case 'join':
      return joinSession(req, res);
    case 'leave':
      return leaveSession(req, res);
    case 'start':
      return startGame(req, res);
    case 'update':
      return updateGame(req, res);
    case 'list':
      return listSessions(req, res);
    default:
      res.status(400).json({ error: 'Invalid action' });
  }
}

function createSession(req: VercelRequest, res: VercelResponse) {
  const sessionId = Math.random().toString(36).substring(7);
  const { playerId } = req.body;

  const session: GameSession = {
    id: sessionId,
    players: [playerId],
    state: 'waiting',
  };

  sessions.set(sessionId, session);
  res.status(201).json({ sessionId, session });
}

function joinSession(req: VercelRequest, res: VercelResponse) {
  const { sessionId, playerId } = req.body;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (session.players.length >= 5) {
    res.status(400).json({ error: 'Session is full' });
    return;
  }

  if (!session.players.includes(playerId)) {
    session.players.push(playerId);
  }

  res.status(200).json({ session });
}

function leaveSession(req: VercelRequest, res: VercelResponse) {
  const { sessionId, playerId } = req.body;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  session.players = session.players.filter(p => p !== playerId);

  if (session.players.length === 0) {
    sessions.delete(sessionId);
    res.status(200).json({ message: 'Session deleted' });
  } else {
    res.status(200).json({ session });
  }
}

function startGame(req: VercelRequest, res: VercelResponse) {
  const { sessionId } = req.body;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (session.players.length < 2) {
    res.status(400).json({ error: 'Not enough players' });
    return;
  }

  session.state = 'playing';
  session.gameData = {
    round: 1,
    currentPlayer: 0,
    deck: generateDeck(),
    trades: [],
  };

  res.status(200).json({ session });
}

function updateGame(req: VercelRequest, res: VercelResponse) {
  const { sessionId, gameData } = req.body;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  session.gameData = gameData;
  res.status(200).json({ session });
}

function listSessions(req: VercelRequest, res: VercelResponse) {
  const availableSessions = Array.from(sessions.values())
    .filter(s => s.state === 'waiting')
    .map(s => ({
      id: s.id,
      players: s.players.length,
      maxPlayers: 5,
    }));

  res.status(200).json({ sessions: availableSessions });
}

function generateDeck() {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, -10];
  return values.sort(() => Math.random() - 0.5);
}