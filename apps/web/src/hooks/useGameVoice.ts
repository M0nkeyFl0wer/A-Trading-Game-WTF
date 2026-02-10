import { useEffect, useRef, useCallback } from 'react';
import {
  voiceService,
  CHARACTER_PERSONALITIES,
  CHARACTER_VOICES,
} from '../lib/elevenlabs';
import type { VoiceStyle } from '@trading-game/shared';
import { useGameStore } from '../store';

interface UseGameVoiceOptions {
  enabled?: boolean;
  autoPlay?: boolean;
  character?: keyof typeof CHARACTER_PERSONALITIES;
}

export function useGameVoice(options: UseGameVoiceOptions = {}) {
  const { enabled = true, autoPlay = true, character = 'DEALER' } = options;
  const previousStateRef = useRef<{
    gamePhase?: string;
    roundNumber?: number;
    tradeCount?: number;
  }>({});
  const voiceQueueRef = useRef<
    Array<{ text: string; character?: string; style?: VoiceStyle }>
  >([]);
  const isProcessingRef = useRef(false);

  const gamePhase = useGameStore((state) => state.gamePhase);
  const roundNumber = useGameStore((state) => state.roundNumber);
  const players = useGameStore((state) => state.players);
  const trades = useGameStore((state) => state.trades);

  // Process voice queue
  const processVoiceQueue = useCallback(async () => {
    if (!enabled || isProcessingRef.current || voiceQueueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    const nextVoice = voiceQueueRef.current.shift();
    if (!nextVoice) {
      isProcessingRef.current = false;
      return;
    }

    try {
      await voiceService.playSpeech(
        nextVoice.text,
        nextVoice.character || CHARACTER_VOICES.DEALER,
        nextVoice.style
      );
    } catch (error) {
      console.error('Error playing voice:', error);
    }

    isProcessingRef.current = false;

    if (voiceQueueRef.current.length > 0) {
      setTimeout(() => processVoiceQueue(), 500);
    }
  }, [enabled]);

  // Queue voice announcement
  const queueVoice = useCallback((text: string, characterOverride?: keyof typeof CHARACTER_PERSONALITIES) => {
    if (!enabled) return;

    const selectedCharacter = characterOverride || character;
    const personality = CHARACTER_PERSONALITIES[selectedCharacter];
    if (!personality) return;

    voiceQueueRef.current.push({
      text,
      character: personality.voice,
      style: personality.voiceStyle,
    });

    processVoiceQueue();
  }, [enabled, character, processVoiceQueue]);

  // Announce game events
  const announceEvent = useCallback(async (event: string, value?: any) => {
    if (!enabled || !autoPlay) return;

    try {
      await voiceService.announceGameEvent(event, value, character);
    } catch (error) {
      console.error('Error announcing event:', error);
    }
  }, [enabled, autoPlay, character]);

  // React to game state changes
  useEffect(() => {
    if (!enabled || !autoPlay) return;

    const prev = previousStateRef.current;

    // Phase transitions
    if (gamePhase !== prev.gamePhase) {
      switch (gamePhase) {
        case 'waiting':
          queueVoice("Waiting for players to join...");
          break;
        case 'starting':
          queueVoice("Get ready! The game is about to begin!");
          break;
        case 'playing':
          queueVoice("The trading floor is now open! Post your quotes!");
          break;
        case 'finished': {
          const winner = players?.find((p: any) => p.isWinner);
          if (winner) {
            // Use the winner's character voice for the announcement
            const winChar = winner.character as keyof typeof CHARACTER_PERSONALITIES;
            if (winner.isBot && CHARACTER_PERSONALITIES[winChar]) {
              queueVoice(
                CHARACTER_PERSONALITIES[winChar].catchphrases[0],
                winChar
              );
            }
            queueVoice(`${winner.name} wins the round!`);
          } else {
            queueVoice("Round complete! Results are in.");
          }
          break;
        }
        case 'revealing':
          queueVoice("Cards revealed! Let's see who traded best.");
          break;
      }
    }

    // Round changes
    if (roundNumber !== prev.roundNumber && roundNumber && roundNumber > 1) {
      queueVoice(`Round ${roundNumber}. New cards, new trades!`);
    }

    // New trades (announce only the latest one to avoid spam)
    const currentTradeCount = trades?.length ?? 0;
    const prevTradeCount = prev.tradeCount ?? 0;
    if (currentTradeCount > prevTradeCount && currentTradeCount > 0) {
      const latestTrade = trades[trades.length - 1];
      if (latestTrade) {
        const tradeDesc = `${latestTrade.player} ${latestTrade.type === 'buy' ? 'buys' : 'sells'} ${latestTrade.quantity} at ${latestTrade.price}`;
        queueVoice(tradeDesc);
      }
    }

    // Update previous state
    previousStateRef.current = {
      gamePhase,
      roundNumber,
      tradeCount: currentTradeCount,
    };
  }, [gamePhase, roundNumber, trades, enabled, autoPlay, queueVoice, players]);

  // Character-specific reactions
  const playCharacterReaction = useCallback(async (situation: string) => {
    if (!enabled) return;

    const reactions: Record<string, Record<keyof typeof CHARACTER_PERSONALITIES, string[]>> = {
      'big_win': {
        DEALER: ["Impressive play!", "Well calculated!"],
        BULL: ["To the moon baby!", "That's how you do it!"],
        BEAR: ["Lucky this time...", "The market will correct..."],
        WHALE: ["As expected from a fellow whale", "The big money wins"],
        ROOKIE: ["Wow! How did you do that?", "I'm taking notes!"],
      },
      'big_loss': {
        DEALER: ["The market can be cruel", "Better luck next round"],
        BULL: ["Just a dip, we'll recover!", "Buy the dip!"],
        BEAR: ["I warned you!", "Should have shorted!"],
        WHALE: ["Pocket change...", "A minor setback..."],
        ROOKIE: ["Oh no, my savings!", "Is this normal?"],
      },
      'close_call': {
        DEALER: ["That was close!", "Tension on the trading floor!"],
        BULL: ["Almost there!", "So close!"],
        BEAR: ["Too close for comfort", "Narrowly avoided"],
        WHALE: ["Calculated risk", "The margin was acceptable"],
        ROOKIE: ["My heart is racing!", "Was that good or bad?"],
      },
    };

    const characterReactions = reactions[situation]?.[character];
    if (characterReactions) {
      const reaction = characterReactions[Math.floor(Math.random() * characterReactions.length)];
      queueVoice(reaction);
    }
  }, [enabled, character, queueVoice]);

  return {
    queueVoice,
    announceEvent,
    playCharacterReaction,
    stopVoice: () => voiceService.stopSpeech(),
  };
}
