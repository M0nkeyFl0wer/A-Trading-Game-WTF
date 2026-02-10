import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { applyRateLimiting } from './middleware/rateLimiting';
import { applySecurityHeaders, handlePreflight } from './middleware/securityHeaders';
import { authenticateRequest, attachOptionalUser } from './middleware/authenticate';
import { getAuthInstance } from './lib/firebaseAdmin';
import { roomEvents } from './lib/roomEvents';
import { logger } from './lib/logger';
import { metrics } from './lib/metrics';

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
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
    metrics: metrics.snapshotMetrics(),
  });
});

app.use('/api', rootRoutes);
app.use('/api/auth', attachOptionalUser, authRoutes);
app.use('/api/trading', authenticateRequest, tradingRoutes);
app.use('/api/bot', authenticateRequest, botRoutes);
app.use('/api/room', authenticateRequest, roomRoutes);
app.use('/api/user', authenticateRequest, userRoutes);
app.use('/api/voice', authenticateRequest, voiceRoutes);

// Simple per-socket rate limiter for events
const socketEventCounters = new Map<string, { count: number; resetAt: number }>();
const SOCKET_RATE_LIMIT = 30; // max events per window
const SOCKET_RATE_WINDOW_MS = 10_000; // 10 seconds

function checkSocketRate(socketId: string): boolean {
  const now = Date.now();
  let entry = socketEventCounters.get(socketId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + SOCKET_RATE_WINDOW_MS };
    socketEventCounters.set(socketId, entry);
  }
  entry.count++;
  return entry.count <= SOCKET_RATE_LIMIT;
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const auth = getAuthInstance();

    if (!auth) {
      if (process.env.AUTH_DEV_BYPASS === 'true' && process.env.NODE_ENV !== 'production') {
        socket.data.user = { id: 'dev-user' };
        return next();
      }
      return next(new Error('Authentication unavailable'));
    }

    if (!token || typeof token !== 'string') {
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
  logger.info({ socketId: socket.id, userId: socket.data.user?.id }, 'socket connected');

  socket.on('join-room', (roomId: string) => {
    if (typeof roomId !== 'string' || roomId.length > 64) return;
    socket.join(roomId);
    logger.info({ socketId: socket.id, roomId }, 'socket joined room');
  });

  socket.on('leave-room', (roomId: string) => {
    if (typeof roomId !== 'string') return;
    socket.leave(roomId);
    logger.info({ socketId: socket.id, roomId }, 'socket left room');
  });

  // Route trade events through roomService instead of broadcasting raw data
  socket.on('trade', async (data) => {
    if (!checkSocketRate(socket.id)) return;
    const roomId = typeof data?.roomId === 'string' ? data.roomId : null;
    const userId = socket.data.user?.id;
    if (!roomId || !userId) return;

    try {
      const price = Number(data.price);
      const quantity = Math.max(1, Math.floor(Number(data.quantity) || 1));
      const side = data.side === 'sell' ? 'sell' : 'buy';

      if (!Number.isFinite(price) || price <= 0) return;

      const { roomService } = await import('./services/roomService');
      await roomService.submitTrade(roomId, userId, { price, quantity, side });
      // roomService emits 'room:updated' which broadcasts via roomEvents below
    } catch (err) {
      logger.warn({ err, socketId: socket.id, roomId }, 'socket trade rejected');
    }
  });

  socket.on('message', (data) => {
    if (!checkSocketRate(socket.id)) return;
    const roomId = typeof data?.roomId === 'string' ? data.roomId : null;
    if (!roomId) return;
    const text = typeof data?.text === 'string' ? data.text.slice(0, 500) : '';
    io.to(roomId).emit('new-message', {
      userId: socket.data.user?.id,
      text,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    socketEventCounters.delete(socket.id);
    logger.info({ socketId: socket.id }, 'socket disconnected');
  });
});

roomEvents.on('room:updated', (room) => {
  io.emit('rooms:update', room);
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
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.warn('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, () => {
  logger.info({ host: HOST, port: PORT, environment: process.env.NODE_ENV || 'development' }, 'Server is running');
});

export { app, server, io };
