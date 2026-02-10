import { Router, Request, Response } from 'express';
import { validateInput, validationSchemas, sanitizeInput } from '@trading-game/shared';
import { getFirestoreInstance } from '../lib/firebaseAdmin';
import { roomService } from '../services/roomService';
import { logger } from '../lib/logger';

const router = Router();

const USERS_COLLECTION = 'users';

interface UserProfile {
  id: string;
  username: string;
  email: string;
  stats: { gamesPlayed: number; wins: number; totalProfit: number };
  preferences: { voiceEnabled: boolean; defaultCharacter: string; volume: number };
  createdAt: number;
  lastActive: number;
}

const defaultProfile = (id: string, email: string): UserProfile => ({
  id,
  username: email?.split('@')[0] ?? 'Trader',
  email: email ?? '',
  stats: { gamesPlayed: 0, wins: 0, totalProfit: 0 },
  preferences: { voiceEnabled: true, defaultCharacter: 'DEALER', volume: 0.7 },
  createdAt: Date.now(),
  lastActive: Date.now(),
});

// Get or create user profile
router.get('/profile', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  const db = getFirestoreInstance();
  if (!db) {
    // Fallback: return computed profile without persistence
    return res.status(200).json(defaultProfile(req.user.id, req.user.email));
  }

  try {
    const ref = db.collection(USERS_COLLECTION).doc(req.user.id);
    const doc = await ref.get();

    if (doc.exists) {
      const profile = doc.data() as UserProfile;
      // Update lastActive
      await ref.update({ lastActive: Date.now() });
      return res.status(200).json(profile);
    }

    // First visit — create profile
    const profile = defaultProfile(req.user.id, req.user.email);
    await ref.set(profile);
    return res.status(200).json(profile);
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch user profile');
    return res.status(200).json(defaultProfile(req.user.id, req.user.email));
  }
});

// Update user profile
router.put('/profile', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  const { username, preferences } = req.body;

  if (username) {
    const usernameValidation = validateInput(username, validationSchemas.username);
    if (!usernameValidation.isValid) {
      return res.status(400).json({ error: 'Invalid username', message: usernameValidation.error });
    }
  }

  const db = getFirestoreInstance();
  if (!db) {
    return res.status(200).json({ success: true, message: 'Profile updated (in-memory only)' });
  }

  try {
    const updates: Record<string, any> = { lastActive: Date.now() };
    if (username) updates.username = sanitizeInput(username);
    if (preferences) {
      if (typeof preferences.voiceEnabled === 'boolean') updates['preferences.voiceEnabled'] = preferences.voiceEnabled;
      if (typeof preferences.defaultCharacter === 'string') updates['preferences.defaultCharacter'] = preferences.defaultCharacter;
      if (typeof preferences.volume === 'number') updates['preferences.volume'] = Math.max(0, Math.min(1, preferences.volume));
    }

    await db.collection(USERS_COLLECTION).doc(req.user.id).set(updates, { merge: true });
    return res.status(200).json({ success: true, message: 'Profile updated successfully' });
  } catch (error) {
    logger.error({ err: error }, 'Failed to update user profile');
    return res.status(500).json({ error: 'Update failed', message: 'An error occurred' });
  }
});

// Get user stats — computed from rooms
router.get('/stats', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  const db = getFirestoreInstance();

  try {
    // Pull persisted stats if available
    let storedStats = { gamesPlayed: 0, wins: 0, totalProfit: 0 };
    if (db) {
      const doc = await db.collection(USERS_COLLECTION).doc(req.user.id).get();
      if (doc.exists) {
        storedStats = (doc.data() as UserProfile)?.stats ?? storedStats;
      }
    }

    // Augment with live room data
    const rooms = await roomService.listRooms();
    let liveGames = 0;
    let liveWins = 0;
    let liveProfit = 0;
    for (const room of rooms) {
      const player = room.players.find((p) => p.id === req.user!.id);
      if (!player) continue;
      liveGames++;
      if (player.isWinner) liveWins++;
      liveProfit += player.balance - 1000; // relative to starting balance
    }

    const totalGames = storedStats.gamesPlayed + liveGames;
    const totalWins = storedStats.wins + liveWins;

    return res.status(200).json({
      gamesPlayed: totalGames,
      wins: totalWins,
      losses: totalGames - totalWins,
      winRate: totalGames > 0 ? Number((totalWins / totalGames).toFixed(2)) : 0,
      totalProfit: Number((storedStats.totalProfit + liveProfit).toFixed(2)),
      totalTrades: 0, // will be populated when trade history is persisted
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch user stats');
    return res.status(200).json({
      gamesPlayed: 0, wins: 0, losses: 0, winRate: 0, totalProfit: 0, totalTrades: 0,
    });
  }
});

// Get leaderboard — computed from Firestore user profiles
router.get('/leaderboard', async (_req: Request, res: Response) => {
  const db = getFirestoreInstance();
  if (!db) {
    return res.status(200).json({ leaderboard: [] });
  }

  try {
    const snapshot = await db
      .collection(USERS_COLLECTION)
      .orderBy('stats.totalProfit', 'desc')
      .limit(20)
      .get();

    const leaderboard = snapshot.docs.map((doc, index) => {
      const data = doc.data() as UserProfile;
      return {
        rank: index + 1,
        username: data.username,
        score: data.stats.totalProfit,
        wins: data.stats.wins,
        winRate: data.stats.gamesPlayed > 0
          ? Number((data.stats.wins / data.stats.gamesPlayed).toFixed(2))
          : 0,
      };
    });

    return res.status(200).json({ leaderboard });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch leaderboard');
    return res.status(200).json({ leaderboard: [] });
  }
});

// Delete account
router.delete('/account', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
  }

  const db = getFirestoreInstance();
  if (!db) {
    return res.status(200).json({ success: true, message: 'Account deleted' });
  }

  try {
    await db.collection(USERS_COLLECTION).doc(req.user.id).delete();
    return res.status(200).json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete account');
    return res.status(500).json({ error: 'Delete failed', message: 'An error occurred' });
  }
});

export default router;
