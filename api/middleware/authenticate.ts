import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAuthInstance, isFirebaseConfigured } from '../lib/firebaseAdmin';

const devBypassEnabled = process.env.AUTH_DEV_BYPASS === 'true';
const devBypassUserId = process.env.AUTH_DEV_USER_ID || 'dev-user';
const devBypassUserEmail = process.env.AUTH_DEV_USER_EMAIL || 'dev@example.com';

// Validate dev user ID to prevent injection via header
const SAFE_DEV_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const extractBearerToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') {
    return null;
  }
  if (!header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7).trim() || null;
};

const attachUserToRequest = (req: Request, decoded: DecodedIdToken | null) => {
  if (decoded) {
    req.user = {
      id: decoded.uid,
      email: decoded.email || 'unknown@trading.game',
      role: (decoded.role as string) || (decoded.claims?.role as string) || 'player',
    };
    return;
  }

  // In dev bypass mode, allow X-Dev-User-Id header to set distinct identities.
  // This enables multiplayer testing without Firebase. Validate strictly.
  const headerUserId = req.headers['x-dev-user-id'];
  const customId = typeof headerUserId === 'string' && SAFE_DEV_ID_RE.test(headerUserId)
    ? headerUserId
    : devBypassUserId;

  req.user = {
    id: customId,
    email: devBypassUserEmail,
    role: 'developer',
  };
};

const handleAuthUnavailable = (res: Response) =>
  res.status(503).json({
    error: 'AuthUnavailable',
    message: 'Firebase Admin is not configured on the server',
  });

export const authenticateRequest = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const auth = getAuthInstance();
  const token = extractBearerToken(req);

  if (!auth) {
    if (devBypassEnabled) {
      attachUserToRequest(req, null);
      return next();
    }
    return handleAuthUnavailable(res);
  }

  if (!token) {
    if (devBypassEnabled) {
      attachUserToRequest(req, null);
      return next();
    }
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing bearer token',
    });
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    attachUserToRequest(req, decoded);
    return next();
  } catch (error) {
    console.error('Auth verification failed:', error);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
};

export const attachOptionalUser = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const token = extractBearerToken(req);
  if (!token) {
    return next();
  }

  const auth = getAuthInstance();
  if (!auth) {
    if (devBypassEnabled) {
      attachUserToRequest(req, null);
    }
    return next();
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    attachUserToRequest(req, decoded);
  } catch (error) {
    console.warn('Optional auth token invalid:', error);
  }

  return next();
};

export const requireFirebaseConfig = (req: Request, res: Response, next: NextFunction) => {
  if (!isFirebaseConfigured() && !devBypassEnabled) {
    return handleAuthUnavailable(res);
  }
  return next();
};
