import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { applyRateLimiting } from './middleware/rateLimiting';
import { applySecurityHeaders, handlePreflight } from './middleware/securityHeaders';

/**
 * Secure Express server with all security middleware applied
 */

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
      };
      session?: {
        id: string;
      };
    }
  }
}

// Create Express app
const app: Express = express();
const server = createServer(app);

// Create Socket.io server with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? ['https://trading-game.vercel.app', 'https://a-trading-game-wtf.vercel.app']
      : ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Trust proxy (required for proper IP detection behind reverse proxies)
app.set('trust proxy', 1);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply security headers (Helmet, CORS, CSP, etc.)
applySecurityHeaders(app);

// Handle CORS preflight requests
app.use(handlePreflight);

// Apply rate limiting
applyRateLimiting(app);

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
    );
  });

  next();
});

// Health check endpoint (no authentication required)
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
import authRoutes from './routes/auth';
import tradingRoutes from './routes/trading';
import botRoutes from './routes/bot';
import roomRoutes from './routes/room';
import userRoutes from './routes/user';

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/room', roomRoutes);
app.use('/api/user', userRoutes);

// WebSocket authentication
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    // Verify token (implement your token verification logic)
    // const user = await verifyToken(token);
    // socket.data.user = user;

    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

// WebSocket event handlers
io.on('connection', (socket) => {
  console.log('New WebSocket connection:', socket.id);

  // Join room
  socket.on('join-room', (roomId: string) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);
  });

  // Leave room
  socket.on('leave-room', (roomId: string) => {
    socket.leave(roomId);
    console.log(`Socket ${socket.id} left room ${roomId}`);
  });

  // Handle trading events
  socket.on('trade', (data) => {
    // Validate and process trade
    const roomId = data.roomId;
    if (roomId) {
      // Broadcast to room
      io.to(roomId).emit('trade-update', data);
    }
  });

  // Handle chat messages
  socket.on('message', (data) => {
    const roomId = data.roomId;
    if (roomId) {
      io.to(roomId).emit('new-message', {
        ...data,
        timestamp: Date.now()
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);

  // Don't leak error details in production
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

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, () => {
  console.log(`
    🚀 Server is running!
    🔒 Security middleware: ✅
    🚦 Rate limiting: ✅
    🛡️ CORS protection: ✅
    🔐 CSP headers: ✅

    Environment: ${process.env.NODE_ENV || 'development'}
    Server: http://${HOST}:${PORT}
    Health: http://${HOST}:${PORT}/api/health
  `);
});

export { app, server, io };