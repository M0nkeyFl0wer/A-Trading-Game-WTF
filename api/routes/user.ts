import { Router, Request, Response } from 'express';
import { validateInput, validationSchemas, sanitizeInput } from '@trading-game/shared';
import { getFirestoreInstance } from '../lib/firebaseAdmin';
import { roomService } from '../services/roomService';
import { logger } from '../lib/logger';

const router = Router();
const USERS_COLLECTION = 'users';

interface UserProfile {
  id: string; username: string; email: string;
  stats: { gamesPlayed: number; wins: number; totalProfit: number };
  preferences: { voiceEnabled: boolean; defaultCharacter: string; volume: number };
  createdAt: number; lastActive: number;
}

const defaultProfile = (id: string, email: string): UserProfile => ({
  id, username: email?.split('@')[0] ?? 'Trader', email: email ?? '',
  stats: { gamesPlayed: 0, wins: 0, totalProfit: 0 },
  preferences: { voiceEnabled: true, defaultCharacter: 'DEALER', volume: 0.7 },
  createdAt: Date.now(), lastActive: Date.now(),
});

router.get('/profile', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const db = getFirestoreInstance();
  if (!db) return res.status(200).json(defaultProfile(req.user.id, req.user.email));
  try {
    const ref = db.collection(USERS_COLLECTION).doc(req.user.id);
    const doc = await ref.get();
    if (doc.exists) { await ref.update({ lastActive: Date.now() }); return res.status(200).json(doc.data()); }
    const profile = defaultProfile(req.user.id, req.user.email);
    await ref.set(profile);
    return res.status(200).json(profile);
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch user profile');
    return res.status(200).json(defaultProfile(req.user.id, req.user.email));
  }
});

router.put('/profile', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { username, preferences } = req.body;
  if (username) {
    const v = validateInput(username, validationSchemas.username);
    if (!v.isValid) return res.status(400).json({ error: 'Invalid username', message: v.error });
  }
  const db = getFirestoreInstance();
  if (!db) return res.status(200).json({ success: true, message: 'Profile updated (in-memory only)' });
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
    logger.error({ err: error }, 'Failed to update profile');
    return res.status(500).json({ error: 'Update failed' });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const rooms = await roomService.listRooms();
    let games = 0, wins = 0, profit = 0;
    for (const room of rooms) {
      const player = room.players.find((p) => p.id === req.user!.id);
      if (!player) continue;
      games++; if (player.isWinner) wins++; profit += player.balance - 1000;
    }
    return res.status(200).json({ gamesPlayed: games, wins, losses: games - wins, winRate: games > 0 ? Number((wins / games).toFixed(2)) : 0, totalProfit: Number(profit.toFixed(2)), totalTrades: 0 });
  } catch {
    return res.status(200).json({ gamesPlayed: 0, wins: 0, losses: 0, winRate: 0, totalProfit: 0, totalTrades: 0 });
  }
});

router.get('/leaderboard', async (_req: Request, res: Response) => {
  const db = getFirestoreInstance();
  if (!db) return res.status(200).json({ leaderboard: [] });
  try {
    const snapshot = await db.collection(USERS_COLLECTION).orderBy('stats.totalProfit', 'desc').limit(20).get();
    const leaderboard = snapshot.docs.map((doc, i) => {
      const d = doc.data() as UserProfile;
      return { rank: i + 1, username: d.username, score: d.stats.totalProfit, wins: d.stats.wins, winRate: d.stats.gamesPlayed > 0 ? Number((d.stats.wins / d.stats.gamesPlayed).toFixed(2)) : 0 };
    });
    return res.status(200).json({ leaderboard });
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch leaderboard');
    return res.status(200).json({ leaderboard: [] });
  }
});

router.delete('/account', async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const db = getFirestoreInstance();
  if (!db) return res.status(200).json({ success: true, message: 'Account deleted' });
  try {
    await db.collection(USERS_COLLECTION).doc(req.user.id).delete();
    return res.status(200).json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete account');
    return res.status(500).json({ error: 'Delete failed' });
  }
});

export default router;
