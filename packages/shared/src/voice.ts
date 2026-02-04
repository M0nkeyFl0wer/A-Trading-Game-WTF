export const CHARACTER_VOICES = {
  DEALER: 'EXAVITQu4vr4xnSDxMaL',
  BULL: '21m00Tcm4TlvDq8ikWAM',
  BEAR: 'AZnzlk1XvdvUeBnXmlld',
  WHALE: 'pNInz6obpgDQGcFmaJgB',
  ROOKIE: 'yoZ06aMxZJJ28mfd3POQ',
  ANNOUNCER: 'ThT5KcBeYPX3keUQqHPh',
} as const;

export type CharacterVoice = typeof CHARACTER_VOICES[keyof typeof CHARACTER_VOICES];

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
} as const;

export type VoiceStyle = keyof typeof VOICE_SETTINGS;
export type VoiceSetting = (typeof VOICE_SETTINGS)[VoiceStyle];

export const DEFAULT_VOICE_ID: CharacterVoice = CHARACTER_VOICES.DEALER;
export const DEFAULT_VOICE_STYLE: VoiceStyle = 'default';

export const isValidVoiceId = (voiceId: string): voiceId is CharacterVoice =>
  Object.values(CHARACTER_VOICES).includes(voiceId as CharacterVoice);

export const isValidVoiceStyle = (style: string): style is VoiceStyle =>
  style in VOICE_SETTINGS;
