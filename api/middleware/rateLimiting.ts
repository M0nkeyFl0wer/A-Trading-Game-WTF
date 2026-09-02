import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request, Response } from 'express';

/**
 * Rate limiting middleware to prevent abuse and DDoS attacks
 */

// Store for tracking requests (can be replaced with Redis in production)
const requestCounts = new Map<string, { count: number; resetTime: number }>();

/**
 * Resolve the *real* client IP for rate-limit keying.
 *
 * Production topology is: browser -> Cloudflare (cloudflared tunnel) -> Caddy -> Node.
 * With `app.set('trust proxy', 1)` Express only trusts ONE hop, so `req.ip` becomes
 * the address Caddy appended to X-Forwarded-For -- i.e. the cloudflared connector,
 * which is the SAME address for every friend. Everyone then shares one bucket and
 * four idle lobby tabs exhaust the 15-minute window for the whole group (issue #13).
 *
 * Cloudflare sets `CF-Connecting-IP` to the true client address on every request it
 * proxies, so we prefer that header. We validate the value looks like an IP before
 * trusting it, because a client hitting the origin *directly* (bypassing Cloudflare)
 * could forge the header to hop between buckets; a non-IP string is ignored and we
 * fall back to `req.ip`. Either way the result goes through `ipKeyGenerator`, which
 * normalises IPv6 (collapses a /56 so one user can't rotate through 2^72 addresses)
 * and folds IPv4-mapped IPv6 (`::ffff:1.2.3.4`) into plain IPv4 -- the bypass that
 * the express-rate-limit / ip-address advisory was about.
 *
 * Note: if the origin is ever exposed without Cloudflare in front, a spoofed
 * CF-Connecting-IP still lets an attacker pick their own bucket. The durable fix is
 * to only accept the header from Cloudflare's IP ranges (or `trust proxy 2` and drop
 * this header entirely). Good enough for the friend test behind the tunnel.
 */
// Loose IPv4 / IPv6 shape check -- enough to reject junk like "user:abc" or a
// CIDR list, not a full RFC parser (ipKeyGenerator re-parses it properly anyway).
const IP_SHAPE = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-fA-F:]+(:\d{1,3}(\.\d{1,3}){3})?)$/;

export const getClientIp = (req: Request): string => {
  const cfIp = req.get('CF-Connecting-IP')?.trim();
  if (cfIp && IP_SHAPE.test(cfIp)) {
    return cfIp;
  }
  // `req.ip` is undefined for a socket that already closed; use a stable sentinel
  // so those requests still share a bucket instead of throwing inside the limiter.
  return req.ip ?? 'unknown';
};

// Custom key generator to handle both IP and user-based limiting
const keyGenerator = (req: Request): string => {
  // Use authenticated user ID if available, otherwise fall back to IP.
  // (apiLimiter runs before auth in server.ts so this branch only fires for
  // limiters mounted after `authenticateRequest`, e.g. tradingLimiter on the
  // order routes -- there each *user* gets their own bucket regardless of IP.)
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  return `ip:${ipKeyGenerator(getClientIp(req))}`;
};

// Skip successful requests for certain endpoints
const shouldSkipRequest = (req: Request, res: Response): boolean => {
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico)$/)) {
    return res.statusCode < 400;
  }
  return false;
};

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // 600 per 15 min (was 100). Each lobby tab polls ~30x per window, so 100 left
  // headroom for only ~3 tabs before every order/join/voice call started 429ing.
  // 600 = ~40 req/min per real client; still tight enough to blunt a naive flood.
  max: 600,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 15
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  keyGenerator,
  skip: shouldSkipRequest,
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
    return `auth:${ipKeyGenerator(getClientIp(req))}`;
  }
});

// Trading endpoint rate limiter.
// Mounted globally on `/api/trading/` (below) AND at route level on the order
// endpoints in routes/room.ts (POST /:roomId/order, DELETE /:roomId/order/:orderId),
// where it runs *after* authenticateRequest so the key is the user id, not the IP.
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
    return `trade:${ipKeyGenerator(getClientIp(req))}`;
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
    return `bot:${ipKeyGenerator(getClientIp(req))}`;
  }
});

// Voice synthesis proxy limiter
export const voiceLimiter = rateLimit({
  windowMs: 60 * 1000,
  // 60/min per user: a live round narrates the dealer plus up to five character
  // bots, each line a separate /speak call, so 15/min throttled real gameplay to
  // 429s (voice "did nothing").
  //
  // Note what caching does and does not buy here. Audio IS cached server-side by
  // (voice, style, text), so a repeated line costs one ElevenLabs call and then
  // serves from cache -- but this limiter is mounted app-level (see
  // applyRateLimiting below), ahead of the route, while the cache lookup lives
  // inside the handler. A cache hit therefore still consumes limiter quota:
  // caching cuts SPEND, not throttle pressure. If 60 proves too low under load,
  // skip the limiter on a cache hit rather than raising the ceiling again.
  //
  // Cache keys are per-character since the voices work landed, so one line in
  // five voices is five entries against a 100-entry / 5-minute LRU -- the
  // effective hit rate is lower than the key scheme suggests.
  max: 60,
  message: {
    error: 'Voice rate limit exceeded.',
    retryAfter: 1
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    if (req.user && req.user.id) {
      return `voice:${req.user.id}`;
    }
    return `voice:${ipKeyGenerator(getClientIp(req))}`;
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
    return `ws:${ipKeyGenerator(getClientIp(req))}`;
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
    return `signup:${ipKeyGenerator(getClientIp(req))}`;
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
    return `reset:${ipKeyGenerator(getClientIp(req))}:${email}`;
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
    this.blockedIPs.add(ipKeyGenerator(ip));
    setTimeout(() => {
      this.blockedIPs.delete(ipKeyGenerator(ip));
    }, duration);
  }

  isBlocked(ip: string): boolean {
    return this.blockedIPs.has(ipKeyGenerator(ip));
  }

  reportSuspiciousActivity(ip: string): void {
    const normalizedIp = ipKeyGenerator(ip);
    const count = (this.suspiciousActivity.get(normalizedIp) || 0) + 1;
    this.suspiciousActivity.set(normalizedIp, count);

    // Auto-block after 10 suspicious activities
    if (count >= 10) {
      this.blockIP(ip, 24 * 60 * 60 * 1000); // Block for 24 hours
      this.suspiciousActivity.delete(normalizedIp);
    }
  }

  middleware() {
    return (req: Request, res: Response, next: Function) => {
      if (this.isBlocked(ipKeyGenerator(getClientIp(req)))) {
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
  // '/api/bot/' is intentionally not mounted: the user-code bot route was
  // unmounted in server.ts (issue #3). botLimiter stays exported for a future
  // sandboxed re-introduction.
  app.use('/api/voice/', voiceLimiter);
  app.use('/ws/', wsLimiter);
};

export default {
  apiLimiter,
  authLimiter,
  tradingLimiter,
  botLimiter,
  voiceLimiter,
  wsLimiter,
  accountCreationLimiter,
  passwordResetLimiter,
  ipBlocker,
  applyRateLimiting
};
