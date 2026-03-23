import { useGameStore } from '../store';
import { voiceService } from '../lib/elevenlabs';

interface VoiceControlsMiniProps {
  className?: string;
}

/**
 * Minimal voice controls: on/off toggle + volume slider.
 * Replaces the bloated VoiceControls panel that had debug buttons.
 */
export default function VoiceControlsMini({ className = '' }: VoiceControlsMiniProps) {
  const voiceEnabled = useGameStore(state => state.isVoiceEnabled);
  const setVoiceEnabled = useGameStore(state => state.setVoiceEnabled);
  const volume = useGameStore(state => state.volume);
  const setVolume = useGameStore(state => state.setVolume);

  const toggleVoice = () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    if (!next) {
      voiceService.stopSpeech();
    }
  };

  return (
    <div className={`voice-mini ${className}`} aria-label="Voice controls">
      <button
        type="button"
        className={`voice-mini__toggle ${voiceEnabled ? 'voice-mini__toggle--on' : 'voice-mini__toggle--off'}`}
        onClick={toggleVoice}
        aria-pressed={voiceEnabled}
      >
        {voiceEnabled ? 'Voice ON' : 'Voice OFF'}
      </button>
      <input
        type="range"
        className="voice-mini__slider"
        min={0}
        max={100}
        value={Math.round(volume * 100)}
        onChange={(e) => setVolume(Number(e.target.value) / 100)}
        disabled={!voiceEnabled}
        aria-label="Voice volume"
      />
      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: 36, textAlign: 'right' }}>
        {Math.round(volume * 100)}%
      </span>
    </div>
  );
}
