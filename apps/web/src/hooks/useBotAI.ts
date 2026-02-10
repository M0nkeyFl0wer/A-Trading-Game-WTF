import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const BOT_ROSTER = [
  { botId: 'bot-bull', botName: 'Bull Runner', botCharacter: 'BULL' },
  { botId: 'bot-bear', botName: 'Bear Necessities', botCharacter: 'BEAR' },
  { botId: 'bot-whale', botName: 'The Whale', botCharacter: 'WHALE' },
] as const;

export function useBotAI(roomId?: string) {
  const { currentUser } = useAuth();
  const addedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!roomId || !currentUser) return;
    if (addedRef.current === roomId) return;
    addedRef.current = roomId;

    const addBots = async () => {
      const token = await currentUser.getIdToken();
      for (const bot of BOT_ROSTER) {
        try {
          await fetch(`${API_BASE}/api/room/join/${roomId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(bot),
          });
        } catch (err) {
          console.error(`Failed to add bot ${bot.botName}`, err);
        }
      }
    };

    addBots();
  }, [roomId, currentUser]);
}
