import './lib/loadEnv';  // MUST stay first: fills process.env from api/.env before other modules read it

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { applyRateLimiting } from './middleware/rateLimiting';
import { applySecurityHeaders, handlePreflight, corsOptions, allowedOrigins } from './middleware/securityHeaders';
import { authenticateRequest, attachOptionalUser } from './middleware/authenticate';
import { getAuthInstance } from './lib/firebaseAdmin';
import { roomEvents } from './lib/roomEvents';
import { sanitizeRoomForPlayer } from './lib/sanitize';
import { logger } from './lib/logger';
import { metrics } from './lib/metrics';
import { getDatabase, closeDatabase, DB_PATH } from './services/database';
import { DATA_DIR } from './lib/dataDir';
import { KEY_DIR } from './lib/signing';
import { botService } from './services/botService';
import { commentatorService } from './services/commentatorService';
import { auditService } from './services/auditService';
import './services/kgOrderListener';  // auto-subscribes to game events for KG phase summaries

import rootRoutes from './routes/index';
import authRoutes from './routes/auth';
import tradingRoutes from './routes/trading';
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

// Socket.IO reuses the exact CORS options Express uses, so the allowlist lives
// in ONE place (middleware/securityHeaders.ts, fed by ALLOWED_ORIGINS). The old
// second hard-coded list here had already drifted from the HTTP one (issue #9).
const io = new SocketIOServer(server, {
  cors: corsOptions,
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
// NOTE: there is deliberately NO `app.use('/api/bot', ...)` mount here (issue #3).
// api/routes/bot.ts + packages/bot/src/sandbox ran USER-SUPPLIED code in Node's
// `vm` module behind a regex blocklist. `vm` is documented as not a security
// boundary and the escape was reproduced: a "bot" reached
// `process.mainModule.require('child_process')` via the constructor chain and ran
// `id` on the host. The files stay in the tree as reference for a future
// out-of-process design (isolated-vm / a network- and FS-denied container), but
// they must not be mounted again. Server-side personality bots
// (services/botService.ts) never run user code and are unaffected.
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
    // createdAt lets the lobby keep a stable sort order; without it the client
    // falls back to Date.now() and re-orders the list on every event (#12).
    createdAt: room.createdAt,
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

app.use((err: Error & { status?: number; statusCode?: number }, req: Request, res: Response, next: NextFunction) => {
  // Honour an explicit HTTP status on the error (CorsOriginError sets 403,
  // body-parser sets 400/413, ...). Those are CLIENT errors: log at warn
  // without a stack trace, and answer with the real status instead of 500.
  // Anything without a status is a genuine bug -> 500 + full error log.
  const status = err.status ?? err.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    logger.warn({ status, path: req.path, message: err.message }, 'request rejected');
    res.status(status).json({
      error: status === 403 ? 'Forbidden' : 'Bad Request',
      message: err.message,
      timestamp: new Date().toISOString(),
      requestId: res.getHeader('X-Request-ID')
    });
    return;
  }

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

/**
 * Bind the HTTP server and initialise the SQLite database.
 *
 * Exported so callers (tests, scripts) can decide WHEN to listen instead of
 * the module doing it as a side effect of being imported. Resolves once the
 * server is accepting connections. PORT=0 asks the OS for any free port,
 * which is what the test setup uses to avoid clashing with a dev server.
 *
 * The database is opened BEFORE we bind. Fail fast: if the native
 * better-sqlite3 binding is missing (e.g. pnpm skipped its build script) or
 * the data dir is unwritable, every later request would throw anyway.
 * Swallowing the error here used to leave a half-alive server that 500'd on
 * everything, which is far harder to diagnose than a crash at boot.
 */
export function start(port: number | string = PORT, host: string = HOST): Promise<typeof server> {
  try {
    getDatabase();
  } catch (err) {
    logger.fatal({ err }, 'Failed to initialize SQLite database — refusing to start');
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Binding to `host` (default 0.0.0.0) is what lets HOST=127.0.0.1 keep the
    // API loopback-only behind Caddy; the old code ignored HOST entirely.
    server.listen(Number(port), host, () => {
      server.off('error', reject);
      logger.info({ host, port: (server.address() as any)?.port ?? port, environment: process.env.NODE_ENV || 'development' }, 'Server is running');
      // Log where on-disk state actually lives (issue #15): under tsx this is
      // api/data, under a compiled dist it would be api/dist/data -- which is
      // how a keypair silently rotated between the two. DATA_DIR pins it.
      logger.info({ dataDir: DATA_DIR, dbPath: DB_PATH, keyDir: KEY_DIR, allowedOrigins }, 'Resolved paths and CORS allowlist');
      resolve(server);
    });
  });
}

// Normal runs (tsx / node) still start listening on import, exactly as
// before. Under vitest (which sets VITEST=true) the module stays passive so
// supertest can drive `app` in-process and nothing ever binds port 3001 or
// touches the real database. See api/tests/setup.ts.
if (!process.env.VITEST) {
  start().catch((err) => {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  });
}

export { app, server, io };
