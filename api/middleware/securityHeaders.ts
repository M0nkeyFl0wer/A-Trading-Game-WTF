import helmet from 'helmet';
import cors from 'cors';
import { Request, Response, NextFunction } from 'express';

/**
 * Security headers middleware for CORS, CSP, and other protections
 */

// CORS configuration
export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.NODE_ENV === 'production'
      ? [
          'https://trading-game.vercel.app',
          'https://www.trading-game.com',
          'https://a-trading-game-wtf.vercel.app'
        ]
      : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://127.0.0.1:3000',
          'http://127.0.0.1:3001'
        ];

    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
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
    reportUri: process.env.CSP_REPORT_URI || undefined
  }
};

// Helmet configuration for comprehensive security headers
export const helmetConfig = {
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? cspConfig : false,
  crossOriginEmbedderPolicy: false, // May need to be false for some external resources
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  dnsPrefetchControl: { allow: false },
  expectCt: {
    maxAge: 86400,
    enforce: true
  },
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
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
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
