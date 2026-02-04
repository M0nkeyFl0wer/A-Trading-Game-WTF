import Joi from 'joi';

const HTML_ESCAPE_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"'`]/g, (char) => HTML_ESCAPE_ENTITIES[char] || char);

const ALLOWED_TAGS = new Set(['b', 'i', 'em', 'strong', 'a', 'p', 'br']);
const ALLOWED_ATTRS = new Set(['href', 'title', 'target']);
const TAG_REGEX = /<\s*\/??\s*([a-z0-9]+)([^>]*)>/gi;
const ATTR_REGEX = /([a-z0-9-:]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;

export const sanitizeInput = (input: string): string => {
  if (input == null) return '';
  return escapeHtml(String(input));
};

export const sanitizeHTML = (html: string): string => {
  if (html == null) return '';
  const source = String(html);
  let lastIndex = 0;
  let result = '';

  source.replace(TAG_REGEX, (match, tagName: string, attrsPart: string, offset: number) => {
    result += escapeHtml(source.slice(lastIndex, offset));
    lastIndex = offset + match.length;

    const normalizedTag = tagName.toLowerCase();
    const isClosing = match.trim().startsWith('</');
    const isSelfClosing = /\/\s*>$/.test(match);

    if (!ALLOWED_TAGS.has(normalizedTag)) {
      return '';
    }

    if (isClosing) {
      result += `</${normalizedTag}>`;
      return '';
    }

    const sanitizedAttrs: string[] = [];
    attrsPart.replace(ATTR_REGEX, (_attrMatch, rawAttr: string, _valueWithQuotes: string, doubleQuoted: string, singleQuoted: string) => {
      const attrName = rawAttr.toLowerCase();
      if (!ALLOWED_ATTRS.has(attrName)) {
        return '';
      }
      const attrValue = doubleQuoted ?? singleQuoted ?? '';
      sanitizedAttrs.push(`${attrName}="${escapeHtml(attrValue)}"`);
      return '';
    });

    const attrString = sanitizedAttrs.length ? ` ${sanitizedAttrs.join(' ')}` : '';
    const closing = isSelfClosing ? ' /' : '';
    result += `<${normalizedTag}${attrString}${closing}>`;
    return '';
  });

  result += escapeHtml(source.slice(lastIndex));
  return result;
};

export const validationSchemas = {
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(30)
    .required()
    .messages({
      'string.alphanum': 'Username must contain only letters and numbers',
      'string.min': 'Username must be at least 3 characters',
      'string.max': 'Username cannot exceed 30 characters',
    }),

  email: Joi.string()
    .email({ tlds: { allow: false } })
    .required()
    .messages({
      'string.email': 'Please enter a valid email address',
    }),

  roomCode: Joi.string()
    .alphanum()
    .length(6)
    .required()
    .messages({
      'string.alphanum': 'Room code must contain only letters and numbers',
      'string.length': 'Room code must be exactly 6 characters',
    }),

  tradeAmount: Joi.number()
    .min(0.01)
    .max(1_000_000)
    .required()
    .messages({
      'number.min': 'Trade amount must be at least 0.01',
      'number.max': 'Trade amount cannot exceed 1,000,000',
    }),

  botCode: Joi.string()
    .max(10_000)
    .required()
    .custom((value: string, helpers: Joi.CustomHelpers<string>) => {
      const dangerousPatterns = [
        /eval\s*\(/gi,
        /Function\s*\(/gi,
        /require\s*\(/gi,
        /import\s+/gi,
        /process\./gi,
        /child_process/gi,
        /fs\./gi,
        /__proto__/gi,
        /constructor\s*\[/gi,
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
      'string.max': 'Bot code cannot exceed 10,000 characters',
    }),

  message: Joi.string()
    .min(1)
    .max(500)
    .required()
    .messages({
      'string.min': 'Message cannot be empty',
      'string.max': 'Message cannot exceed 500 characters',
    }),
};

export const validateInput = <T>(
  value: unknown,
  schema: Joi.Schema,
): { isValid: boolean; data?: T; error?: string } => {
  const { error, value: validatedValue } = schema.validate(value);

  if (error) {
    return {
      isValid: false,
      error: error.details[0]?.message ?? 'Invalid input',
    };
  }

  return {
    isValid: true,
    data: validatedValue as T,
  };
};

export const rateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
};

export const endpointLimits = {
  auth: {
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts, please try again later.',
  },
  trading: {
    windowMs: 60 * 1000,
    max: 20,
    message: 'Trading rate limit exceeded, please slow down.',
  },
  bot: {
    windowMs: 60 * 1000,
    max: 10,
    message: 'Bot submission rate limit exceeded.',
  },
};

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
      'https://*.firebaseapp.com',
    ],
    fontSrc: ["'self'", 'https:', 'data:'],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"],
    upgradeInsecureRequests: [] as string[],
  },
};

export const corsConfig = {
  origin:
    typeof process !== 'undefined' && process.env.NODE_ENV === 'production'
      ? ['https://trading-game.vercel.app', 'https://www.trading-game.com']
      : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

export const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export const passwordSchema = Joi.string()
  .min(8)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  .required()
  .messages({
    'string.min': 'Password must be at least 8 characters',
    'string.pattern.base': 'Password must contain uppercase, lowercase, number and special character',
  });

export const sanitizeObject = (obj: unknown): unknown => {
  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  if (typeof obj === 'object' && obj !== null) {
    const sanitizedEntries = Object.entries(obj).map(([key, value]) => [
      sanitizeInput(key),
      sanitizeObject(value),
    ]);
    return Object.fromEntries(sanitizedEntries);
  }
  return obj;
};

export class RateLimiter {
  private attempts: Map<string, { count: number; resetTime: number }> = new Map();

  checkLimit(identifier: string, maxAttempts: number, windowMs: number): boolean {
    const now = Date.now();
    const record = this.attempts.get(identifier);

    if (!record || record.resetTime < now) {
      this.attempts.set(identifier, { count: 1, resetTime: now + windowMs });
      return true;
    }

    if (record.count >= maxAttempts) {
      return false;
    }

    record.count += 1;
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

export const globalRateLimiter = new RateLimiter();

if (typeof setInterval === 'function') {
  setInterval(() => {
    globalRateLimiter.cleanup();
  }, 5 * 60 * 1000);
}
