import {
  CHARACTER_VOICES,
  VOICE_SETTINGS,
  type VoiceStyle,
  DEFAULT_VOICE_STYLE,
} from '@trading-game/shared';

export { CHARACTER_VOICES, VOICE_SETTINGS } from '@trading-game/shared';
export type { VoiceStyle } from '@trading-game/shared';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const VOICE_PROXY_ENDPOINT = '/api/voice/speak';
const VOICE_PROXY_URL = API_BASE_URL ? `${API_BASE_URL}${VOICE_PROXY_ENDPOINT}` : VOICE_PROXY_ENDPOINT;

// Character personalities and dialogue styles
export const CHARACTER_PERSONALITIES = {
  DEALER: {
    name: 'The Dealer',
    voice: CHARACTER_VOICES.DEALER,
    style: 'professional',
    voiceStyle: 'default' as VoiceStyle,
    traits: ['calm', 'authoritative', 'neutral'],
    catchphrases: [
      "Place your bets, traders",
      "The market waits for no one",
      "Time to reveal the cards",
      "Trading floor is now open",
    ],
  },
  BULL: {
    name: 'Bull Runner',
    voice: CHARACTER_VOICES.BULL,
    style: 'aggressive',
    voiceStyle: 'excited' as VoiceStyle,
    traits: ['optimistic', 'confident', 'risk-taker'],
    catchphrases: [
      "To the moon!",
      "Buy the dip!",
      "Diamond hands, baby!",
      "This is just the beginning!",
    ],
  },
  BEAR: {
    name: 'Bear Necessities',
    voice: CHARACTER_VOICES.BEAR,
    style: 'cautious',
    voiceStyle: 'calm' as VoiceStyle,
    traits: ['pessimistic', 'analytical', 'conservative'],
    catchphrases: [
      "The crash is coming",
      "Time to short this",
      "I warned you all",
      "Markets always correct",
    ],
  },
  WHALE: {
    name: 'The Whale',
    voice: CHARACTER_VOICES.WHALE,
    style: 'mysterious',
    voiceStyle: 'dramatic' as VoiceStyle,
    traits: ['wealthy', 'strategic', 'influential'],
    catchphrases: [
      "Small fish swim in my wake",
      "I move markets",
      "Patience brings profits",
      "Follow the smart money",
    ],
  },
  ROOKIE: {
    name: 'Fresh Trader',
    voice: CHARACTER_VOICES.ROOKIE,
    style: 'excited',
    voiceStyle: 'excited' as VoiceStyle,
    traits: ['naive', 'enthusiastic', 'learning'],
    catchphrases: [
      "Is this good? Is this bad?",
      "My first big trade!",
      "I read about this online!",
      "YOLO!",
    ],
  },
};

export class ElevenLabsService {
  private audioCache: Map<string, { data: string; accessedAt: number }> = new Map();
  private static readonly MAX_CACHE_SIZE = 50;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private isPlaying = false;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private readonly isBrowser: boolean;
  private readonly supportsAudioContext: boolean;
  private readonly supportsSpeechSynthesis: boolean;
  private voiceProxyEnabled: boolean;
  private masterVolume = 0.7;

  constructor() {
    this.isBrowser = typeof window !== 'undefined';
    const globalWindow = this.isBrowser ? (window as any) : undefined;
    this.supportsAudioContext = Boolean(
      globalWindow?.AudioContext || globalWindow?.webkitAudioContext
    );
    this.supportsSpeechSynthesis = Boolean(
      this.isBrowser &&
      'speechSynthesis' in window &&
      typeof (window as any).SpeechSynthesisUtterance !== 'undefined'
    );
    this.voiceProxyEnabled = true;

    if (this.supportsAudioContext) {
      const AudioCtx = globalWindow.AudioContext || globalWindow.webkitAudioContext;
      this.audioContext = new AudioCtx();
      this.initializeGainNode();
    }
  }

  setVolume(volume: number) {
    const clamped = Math.min(1, Math.max(0, volume));
    this.masterVolume = clamped;

    if (!this.gainNode) {
      this.initializeGainNode();
    }

    if (this.gainNode) {
      const ctx = this.gainNode.context;
      if (typeof this.gainNode.gain.setTargetAtTime === 'function') {
        this.gainNode.gain.setTargetAtTime(clamped, ctx.currentTime, 0.01);
      } else {
        this.gainNode.gain.value = clamped;
      }
    }
  }

  /**
   * Generate speech from text using ElevenLabs API
   */
  async generateSpeech(
    text: string,
    voiceId: string = CHARACTER_VOICES.DEALER,
    style: VoiceStyle = DEFAULT_VOICE_STYLE
  ): Promise<ArrayBuffer> {
    if (!this.voiceProxyEnabled) {
      throw new Error('Voice proxy unavailable');
    }

    if (typeof fetch !== 'function') {
      throw new Error('Fetch API unavailable in this environment');
    }

    const normalizedText = text?.trim();
    if (!normalizedText) {
      throw new Error('Text is required for speech synthesis');
    }

    const cacheKey = `${voiceId}-${style}-${normalizedText}`;
    const cached = this.audioCache.get(cacheKey);
    if (cached) {
      cached.accessedAt = Date.now();
      return this.base64ToArrayBuffer(cached.data);
    }

    const response = await fetch(VOICE_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        text: normalizedText,
        voiceId,
        style,
      }),
    });

    if (!response.ok) {
      if (response.status === 503) {
        this.voiceProxyEnabled = false;
      }
      throw new Error(`Voice proxy error: ${response.statusText}`);
    }

    const audioData = await response.arrayBuffer();
    this.evictStaleCache();
    this.audioCache.set(cacheKey, { data: this.arrayBufferToBase64(audioData), accessedAt: Date.now() });

    return audioData;
  }

  /**
   * Play speech audio
   */
  async playSpeech(
    text: string,
    voiceId: string = CHARACTER_VOICES.DEALER,
    style: VoiceStyle = DEFAULT_VOICE_STYLE
  ): Promise<void> {
    if (!this.isBrowser) {
      // In SSR/tests we simply log the dialogue so it can be asserted
      console.info(`[voice disabled] ${text}`);
      return;
    }

    if (!this.supportsAudioContext) {
      await this.speakWithFallback(text);
      return;
    }

    try {
      const audioData = await this.generateSpeech(text, voiceId, style);
      const audioContext = this.ensureAudioContext();

      if (!audioContext) {
        await this.speakWithFallback(text);
        return;
      }

      const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));

      await this.playAudioBuffer(audioContext, audioBuffer);
    } catch (error) {
      console.error('Error playing speech:', error);
      await this.speakWithFallback(text);
    }
  }

  /**
   * Play character catchphrase
   */
  async playCharacterCatchphrase(characterType: keyof typeof CHARACTER_PERSONALITIES): Promise<void> {
    const character = CHARACTER_PERSONALITIES[characterType];
    const phrase = character.catchphrases[Math.floor(Math.random() * character.catchphrases.length)];

    await this.playSpeech(phrase, character.voice, character.voiceStyle);
  }

  /**
   * Generate contextual dialogue based on game events
   */
  getContextualDialogue(event: string, value?: any): string {
    const dialogues: Record<string, string[]> = {
      'game.start': [
        "Welcome to the trading floor!",
        "Let the games begin!",
        "Markets are open, place your trades!",
      ],
      'round.start': [
        `Round ${value} begins now!`,
        `Starting round ${value}. Good luck, traders!`,
        `Round ${value} - may the best trader win!`,
      ],
      'card.dealt': [
        "Cards have been dealt!",
        "Check your cards, traders!",
        "Your hand is ready!",
      ],
      'trade.placed': [
        `Trade placed for ${value} shares!`,
        `${value} shares are on the table!`,
        `Interesting move with ${value} shares!`,
      ],
      'round.reveal': [
        "Revealing the market value!",
        "Time to see who wins!",
        "The moment of truth!",
      ],
      'game.win': [
        `Congratulations! ${value} wins the game!`,
        `Victory goes to ${value}!`,
        `${value} has conquered the market!`,
      ],
      'game.lose': [
        `Better luck next time, ${value}!`,
        `${value}, the market wasn't in your favor today!`,
        `Don't give up, ${value}! Try again!`,
      ],
    };

    const options = dialogues[event] || ["Something interesting happened!"];
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * Play game event sound with voice
   */
  async announceGameEvent(
    event: string,
    value?: any,
    characterType: keyof typeof CHARACTER_PERSONALITIES = 'DEALER'
  ): Promise<void> {
    const dialogue = this.getContextualDialogue(event, value);
    const character = CHARACTER_PERSONALITIES[characterType];

    await this.playSpeech(dialogue, character.voice, DEFAULT_VOICE_STYLE);
  }

  /**
   * Queue multiple voice lines to play in sequence
   */
  async queueDialogue(dialogues: Array<{text: string, character: keyof typeof CHARACTER_PERSONALITIES, delay?: number}>): Promise<void> {
    for (const dialogue of dialogues) {
      const character = CHARACTER_PERSONALITIES[dialogue.character];
      await this.playSpeech(dialogue.text, character.voice, DEFAULT_VOICE_STYLE);

      if (dialogue.delay) {
        await new Promise(resolve => setTimeout(resolve, dialogue.delay));
      }
    }
  }

  /**
   * Stop current audio playback
   */
  stopSpeech(): void {
    if (this.supportsSpeechSynthesis) {
      window.speechSynthesis.cancel();
    }

    if (this.currentSource) {
      this.currentSource.stop();
      this.currentSource = null;
      this.isPlaying = false;
    }
  }

  /**
   * Helper: Play audio buffer
   */
  private async playAudioBuffer(audioContext: AudioContext, audioBuffer: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      this.currentSource = audioContext.createBufferSource();
      this.currentSource.buffer = audioBuffer;
      const destination = this.ensureGainNode(audioContext);
      this.currentSource.connect(destination ?? audioContext.destination);

      this.currentSource.onended = () => {
        this.isPlaying = false;
        this.currentSource = null;
        resolve();
      };

      this.isPlaying = true;
      this.currentSource.start();
    });
  }

  /**
   * Helper: Convert ArrayBuffer to Base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary);
  }

  /**
   * Helper: Convert Base64 to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Helper: lazily initialise audio context
   */
  private ensureAudioContext(): AudioContext | null {
    if (!this.supportsAudioContext) {
      return null;
    }

    if (!this.audioContext) {
      const globalWindow = window as any;
      const AudioCtx = globalWindow.AudioContext || globalWindow.webkitAudioContext;
      this.audioContext = new AudioCtx();
      this.initializeGainNode();
    }

    return this.audioContext;
  }

  private ensureGainNode(audioContext: AudioContext): GainNode | null {
    if (!this.gainNode) {
      this.gainNode = audioContext.createGain();
      this.gainNode.gain.value = this.masterVolume;
      this.gainNode.connect(audioContext.destination);
    }
    return this.gainNode;
  }

  private initializeGainNode() {
    if (!this.audioContext || !this.supportsAudioContext) {
      return;
    }
    this.ensureGainNode(this.audioContext);
  }

  /**
   * Evict expired and excess entries from the audio cache.
   */
  private evictStaleCache(): void {
    const now = Date.now();
    // Remove entries older than TTL
    for (const [key, entry] of this.audioCache) {
      if (now - entry.accessedAt > ElevenLabsService.CACHE_TTL_MS) {
        this.audioCache.delete(key);
      }
    }
    // If still over budget, drop least-recently-accessed entries
    if (this.audioCache.size >= ElevenLabsService.MAX_CACHE_SIZE) {
      const sorted = [...this.audioCache.entries()].sort((a, b) => a[1].accessedAt - b[1].accessedAt);
      const toRemove = sorted.slice(0, sorted.length - ElevenLabsService.MAX_CACHE_SIZE + 1);
      for (const [key] of toRemove) {
        this.audioCache.delete(key);
      }
    }
  }

  /**
   * Helper: speech synthesis fallback for when ElevenLabs is unavailable
   */
  private async speakWithFallback(text: string): Promise<void> {
    if (!this.isBrowser) {
      return;
    }

    if (this.supportsSpeechSynthesis) {
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
      return;
    }

    console.info(`[voice] ${text}`);
  }

  /**
   * Preload common phrases for better performance
   */
  async preloadCommonPhrases(): Promise<void> {
    if (!this.voiceProxyEnabled || !this.supportsAudioContext) {
      return;
    }

    const commonPhrases = [
      { text: "Welcome to the trading floor!", voice: CHARACTER_VOICES.DEALER },
      { text: "Place your bets!", voice: CHARACTER_VOICES.DEALER },
      { text: "To the moon!", voice: CHARACTER_VOICES.BULL },
      { text: "The crash is coming!", voice: CHARACTER_VOICES.BEAR },
    ];

    await Promise.all(
      commonPhrases.map(phrase =>
        this.generateSpeech(phrase.text, phrase.voice, DEFAULT_VOICE_STYLE).catch(console.error)
      )
    );
  }
}

// Export singleton instance
export const voiceService = new ElevenLabsService();
