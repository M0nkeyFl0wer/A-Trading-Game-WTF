import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Rate limiting middleware to prevent abuse and DDoS attacks
 */

// Store for tracking requests (can be replaced with Redis in production)
const requestCounts = new Map<string, { count: number; resetTime: number }>();

// Custom key generator to handle both IP and user-based limiting
const keyGenerator = (req: Request): string => {
  // Use authenticated user ID if available, otherwise fall back to IP
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  return `ip:${req.ip}`;
};

// Skip successful requests for certain endpoints
const skipSuccessfulRequests = (req: Request, res: Response): boolean => {
  // Don't count successful requests for static assets
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico)$/)) {
    return res.statusCode < 400;
  }
  return false;
};

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP/user to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 15
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  keyGenerator,
  skipSuccessfulRequests,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please try again later.',
      retryAfter: res.getHeader('Retry-After')
    });
  }
});

// Strict rate limiter for authentication endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts from this IP, please try again later.',
    retryAfter: 15
  },
  skipFailedRequests: false, // Count failed requests
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Always use IP for auth endpoints
    return `auth:${req.ip}`;
  }
});

// Trading endpoint rate limiter
export const tradingLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // Limit each user to 20 trades per minute
  message: {
    error: 'Trading rate limit exceeded. Please slow down.',
    retryAfter: 1
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Use user ID for trading endpoints
    if (req.user && req.user.id) {
      return `trade:${req.user.id}`;
    }
    return `trade:${req.ip}`;
  }
});

// Bot submission rate limiter
export const botLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each user to 10 bot submissions per minute
  message: {
    error: 'Bot submission rate limit exceeded.',
    retryAfter: 1
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    if (req.user && req.user.id) {
      return `bot:${req.user.id}`;
    }
    return `bot:${req.ip}`;
  }
});

// WebSocket connection rate limiter
export const wsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 WebSocket connections per minute
  message: {
    error: 'Too many WebSocket connection attempts.',
    retryAfter: 1
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    return `ws:${req.ip}`;
  }
});

// Account creation rate limiter
export const accountCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 account creations per hour
  message: {
    error: 'Too many accounts created from this IP. Please try again later.',
    retryAfter: 60
  },
  skipFailedRequests: true, // Don't count failed creation attempts
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    return `signup:${req.ip}`;
  }
});

// Password reset rate limiter
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Limit each IP to 3 password reset requests per hour
  message: {
    error: 'Too many password reset attempts. Please try again later.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Use both IP and email if available
    const email = req.body?.email || '';
    return `reset:${req.ip}:${email}`;
  }
});

// Dynamic rate limiter that adjusts based on server load
export class DynamicRateLimiter {
  private baseLimit: number = 100;
  private currentLoad: number = 0;

  updateLoad(cpuUsage: number, memoryUsage: number): void {
    // Adjust rate limit based on server load
    this.currentLoad = (cpuUsage + memoryUsage) / 2;
  }

  getLimit(): number {
    // Reduce allowed requests when server is under load
    if (this.currentLoad > 80) {
      return Math.floor(this.baseLimit * 0.5);
    } else if (this.currentLoad > 60) {
      return Math.floor(this.baseLimit * 0.75);
    }
    return this.baseLimit;
  }

  middleware() {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: (req: Request, res: Response): number => {
        return this.getLimit();
      },
      standardHeaders: true,
      legacyHeaders: false
    });
  }
}

// Distributed rate limiter for multiple instances (requires Redis)
export const createDistributedLimiter = (redisClient: any) => {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: new (require('rate-limit-redis'))({
      client: redisClient,
      prefix: 'rl:',
    }),
  });
};

// IP-based blocking for suspicious activity
export class IPBlocker {
  private blockedIPs: Set<string> = new Set();
  private suspiciousActivity: Map<string, number> = new Map();

  blockIP(ip: string, duration: number = 3600000): void {
    this.blockedIPs.add(ip);
    setTimeout(() => {
      this.blockedIPs.delete(ip);
    }, duration);
  }

  isBlocked(ip: string): boolean {
    return this.blockedIPs.has(ip);
  }

  reportSuspiciousActivity(ip: string): void {
    const count = (this.suspiciousActivity.get(ip) || 0) + 1;
    this.suspiciousActivity.set(ip, count);

    // Auto-block after 10 suspicious activities
    if (count >= 10) {
      this.blockIP(ip, 24 * 60 * 60 * 1000); // Block for 24 hours
      this.suspiciousActivity.delete(ip);
    }
  }

  middleware() {
    return (req: Request, res: Response, next: Function) => {
      if (this.isBlocked(req.ip)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Your IP has been temporarily blocked due to suspicious activity.'
        });
      }
      next();
    };
  }
}

// Export a global IP blocker instance
export const ipBlocker = new IPBlocker();

// Combined middleware for easy application
export const applyRateLimiting = (app: any) => {
  // Apply IP blocker first
  app.use(ipBlocker.middleware());

  // Apply general rate limiting to all routes
  app.use('/api/', apiLimiter);

  // Apply specific limiters to sensitive endpoints
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/signup', accountCreationLimiter);
  app.use('/api/auth/reset', passwordResetLimiter);
  app.use('/api/trading/', tradingLimiter);
  app.use('/api/bot/', botLimiter);
  app.use('/ws/', wsLimiter);
};

export default {
  apiLimiter,
  authLimiter,
  tradingLimiter,
  botLimiter,
  wsLimiter,
  accountCreationLimiter,
  passwordResetLimiter,
  ipBlocker,
  applyRateLimiting
};