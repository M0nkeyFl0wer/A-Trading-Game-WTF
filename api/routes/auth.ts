import { Router, Request, Response } from 'express';
import { validateInput, validationSchemas, sanitizeInput } from '@trading-game/shared';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiting';
import { getAuthInstance } from '../lib/firebaseAdmin';
import { logger } from '../lib/logger';

const router = Router();

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'Missing idToken', message: 'Provide a Firebase ID token' });
    }
    const auth = getAuthInstance();
    if (!auth) {
      return res.status(503).json({ error: 'AuthUnavailable', message: 'Firebase Admin is not configured' });
    }
    const decoded = await auth.verifyIdToken(idToken);
    return res.status(200).json({
      success: true,
      user: { id: decoded.uid, email: decoded.email ?? null, name: decoded.name ?? decoded.email ?? 'Trader' },
    });
  } catch (error) {
    logger.error({ err: error }, 'Login verification failed');
    return res.status(401).json({ error: 'Authentication failed', message: 'Invalid or expired token' });
  }
});

router.post('/signup', authLimiter, async (req: Request, res: Response) => {
  try {
    const { idToken, username } = req.body;
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'Missing idToken', message: 'Provide a Firebase ID token' });
    }
    if (username) {
      const v = validateInput(username, validationSchemas.username);
      if (!v.isValid) return res.status(400).json({ error: 'Invalid username', message: v.error });
    }
    const auth = getAuthInstance();
    if (!auth) return res.status(503).json({ error: 'AuthUnavailable', message: 'Firebase Admin not configured' });
    const decoded = await auth.verifyIdToken(idToken);
    const sanitizedUsername = username ? sanitizeInput(username) : undefined;
    if (sanitizedUsername) await auth.updateUser(decoded.uid, { displayName: sanitizedUsername });
    return res.status(201).json({
      success: true,
      user: { id: decoded.uid, email: decoded.email ?? null, username: sanitizedUsername ?? decoded.name ?? decoded.email },
    });
  } catch (error) {
    logger.error({ err: error }, 'Signup verification failed');
    return res.status(500).json({ error: 'Internal server error', message: 'An error occurred during signup' });
  }
});

router.post('/reset', passwordResetLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const v = validateInput(email, validationSchemas.email);
    if (!v.isValid) return res.status(400).json({ error: 'Invalid input', message: v.error });
    const auth = getAuthInstance();
    if (auth) await auth.generatePasswordResetLink(sanitizeInput(email));
    return res.status(200).json({ success: true, message: 'If an account exists, a reset link has been sent' });
  } catch {
    return res.status(200).json({ success: true, message: 'If an account exists, a reset link has been sent' });
  }
});

router.post('/logout', async (_req: Request, res: Response) => {
  return res.status(200).json({ success: true, message: 'Logged out successfully' });
});

router.get('/verify', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  const auth = getAuthInstance();
  if (!auth) return res.status(503).json({ error: 'AuthUnavailable' });
  try {
    const decoded = await auth.verifyIdToken(token);
    return res.status(200).json({ valid: true, user: { id: decoded.uid, email: decoded.email ?? null, name: decoded.name ?? decoded.email ?? 'Trader' } });
  } catch {
    return res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }
});

router.get('/login', (_req: Request, res: Response) => {
  res.status(405).json({ error: 'Method not allowed', message: 'Use POST for login' });
});

export default router;
