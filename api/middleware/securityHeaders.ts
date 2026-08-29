import helmet from 'helmet';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';

/**
 * Security headers middleware for CORS, CSP, and other protections
 */

// ---------------------------------------------------------------------------
// CORS allowlist (issue #9)
// ---------------------------------------------------------------------------
//
// ONE list, built once at import time, shared by Express `cors()` AND the
// Socket.IO server (server.ts passes the same `corsOptions`). The old code kept
// two hard-coded copies (Vercel hosts / localhost) that had already drifted, and
// offered no env override -- so every browser POST from a tunnel hostname, LAN
// IP or Tailscale name failed.
//
// Sources, in order:
//   1. ALLOWED_ORIGINS  -- comma-separated, whitespace-trimmed, empty entries
//      dropped. This is the ONLY source in production.
//   2. Localhost dev defaults (Vite on 3000, API on 3001) -- appended only when
//      NODE_ENV !== 'production', so a bare `pnpm dev` keeps working.
//
// In production an EMPTY list is a configuration error, not a "deny all": the
// operator forgot to set ALLOWED_ORIGINS and every browser client would silently
// 403. We exit at boot instead, mirroring the AUTH_DEV_BYPASS guard in server.ts.
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
];

/** Parse ALLOWED_ORIGINS into a clean list (exported so tests can check it). */
export function parseAllowedOrigins(raw: string | undefined, nodeEnv: string | undefined): string[] {
  const fromEnv = (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return nodeEnv === 'production' ? fromEnv : [...fromEnv, ...DEV_ORIGINS];
}

export const allowedOrigins: string[] = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS,
  process.env.NODE_ENV,
);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.error('FATAL: ALLOWED_ORIGINS must list at least one browser origin in production (comma-separated)');
  process.exit(1);
}

/**
 * Error thrown for a disallowed Origin. Carries `status = 403` so the global
 * error handler in server.ts answers 403 Forbidden instead of the generic 500
 * (the cors package hands this error to `next(err)`, it does not respond itself).
 * We never call `callback(null, false)`: that only omits the ACAO header and the
 * request would still reach the route handler and mutate state.
 */
export class CorsOriginError extends Error {
  status = 403;
  constructor(origin: string) {
    super(`Origin ${origin} is not allowed by CORS`);
    this.name = 'CorsOriginError';
  }
}

// CORS configuration
export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // No Origin header = same-origin navigation, curl, server-to-server. Not a
    // cross-origin browser request, so there is nothing for CORS to gate.
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new CorsOriginError(origin));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-CSRF-Token'
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After'
  ],
  maxAge: 86400 // 24 hours
};

// Content Security Policy configuration
export const cspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-inline'", // Required for React
      "'unsafe-eval'", // Required for development (remove in production)
      'https://cdn.jsdelivr.net',
      'https://unpkg.com',
      'https://cdnjs.cloudflare.com'
    ],
    styleSrc: [
      "'self'",
      "'unsafe-inline'", // Required for styled-components
      'https://fonts.googleapis.com',
      'https://cdn.jsdelivr.net'
    ],
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
      'https:',
      'https://*.githubusercontent.com'
    ],
    fontSrc: [
      "'self'",
      'https://fonts.gstatic.com',
      'data:'
    ],
    connectSrc: [
      "'self'",
      'wss://*',
      'https://api.elevenlabs.io',
      'https://*.firebaseio.com',
      'https://*.firebaseapp.com',
      'https://*.googleapis.com',
      'https://identitytoolkit.googleapis.com'
    ],
    mediaSrc: [
      "'self'",
      'https://api.elevenlabs.io',
      'blob:'
    ],
    objectSrc: ["'none'"],
    frameSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? ([] as string[]) : undefined,
    // helmet 8 validates every directive value: `reportUri: undefined` is
    // rejected ("invalid directive value") and crashed every production boot
    // (issue #17). Only spread the key in when a report URI is configured.
    ...(process.env.CSP_REPORT_URI ? { reportUri: process.env.CSP_REPORT_URI } : {}),
  }
};

// Helmet configuration for comprehensive security headers
export const helmetConfig = {
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? cspConfig : false,
  crossOriginEmbedderPolicy: false, // May need to be false for some external resources
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  dnsPrefetchControl: { allow: false },
  // `expectCt` was removed in helmet 8 (Expect-CT is deprecated by browsers);
  // the key was silently ignored, so it is dropped rather than carried around.
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
};

// Custom security headers middleware
export const customSecurityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Additional security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  // Add request ID for tracking
  const requestId = req.headers['x-request-id'] ||
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', requestId);

  next();
};

// CSRF token generation and validation
export class CSRFProtection {
  private tokens: Map<string, { token: string; expires: number }> = new Map();

  generateToken(sessionId: string): string {
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = Date.now() + (60 * 60 * 1000); // 1 hour

    this.tokens.set(sessionId, { token, expires });

    // Clean up expired tokens
    this.cleanup();

    return token;
  }

  validateToken(sessionId: string, token: string): boolean {
    const stored = this.tokens.get(sessionId);

    if (!stored) {
      return false;
    }

    if (stored.expires < Date.now()) {
      this.tokens.delete(sessionId);
      return false;
    }

    return stored.token === token;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [sessionId, data] of this.tokens.entries()) {
      if (data.expires < now) {
        this.tokens.delete(sessionId);
      }
    }
  }

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Skip CSRF for safe methods
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
      }

      const sessionId = (req.session?.id ?? req.ip) as string;
      const headerToken = req.headers['x-csrf-token'];
      const normalizedHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken;
      let normalizedToken: string | undefined;

      if (typeof normalizedHeader === 'string') {
        normalizedToken = normalizedHeader;
      } else if (typeof req.body?._csrf === 'string') {
        normalizedToken = req.body._csrf;
      }

      if (!normalizedToken) {
        return res.status(403).json({
          error: 'Invalid or missing CSRF token'
        });
      }

      if (!this.validateToken(sessionId, normalizedToken as string)) {
        return res.status(403).json({
          error: 'Invalid or missing CSRF token'
        });
      }

      next();
    };
  }
}

// Export CSRF protection instance
export const csrfProtection = new CSRFProtection();

// Sanitize response data to prevent XSS in API responses
export const sanitizeResponse = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;

  res.json = function(data: any) {
    // Recursively sanitize strings in response
    const sanitize = (obj: any): any => {
      if (typeof obj === 'string') {
        // Basic HTML entity encoding
        return obj
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;')
          .replace(/\//g, '&#x2F;');
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitize);
      }
      if (typeof obj === 'object' && obj !== null) {
        const sanitized: any = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitize(value);
        }
        return sanitized;
      }
      return obj;
    };

    return originalJson.call(this, sanitize(data));
  };

  next();
};

// Clickjacking protection
export const clickjackingProtection = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Frame-Options', 'DENY');
  // Helmet already emits a full CSP in production (which includes
  // `frame-ancestors 'none'`). Unconditionally setting the header here used to
  // REPLACE that whole policy with this one directive -- surfaced by the #17
  // smoke once production could boot at all. Only add the header when nothing
  // else has set one (i.e. non-production, where helmet's CSP is off).
  if (!res.getHeader('Content-Security-Policy')) {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  }
  next();
};

// API key validation middleware
export const apiKeyValidation = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];

  // Skip for public endpoints
  const publicEndpoints = ['/api/health', '/api/status', '/api/docs'];
  if (publicEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
    return next();
  }

  // Validate API key for external API access
  if (req.headers['x-external-api'] === 'true') {
    if (!apiKey || apiKey !== process.env.EXTERNAL_API_KEY) {
      return res.status(401).json({
        error: 'Invalid or missing API key'
      });
    }
  }

  next();
};

// Apply all security middleware
export const applySecurityHeaders = (app: any) => {
  // Apply Helmet with comprehensive configuration
  app.use(helmet(helmetConfig as any));

  // Apply CORS
  app.use(cors(corsOptions));

  // Apply custom security headers
  app.use(customSecurityHeaders);

  // Apply clickjacking protection
  app.use(clickjackingProtection);

  // Apply response sanitization
  app.use(sanitizeResponse);

  // Apply API key validation
  app.use(apiKeyValidation);

  // Apply CSRF protection for state-changing requests
  // Note: Requires session middleware to be set up first
  // app.use(csrfProtection.middleware());
};

// Middleware to handle CORS preflight requests
export const handlePreflight = (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    const allowedHeaders = Array.isArray(corsOptions.allowedHeaders)
      ? corsOptions.allowedHeaders.join(', ')
      : (corsOptions.allowedHeaders ?? '');
    res.header('Access-Control-Allow-Headers', allowedHeaders);
    res.header('Access-Control-Max-Age', '86400');
    res.status(204).end();
  } else {
    next();
  }
};

export default {
  allowedOrigins,
  corsOptions,
  cspConfig,
  helmetConfig,
  customSecurityHeaders,
  csrfProtection,
  sanitizeResponse,
  clickjackingProtection,
  apiKeyValidation,
  applySecurityHeaders,
  handlePreflight
};
