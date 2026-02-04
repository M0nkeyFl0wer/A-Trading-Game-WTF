import { useEffect, useRef, useCallback } from 'react';
import {
  voiceService,
  CHARACTER_PERSONALITIES,
  CHARACTER_VOICES,
} from '../lib/elevenlabs';
import type { VoiceStyle } from '@trading-game/shared';
import { useStore } from '../store';

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
    lastAction?: unknown;
  }>({});
  const voiceQueueRef = useRef<
    Array<{ text: string; character?: string; style?: VoiceStyle }>
  >([]);
  const isProcessingRef = useRef(false);

  // Get game state from store (assuming you have these in your store)
  const gamePhase = useStore((state: any) => state.gamePhase);
  const roundNumber = useStore((state: any) => state.roundNumber);
  const players = useStore((state: any) => state.players);
  const lastAction = useStore((state: any) => state.lastAction);

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

    // Process next item in queue
    if (voiceQueueRef.current.length > 0) {
      setTimeout(() => processVoiceQueue(), 500);
    }
  }, [enabled]);

  // Queue voice announcement
  const queueVoice = useCallback((text: string, characterOverride?: keyof typeof CHARACTER_PERSONALITIES) => {
    if (!enabled) return;

    const selectedCharacter = characterOverride || character;
    const personality = CHARACTER_PERSONALITIES[selectedCharacter];
    if (!personality) {
      console.warn('Unknown character for voice playback', selectedCharacter);
      return;
    }

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

    // Check for game state changes
    if (gamePhase !== previousStateRef.current.gamePhase) {
      switch (gamePhase) {
        case 'waiting':
          queueVoice("Waiting for players to join...");
          break;
        case 'starting':
          queueVoice("Get ready! The game is about to begin!");
          break;
        case 'playing':
          queueVoice("The trading floor is now open!");
          break;
        case 'finished': {
          const winner = players?.find((p: any) => p.isWinner);
          if (winner) {
            queueVoice(`Congratulations ${winner.name}! You've conquered the market!`);
          } else {
            queueVoice("Game over! Thanks for playing!");
          }
          break;
        }
        case 'revealing':
          queueVoice("Reveal time! Let's see those cards!");
          break;
      }
    }

    // Check for round changes
    if (roundNumber !== previousStateRef.current.roundNumber && roundNumber) {
      queueVoice(`Round ${roundNumber} begins now! Check your cards!`);
    }

    // Check for player actions
    if (lastAction !== previousStateRef.current.lastAction && lastAction) {
      switch (lastAction.type) {
        case 'trade':
          queueVoice(`${lastAction.player} places a ${lastAction.value} share trade!`);
          break;
        case 'fold':
          queueVoice(`${lastAction.player} folds!`);
          break;
        case 'reveal':
          queueVoice("Revealing the market value!");
          break;
        case 'win_round':
          queueVoice(
            `${lastAction.player} wins the round${
              typeof lastAction.value === 'number'
                ? ` with ${lastAction.value} points!`
                : '!'
            }`
          );
          break;
      }
    }

    // Update previous state
    previousStateRef.current = {
      gamePhase,
      roundNumber,
      lastAction,
    };
  }, [gamePhase, roundNumber, lastAction, enabled, autoPlay, queueVoice, players]);

  // Character-specific reactions
  const playCharacterReaction = useCallback(async (situation: string) => {
    if (!enabled) return;

    const reactions: Record<string, Record<keyof typeof CHARACTER_PERSONALITIES, string[]>> = {
      'big_win': {
        DEALER: ["Impressive play!", "Well calculated!", "The house acknowledges your skill!"],
        BULL: ["To the moon baby!", "That's how you do it!", "Diamond hands win!"],
        BEAR: ["Lucky this time...", "The market will correct...", "Don't get too confident..."],
        WHALE: ["As expected from a fellow whale", "The big money always wins", "Small fish, take notes"],
        ROOKIE: ["Wow! How did you do that?", "I'm taking notes!", "Teach me your ways!"],
      },
      'big_loss': {
        DEALER: ["The market can be cruel", "Better luck next round", "Risk and reward..."],
        BULL: ["Just a dip, we'll recover!", "HODL!", "Buy the dip!"],
        BEAR: ["I warned you!", "The bubble burst!", "Should have shorted!"],
        WHALE: ["Pocket change...", "The ocean is vast...", "A minor setback..."],
        ROOKIE: ["Oh no, my savings!", "I don't understand!", "Is this normal?"],
      },
      'close_call': {
        DEALER: ["That was close!", "By a hair's breadth!", "Tension on the trading floor!"],
        BULL: ["Almost there!", "So close to the moon!", "Next time for sure!"],
        BEAR: ["Too close for comfort", "The edge of disaster", "Narrowly avoided"],
        WHALE: ["Calculated risk", "Precisely as planned", "The margin was acceptable"],
        ROOKIE: ["My heart is racing!", "I can't take this stress!", "Was that good or bad?"],
      },
    };

    const characterReactions = reactions[situation]?.[character];
    if (characterReactions) {
      const reaction = characterReactions[Math.floor(Math.random() * characterReactions.length)];
      queueVoice(reaction);
    }
  }, [enabled, character, queueVoice]);

  // Expose methods for manual control
  return {
    queueVoice,
    announceEvent,
    playCharacterReaction,
    stopVoice: () => voiceService.stopSpeech(),
    setCharacter: (newCharacter: keyof typeof CHARACTER_PERSONALITIES) => {
      // This would typically update state, but for now just use in next call
      console.log('Character switched to:', newCharacter);
    },
  };
}
