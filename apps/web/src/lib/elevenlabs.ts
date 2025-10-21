// ElevenLabs Voice Integration Service
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Character voice IDs from ElevenLabs
export const CHARACTER_VOICES = {
  DEALER: 'EXAVITQu4vr4xnSDxMaL', // Sarah - Professional dealer voice
  BULL: '21m00Tcm4TlvDq8ikWAM', // Rachel - Confident trader
  BEAR: 'AZnzlk1XvdvUeBnXmlld', // Domi - Cautious analyst
  WHALE: 'pNInz6obpgDQGcFmaJgB', // Adam - Deep voiced big player
  ROOKIE: 'yoZ06aMxZJJ28mfd3POQ', // Sam - Young enthusiastic trader
  ANNOUNCER: 'ThT5KcBeYPX3keUQqHPh', // Dorothy - Game announcer
} as const;

// Character personalities and dialogue styles
export const CHARACTER_PERSONALITIES = {
  DEALER: {
    name: 'The Dealer',
    voice: CHARACTER_VOICES.DEALER,
    style: 'professional',
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
    traits: ['naive', 'enthusiastic', 'learning'],
    catchphrases: [
      "Is this good? Is this bad?",
      "My first big trade!",
      "I read about this online!",
      "YOLO!",
    ],
  },
};

// Voice settings for different situations
export const VOICE_SETTINGS = {
  default: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.5,
    use_speaker_boost: true,
  },
  excited: {
    stability: 0.3,
    similarity_boost: 0.8,
    style: 0.7,
    use_speaker_boost: true,
  },
  calm: {
    stability: 0.7,
    similarity_boost: 0.7,
    style: 0.3,
    use_speaker_boost: true,
  },
  dramatic: {
    stability: 0.4,
    similarity_boost: 0.85,
    style: 0.8,
    use_speaker_boost: true,
  },
};

export class ElevenLabsService {
  private audioCache: Map<string, string> = new Map();
  private isPlaying = false;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private readonly isBrowser: boolean;
  private readonly hasApiKey: boolean;
  private readonly supportsAudioContext: boolean;
  private readonly supportsSpeechSynthesis: boolean;

  constructor() {
    this.isBrowser = typeof window !== 'undefined';
    this.hasApiKey = Boolean(ELEVENLABS_API_KEY);
    const globalWindow = this.isBrowser ? (window as any) : undefined;
    this.supportsAudioContext = Boolean(
      globalWindow?.AudioContext || globalWindow?.webkitAudioContext
    );
    this.supportsSpeechSynthesis = Boolean(
      this.isBrowser &&
      'speechSynthesis' in window &&
      typeof (window as any).SpeechSynthesisUtterance !== 'undefined'
    );

    if (this.supportsAudioContext) {
      const AudioCtx = globalWindow.AudioContext || globalWindow.webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
  }

  /**
   * Generate speech from text using ElevenLabs API
   */
  async generateSpeech(
    text: string,
    voiceId: string = CHARACTER_VOICES.DEALER,
    settings = VOICE_SETTINGS.default
  ): Promise<ArrayBuffer> {
    if (!this.hasApiKey) {
      throw new Error('Missing ElevenLabs API key');
    }

    // Check cache first
    const cacheKey = `${voiceId}-${text}`;
    if (this.audioCache.has(cacheKey)) {
      const cached = this.audioCache.get(cacheKey)!;
      return this.base64ToArrayBuffer(cached);
    }

    const response = await fetch(`${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2',
        voice_settings: settings,
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.statusText}`);
    }

    const audioData = await response.arrayBuffer();

    // Cache the audio data
    this.audioCache.set(cacheKey, this.arrayBufferToBase64(audioData));

    return audioData;
  }

  /**
   * Play speech audio
   */
  async playSpeech(
    text: string,
    voiceId: string = CHARACTER_VOICES.DEALER,
    settings = VOICE_SETTINGS.default
  ): Promise<void> {
    if (!this.isBrowser) {
      // In SSR/tests we simply log the dialogue so it can be asserted
      console.info(`[voice disabled] ${text}`);
      return;
    }

    if (!this.supportsAudioContext || !this.hasApiKey) {
      await this.speakWithFallback(text);
      return;
    }

    try {
      const audioData = await this.generateSpeech(text, voiceId, settings);
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

    const settings = character.style === 'aggressive' ? VOICE_SETTINGS.excited :
                      character.style === 'cautious' ? VOICE_SETTINGS.calm :
                      character.style === 'mysterious' ? VOICE_SETTINGS.dramatic :
                      VOICE_SETTINGS.default;

    await this.playSpeech(phrase, character.voice, settings);
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

    await this.playSpeech(dialogue, character.voice, VOICE_SETTINGS.default);
  }

  /**
   * Queue multiple voice lines to play in sequence
   */
  async queueDialogue(dialogues: Array<{text: string, character: keyof typeof CHARACTER_PERSONALITIES, delay?: number}>): Promise<void> {
    for (const dialogue of dialogues) {
      const character = CHARACTER_PERSONALITIES[dialogue.character];
      await this.playSpeech(dialogue.text, character.voice, VOICE_SETTINGS.default);

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
      this.currentSource.connect(audioContext.destination);

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
    }

    return this.audioContext;
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
    if (!this.hasApiKey || !this.supportsAudioContext) {
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
        this.generateSpeech(phrase.text, phrase.voice).catch(console.error)
      )
    );
  }
}

// Export singleton instance
export const voiceService = new ElevenLabsService();
