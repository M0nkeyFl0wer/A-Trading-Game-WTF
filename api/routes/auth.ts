import { Router, Request, Response } from 'express';
import { validateInput, validationSchemas, sanitizeInput } from '@trading-game/shared';
import { authLimiter, passwordResetLimiter } from '../middleware/rateLimiting';
import { getAuthInstance } from '../lib/firebaseAdmin';
import { logger } from '../lib/logger';

const router = Router();

/**
 * Authentication routes — delegates to Firebase Admin SDK.
 *
 * The client signs in via the Firebase JS SDK (AuthContext.tsx) and receives a
 * Firebase ID token.  These endpoints verify / exchange that token so the API
 * layer can associate requests with a uid.
 */

// Verify a Firebase ID token and return the decoded user info.
// This is the primary "login" handshake for the API.
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({
        error: 'Missing idToken',
        message: 'Provide a Firebase ID token in the request body',
      });
    }

    const auth = getAuthInstance();
    if (!auth) {
      return res.status(503).json({
        error: 'AuthUnavailable',
        message: 'Firebase Admin is not configured on the server',
      });
    }

    const decoded = await auth.verifyIdToken(idToken);

    return res.status(200).json({
      success: true,
      user: {
        id: decoded.uid,
        email: decoded.email ?? null,
        name: decoded.name ?? decoded.email ?? 'Trader',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Login verification failed');
    return res.status(401).json({
      error: 'Authentication failed',
      message: 'Invalid or expired token',
    });
  }
});

// Signup — client creates the account via Firebase JS SDK, then calls this to
// confirm server-side and optionally set custom claims.
router.post('/signup', authLimiter, async (req: Request, res: Response) => {
  try {
    const { idToken, username } = req.body;

    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({
        error: 'Missing idToken',
        message: 'Provide a Firebase ID token after creating the account client-side',
      });
    }

    if (username) {
      const usernameValidation = validateInput(username, validationSchemas.username);
      if (!usernameValidation.isValid) {
        return res.status(400).json({
          error: 'Invalid username',
          message: usernameValidation.error,
        });
      }
    }

    const auth = getAuthInstance();
    if (!auth) {
      return res.status(503).json({
        error: 'AuthUnavailable',
        message: 'Firebase Admin is not configured on the server',
      });
    }

    const decoded = await auth.verifyIdToken(idToken);
    const sanitizedUsername = username ? sanitizeInput(username) : undefined;

    // Set display name if provided
    if (sanitizedUsername) {
      await auth.updateUser(decoded.uid, { displayName: sanitizedUsername });
    }

    return res.status(201).json({
      success: true,
      user: {
        id: decoded.uid,
        email: decoded.email ?? null,
        username: sanitizedUsername ?? decoded.name ?? decoded.email,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Signup verification failed');
    return res.status(500).json({
      error: 'Internal server error',
      message: 'An error occurred during signup',
    });
  }
});

// Password reset — delegates to Firebase Auth
router.post('/reset', passwordResetLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    const emailValidation = validateInput(email, validationSchemas.email);
    if (!emailValidation.isValid) {
      return res.status(400).json({
        error: 'Invalid input',
        message: emailValidation.error,
      });
    }

    const auth = getAuthInstance();
    if (!auth) {
      return res.status(503).json({
        error: 'AuthUnavailable',
        message: 'Firebase Admin is not configured',
      });
    }

    // Generate a password reset link (Firebase sends the email)
    await auth.generatePasswordResetLink(sanitizeInput(email));

    // Always return success to avoid user enumeration
    return res.status(200).json({
      success: true,
      message: 'If an account exists with that email, a reset link has been sent',
    });
  } catch {
    // Return success even on error to prevent user enumeration
    return res.status(200).json({
      success: true,
      message: 'If an account exists with that email, a reset link has been sent',
    });
  }
});

// Logout — stateless auth means the client just drops the token.
router.post('/logout', async (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

// Verify token endpoint
router.get('/verify', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'No token provided',
      message: 'Authorization header required',
    });
  }

  const auth = getAuthInstance();
  if (!auth) {
    return res.status(503).json({
      error: 'AuthUnavailable',
      message: 'Firebase Admin is not configured',
    });
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    return res.status(200).json({
      valid: true,
      user: {
        id: decoded.uid,
        email: decoded.email ?? null,
        name: decoded.name ?? decoded.email ?? 'Trader',
      },
    });
  } catch {
    return res.status(401).json({
      valid: false,
      error: 'Invalid or expired token',
    });
  }
});

// Method not allowed for GET on login
router.get('/login', (_req: Request, res: Response) => {
  res.status(405).json({
    error: 'Method not allowed',
    message: 'Use POST for login',
  });
});

export default router;
