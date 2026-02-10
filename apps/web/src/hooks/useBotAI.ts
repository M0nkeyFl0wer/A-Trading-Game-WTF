import { useEffect, useRef } from 'react';
import { useGameStore } from '../store';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const BOT_ROSTER = [
  { id: 'bot-bull', name: 'Bull Runner', character: 'BULL' },
  { id: 'bot-bear', name: 'Bear Necessities', character: 'BEAR' },
  { id: 'bot-whale', name: 'The Whale', character: 'WHALE' },
] as const;

/**
 * Adds bot opponents to the room when fewer than 4 players are seated.
 * Bots trade automatically via the server-side GameEngine.generateBotTrades().
 */
export function useBotAI(roomId?: string) {
  const players = useGameStore((s) => s.players);
  const gamePhase = useGameStore((s) => s.gamePhase);
  const { currentUser } = useAuth();
  const addedRef = useRef(false);

  useEffect(() => {
    if (!roomId || !currentUser || addedRef.current) return;
    if (gamePhase !== 'waiting' && gamePhase !== 'idle') return;

    // Only add bots if the table has fewer than 4 players
    const humanCount = players.filter((p) => !p.isBot).length;
    if (humanCount === 0 || players.length >= 4) return;

    addedRef.current = true;

    const addBots = async () => {
      const token = await currentUser.getIdToken();
      const botsToAdd = BOT_ROSTER.slice(0, Math.max(0, 4 - players.length));

      for (const bot of botsToAdd) {
        try {
          await fetch(`${API_BASE}/api/room/join/${roomId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              botId: bot.id,
              botName: bot.name,
              botCharacter: bot.character,
            }),
          });
        } catch (err) {
          console.warn(`Failed to add bot ${bot.name}`, err);
        }
      }
    };

    addBots();
  }, [roomId, currentUser, players, gamePhase]);

  // Reset when leaving the room
  useEffect(() => {
    return () => {
      addedRef.current = false;
    };
  }, [roomId]);
}
