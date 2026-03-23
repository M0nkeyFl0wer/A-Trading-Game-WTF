import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { applyRateLimiting } from './middleware/rateLimiting';
import { applySecurityHeaders, handlePreflight } from './middleware/securityHeaders';
import { authenticateRequest, attachOptionalUser } from './middleware/authenticate';
import { getAuthInstance } from './lib/firebaseAdmin';
import { roomEvents } from './lib/roomEvents';
import { sanitizeRoomForPlayer } from './lib/sanitize';
import { logger } from './lib/logger';
import { metrics } from './lib/metrics';
import { getDatabase, closeDatabase } from './services/database';
import { botService } from './services/botService';
import { commentatorService } from './services/commentatorService';
import { auditService } from './services/auditService';
import './services/kgOrderListener';  // auto-subscribes to game events for KG phase summaries

import rootRoutes from './routes/index';
import authRoutes from './routes/auth';
import tradingRoutes from './routes/trading';
import botRoutes from './routes/bot';
import roomRoutes from './routes/room';
import userRoutes from './routes/user';
import voiceRoutes from './routes/voice';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        name?: string;
      };
      session?: {
        id: string;
      };
    }
  }
}

// Prevent dev auth bypass from being enabled in production
if (process.env.NODE_ENV === 'production' && process.env.AUTH_DEV_BYPASS === 'true') {
  console.error('FATAL: AUTH_DEV_BYPASS cannot be enabled in production');
  process.exit(1);
}

const app: Express = express();
const server = createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://trading-game.vercel.app', 'https://a-trading-game-wtf.vercel.app']
      : ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Initialize audit service (subscribes to game events, restores hash chain)
auditService.init();

app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
applySecurityHeaders(app);
app.use(handlePreflight);
applyRateLimiting(app);

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.info({
      reqId: res.getHeader('X-Request-ID'),
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    }, 'request completed');
  });
  next();
});

app.get('/api/health', (req: Request, res: Response) => {
  // Only expose minimal info -- uptime, memory, and metrics leak server internals
  // that help attackers fingerprint and time attacks.
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api', rootRoutes);
app.use('/api/auth', attachOptionalUser, authRoutes);
app.use('/api/trading', authenticateRequest, tradingRoutes);
app.use('/api/bot', authenticateRequest, botRoutes);
app.use('/api/room', authenticateRequest, roomRoutes);
app.use('/api/user', authenticateRequest, userRoutes);
app.use('/api/voice', authenticateRequest, voiceRoutes);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const auth = getAuthInstance();

    if (!auth) {
      if (process.env.AUTH_DEV_BYPASS === 'true') {
        // Use auth.userId from handshake if provided, otherwise socket-unique ID
        const devId = typeof socket.handshake.auth?.userId === 'string'
          && /^[a-zA-Z0-9_-]{1,64}$/.test(socket.handshake.auth.userId)
          ? socket.handshake.auth.userId
          : `dev-${socket.id}`;
        socket.data.user = { id: devId, email: 'dev@example.com' };
        return next();
      }
      return next(new Error('Authentication unavailable'));
    }

    if (!token || typeof token !== 'string') {
      if (process.env.AUTH_DEV_BYPASS === 'true') {
        const devId = typeof socket.handshake.auth?.userId === 'string'
          && /^[a-zA-Z0-9_-]{1,64}$/.test(socket.handshake.auth.userId)
          ? socket.handshake.auth.userId
          : `dev-${socket.id}`;
        socket.data.user = { id: devId, email: 'dev@example.com' };
        return next();
      }
      return next(new Error('Authentication error: No token provided'));
    }

    const decoded = await auth.verifyIdToken(token);
    socket.data.user = {
      id: decoded.uid,
      email: decoded.email,
    };

    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'socket connected');

  socket.on('join-room', async (roomId: string) => {
    // Only allow joining if the user is actually a player in this room
    try {
      const { roomService } = require('./services/roomService');
      const room = await roomService.getRoom(roomId);
      const isPlayer = room.players.some((p: any) => p.id === socket.data.user?.id);
      if (!isPlayer) {
        socket.emit('error', { message: 'Not a player in this room' });
        return;
      }
      socket.join(roomId);
      logger.info({ socketId: socket.id, roomId }, 'socket joined room');
    } catch (err) {
      socket.emit('error', { message: 'Room not found' });
    }
  });

  socket.on('leave-room', (roomId: string) => {
    socket.leave(roomId);
    logger.info({ socketId: socket.id, roomId }, 'socket left room');
  });

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'socket disconnected');
  });
});

roomEvents.on('room:updated', (room: any) => {
  // Generate commentary for this state transition (before sanitizing)
  const commentary = commentatorService.generateCommentary(room);

  // Send sanitized state to each socket in the room
  const roomSockets = io.sockets.adapter.rooms.get(room.id);
  if (roomSockets) {
    for (const socketId of roomSockets) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        const playerId = socket.data.user?.id;
        const sanitized = sanitizeRoomForPlayer(room, playerId);
        // Attach commentary so clients can speak it
        if (commentary.length > 0) {
          sanitized.commentary = commentary;
        }
        socket.emit('rooms:update', sanitized);
      }
    }
  }

  // Also send a lobby-safe version to everyone (no game state, just room metadata)
  const lobbyView = {
    id: room.id,
    name: room.name,
    status: room.status,
    hostName: room.hostName,
    maxPlayers: room.maxPlayers,
    players: room.players?.map((p: any) => ({ id: p.id, name: p.name, character: p.character, isBot: p.isBot })),
    updatedAt: room.updatedAt,
    roundNumber: room.roundNumber,
  };
  io.emit('rooms:lobby-update', lobbyView);
});

roomEvents.on('room:removed', (payload) => {
  io.emit('rooms:removed', payload);
});

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    timestamp: new Date().toISOString()
  });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error({ err, path: req.path }, 'Unhandled error');
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message;

  res.status(500).json({
    error: 'Internal Server Error',
    message,
    timestamp: new Date().toISOString(),
    requestId: res.getHeader('X-Request-ID')
  });
});

process.on('SIGTERM', () => {
  logger.warn('SIGTERM signal received: closing HTTP server');
  botService.shutdown();
  closeDatabase();
  server.close(() => {
    closeDatabase();
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.warn('SIGINT signal received: closing HTTP server');
  botService.shutdown();
  closeDatabase();
  server.close(() => {
    closeDatabase();
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, () => {
  // Initialize SQLite database (creates tables if needed)
  try {
    getDatabase();
  } catch (err) {
    logger.error({ err }, 'Failed to initialize SQLite database');
  }

  logger.info({ host: HOST, port: PORT, environment: process.env.NODE_ENV || 'development' }, 'Server is running');
});

export { app, server, io };
