import DOMPurify from 'dompurify';
import Joi from 'joi';

/**
 * Security utilities for input validation and sanitization
 */

// Input sanitization for preventing XSS attacks
export const sanitizeInput = (input: string): string => {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });
};

// HTML sanitization for rich text content
export const sanitizeHTML = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br'],
    ALLOWED_ATTR: ['href', 'title', 'target'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
  });
};

// Validation schemas for common inputs
export const validationSchemas = {
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(30)
    .required()
    .messages({
      'string.alphanum': 'Username must contain only letters and numbers',
      'string.min': 'Username must be at least 3 characters',
      'string.max': 'Username cannot exceed 30 characters'
    }),

  email: Joi.string()
    .email({ tlds: { allow: false } })
    .required()
    .messages({
      'string.email': 'Please enter a valid email address'
    }),

  roomCode: Joi.string()
    .alphanum()
    .length(6)
    .required()
    .messages({
      'string.alphanum': 'Room code must contain only letters and numbers',
      'string.length': 'Room code must be exactly 6 characters'
    }),

  tradeAmount: Joi.number()
    .min(0.01)
    .max(1000000)
    .required()
    .messages({
      'number.min': 'Trade amount must be at least 0.01',
      'number.max': 'Trade amount cannot exceed 1,000,000'
    }),

  botCode: Joi.string()
    .max(10000)
    .required()
    .custom((value, helpers) => {
      // Check for dangerous patterns
      const dangerousPatterns = [
        /eval\s*\(/gi,
        /Function\s*\(/gi,
        /require\s*\(/gi,
        /import\s+/gi,
        /process\./gi,
        /child_process/gi,
        /fs\./gi,
        /__proto__/gi,
        /constructor\s*\[/gi
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(value)) {
          return helpers.error('string.dangerous');
        }
      }

      return value;
    })
    .messages({
      'string.dangerous': 'Bot code contains potentially dangerous patterns',
      'string.max': 'Bot code cannot exceed 10,000 characters'
    }),

  message: Joi.string()
    .min(1)
    .max(500)
    .required()
    .messages({
      'string.min': 'Message cannot be empty',
      'string.max': 'Message cannot exceed 500 characters'
    })
};

// Validate input against schema
export const validateInput = <T>(
  value: unknown,
  schema: Joi.Schema
): { isValid: boolean; data?: T; error?: string } => {
  const { error, value: validatedValue } = schema.validate(value);

  if (error) {
    return {
      isValid: false,
      error: error.details[0].message
    };
  }

  return {
    isValid: true,
    data: validatedValue as T
  };
};

// Rate limiting configuration
export const rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
};

// Per-endpoint rate limits
export const endpointLimits = {
  auth: {
    windowMs: 15 * 60 * 1000,
    max: 5, // 5 login attempts per 15 minutes
    message: 'Too many login attempts, please try again later.'
  },
  trading: {
    windowMs: 60 * 1000,
    max: 20, // 20 trades per minute
    message: 'Trading rate limit exceeded, please slow down.'
  },
  bot: {
    windowMs: 60 * 1000,
    max: 10, // 10 bot submissions per minute
    message: 'Bot submission rate limit exceeded.'
  }
};

// Content Security Policy configuration
export const cspConfig = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: [
      "'self'",
      'wss:',
      'https://api.elevenlabs.io',
      'https://*.firebaseio.com',
      'https://*.firebaseapp.com'
    ],
    fontSrc: ["'self'", 'https:', 'data:'],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"],
    upgradeInsecureRequests: []
  }
};

// CORS configuration
export const corsConfig = {
  origin: process.env.NODE_ENV === 'production'
    ? ['https://trading-game.vercel.app', 'https://www.trading-game.com']
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Security headers configuration
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

// Password strength validation
export const passwordSchema = Joi.string()
  .min(8)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  .required()
  .messages({
    'string.min': 'Password must be at least 8 characters',
    'string.pattern.base': 'Password must contain uppercase, lowercase, number and special character'
  });

// Sanitize object recursively
export const sanitizeObject = (obj: any): any => {
  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  if (typeof obj === 'object' && obj !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[sanitizeInput(key)] = sanitizeObject(value);
    }
    return sanitized;
  }
  return obj;
};

// IP-based rate limiting tracker
export class RateLimiter {
  private attempts: Map<string, { count: number; resetTime: number }> = new Map();

  checkLimit(identifier: string, maxAttempts: number, windowMs: number): boolean {
    const now = Date.now();
    const record = this.attempts.get(identifier);

    if (!record || record.resetTime < now) {
      this.attempts.set(identifier, {
        count: 1,
        resetTime: now + windowMs
      });
      return true;
    }

    if (record.count >= maxAttempts) {
      return false;
    }

    record.count++;
    return true;
  }

  reset(identifier: string): void {
    this.attempts.delete(identifier);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.attempts.entries()) {
      if (record.resetTime < now) {
        this.attempts.delete(key);
      }
    }
  }
}

// Create a global rate limiter instance
export const globalRateLimiter = new RateLimiter();

// Cleanup old entries every 5 minutes
setInterval(() => {
  globalRateLimiter.cleanup();
}, 5 * 60 * 1000);