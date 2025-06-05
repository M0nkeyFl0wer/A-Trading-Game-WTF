import { useEffect } from 'react';
import { GunSlingerBot } from '@trading-game/bot';
import { useGameStore } from '../store';

export function useBotAI() {
  const round = useGameStore(s => s.round);

  useEffect(() => {
    if (!round) return;
    const players = (round as any).table.players;
    for (let i = 0; i < players.length; i++) {
      if (!players[i].id) {
        const bot = new GunSlingerBot(i, 1, Math.random);
        players[i].id = `BOT${i}`;
        if (players[i].card) bot.onCard(players[i].card);
        // In a real game we would hook into round events
      }
    }
  }, [round]);
}
