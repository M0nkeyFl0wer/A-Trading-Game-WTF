export declare const CHARACTER_VOICES: {
    readonly DEALER: "EXAVITQu4vr4xnSDxMaL";
    readonly BULL: "21m00Tcm4TlvDq8ikWAM";
    readonly BEAR: "AZnzlk1XvdvUeBnXmlld";
    readonly WHALE: "pNInz6obpgDQGcFmaJgB";
    readonly ROOKIE: "yoZ06aMxZJJ28mfd3POQ";
    readonly ANNOUNCER: "ThT5KcBeYPX3keUQqHPh";
};
export type CharacterVoice = typeof CHARACTER_VOICES[keyof typeof CHARACTER_VOICES];
export declare const VOICE_SETTINGS: {
    readonly default: {
        readonly stability: 0.5;
        readonly similarity_boost: 0.75;
        readonly style: 0.5;
        readonly use_speaker_boost: true;
    };
    readonly excited: {
        readonly stability: 0.3;
        readonly similarity_boost: 0.8;
        readonly style: 0.7;
        readonly use_speaker_boost: true;
    };
    readonly calm: {
        readonly stability: 0.7;
        readonly similarity_boost: 0.7;
        readonly style: 0.3;
        readonly use_speaker_boost: true;
    };
    readonly dramatic: {
        readonly stability: 0.4;
        readonly similarity_boost: 0.85;
        readonly style: 0.8;
        readonly use_speaker_boost: true;
    };
};
export type VoiceStyle = keyof typeof VOICE_SETTINGS;
export type VoiceSetting = (typeof VOICE_SETTINGS)[VoiceStyle];
export declare const DEFAULT_VOICE_ID: CharacterVoice;
export declare const DEFAULT_VOICE_STYLE: VoiceStyle;
export declare const isValidVoiceId: (voiceId: string) => voiceId is CharacterVoice;
export declare const isValidVoiceStyle: (style: string) => style is VoiceStyle;
//# sourceMappingURL=voice.d.ts.map