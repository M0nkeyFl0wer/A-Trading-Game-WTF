import React, { useState, useEffect } from 'react';
import { voiceService, CHARACTER_PERSONALITIES, CHARACTER_VOICES } from '../lib/elevenlabs';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store';

interface VoiceControlsProps {
  onVoiceToggle?: (enabled: boolean) => void;
  className?: string;
}

export default function VoiceControls({ onVoiceToggle, className = '' }: VoiceControlsProps) {
  const voiceEnabled = useGameStore(state => state.isVoiceEnabled);
  const setVoiceEnabledStore = useGameStore(state => state.setVoiceEnabled);
  const globalCharacter = useGameStore(state => state.character);
  const setGlobalCharacter = useGameStore(state => state.setCharacter);
  const volume = useGameStore(state => state.volume);
  const setVolumeStore = useGameStore(state => state.setVolume);
  const [currentCharacter, setCurrentCharacter] = useState<keyof typeof CHARACTER_PERSONALITIES>(globalCharacter);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showCharacterMenu, setShowCharacterMenu] = useState(false);
  const [lastPhrase, setLastPhrase] = useState('');

  useEffect(() => {
    // Preload common phrases on mount
    voiceService.preloadCommonPhrases().catch(console.error);
  }, []);

  useEffect(() => {
    setCurrentCharacter(globalCharacter);
  }, [globalCharacter]);

  const toggleVoice = () => {
    const newState = !voiceEnabled;
    setVoiceEnabledStore(newState);
    onVoiceToggle?.(newState);

    if (!newState) {
      voiceService.stopSpeech();
    }
  };

  const playCharacterPhrase = async (character?: keyof typeof CHARACTER_PERSONALITIES) => {
    if (!voiceEnabled) return;

    const selectedCharacter = character || currentCharacter;
    setIsPlaying(true);
    setCurrentCharacter(selectedCharacter);
    setGlobalCharacter(selectedCharacter);

    try {
      const personality = CHARACTER_PERSONALITIES[selectedCharacter];
      const phrase = personality.catchphrases[Math.floor(Math.random() * personality.catchphrases.length)];
      setLastPhrase(phrase);

      await voiceService.playCharacterCatchphrase(selectedCharacter);
    } catch (error) {
      console.error('Error playing character phrase:', error);
    } finally {
      setIsPlaying(false);
    }
  };

  const testGameEvent = async (event: string) => {
    if (!voiceEnabled) return;

    setIsPlaying(true);
    try {
      await voiceService.announceGameEvent(event, 'Player 1', currentCharacter);
    } catch (error) {
      console.error('Error announcing game event:', error);
    } finally {
      setIsPlaying(false);
    }
  };

  const characterInfo = CHARACTER_PERSONALITIES[currentCharacter];

  return (
    <div className={`voice-controls ${className}`}>
      <motion.div
        className="voice-panel"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '16px',
          padding: '20px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
          color: 'white',
          minWidth: '320px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>🎙️ Voice Controls</h3>
          <button
            onClick={toggleVoice}
            style={{
              background: voiceEnabled ? '#4ade80' : '#ef4444',
              border: 'none',
              borderRadius: '20px',
              padding: '8px 16px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 'bold',
              transition: 'all 0.3s',
            }}
          >
            {voiceEnabled ? '🔊 ON' : '🔇 OFF'}
          </button>
        </div>

        {/* Current Character Display */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <span style={{ fontSize: '2rem' }}>
              {currentCharacter === 'DEALER' ? '🎰' :
               currentCharacter === 'BULL' ? '🐂' :
               currentCharacter === 'BEAR' ? '🐻' :
               currentCharacter === 'WHALE' ? '🐋' :
               currentCharacter === 'ROOKIE' ? '👶' : '🎭'}
            </span>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{characterInfo.name}</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                {characterInfo.traits.join(' • ')}
              </div>
            </div>
          </div>

          {/* Last phrase display */}
          <AnimatePresence mode="wait">
            {lastPhrase && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  padding: '10px',
                  marginTop: '10px',
                  fontStyle: 'italic',
                  fontSize: '0.9rem',
                }}
              >
                "{lastPhrase}"
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Character Selection */}
        <div style={{ marginBottom: '20px' }}>
          <button
            onClick={() => setShowCharacterMenu(!showCharacterMenu)}
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '8px',
              padding: '10px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.9rem',
              transition: 'all 0.3s',
            }}
          >
            🎭 Switch Character
          </button>

          <AnimatePresence>
            {showCharacterMenu && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '8px',
                  marginTop: '10px',
                }}
              >
                {Object.entries(CHARACTER_PERSONALITIES).map(([key, char]) => (
                  <button
                    key={key}
                    onClick={() => {
                      const nextCharacter = key as keyof typeof CHARACTER_PERSONALITIES;
                      setCurrentCharacter(nextCharacter);
                      setGlobalCharacter(nextCharacter);
                      setShowCharacterMenu(false);
                      playCharacterPhrase(nextCharacter);
                    }}
                    disabled={isPlaying}
                    style={{
                      background: currentCharacter === key ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '6px',
                      padding: '8px',
                      color: 'white',
                      cursor: isPlaying ? 'not-allowed' : 'pointer',
                      fontSize: '0.8rem',
                      transition: 'all 0.2s',
                    }}
                  >
                    {key === 'DEALER' ? '🎰' :
                     key === 'BULL' ? '🐂' :
                     key === 'BEAR' ? '🐻' :
                     key === 'WHALE' ? '🐋' :
                     '👶'} {char.name}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          <button
            onClick={() => playCharacterPhrase()}
            disabled={!voiceEnabled || isPlaying}
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '8px',
              padding: '12px',
              color: 'white',
              cursor: !voiceEnabled || isPlaying ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              fontWeight: 'bold',
              opacity: !voiceEnabled || isPlaying ? 0.5 : 1,
              transition: 'all 0.3s',
            }}
          >
            {isPlaying ? '🎵 Playing...' : '🗣️ Say Phrase'}
          </button>

          <button
            onClick={() => testGameEvent('game.start')}
            disabled={!voiceEnabled || isPlaying}
            style={{
              background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '8px',
              padding: '12px',
              color: 'white',
              cursor: !voiceEnabled || isPlaying ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              fontWeight: 'bold',
              opacity: !voiceEnabled || isPlaying ? 0.5 : 1,
              transition: 'all 0.3s',
            }}
          >
            🎮 Test Event
          </button>

          <button
            onClick={() => testGameEvent('round.reveal')}
            disabled={!voiceEnabled || isPlaying}
            style={{
              background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '8px',
              padding: '12px',
              color: 'white',
              cursor: !voiceEnabled || isPlaying ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              fontWeight: 'bold',
              opacity: !voiceEnabled || isPlaying ? 0.5 : 1,
              transition: 'all 0.3s',
            }}
          >
            📊 Reveal
          </button>

          <button
            onClick={() => voiceService.stopSpeech()}
            disabled={!isPlaying}
            style={{
              background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '8px',
              padding: '12px',
              color: 'white',
              cursor: !isPlaying ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              fontWeight: 'bold',
              opacity: !isPlaying ? 0.5 : 1,
              transition: 'all 0.3s',
            }}
          >
            ⏹️ Stop
          </button>
        </div>

        {/* Volume Control */}
        <div style={{ marginTop: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.9rem' }}>🔊</span>
            <input
              type="range"
              min="0"
              max="100"
              value={volume * 100}
              onChange={(e) => setVolumeStore(Number(e.target.value) / 100)}
              style={{
                flex: 1,
                height: '4px',
                background: 'rgba(255,255,255,0.3)',
                borderRadius: '2px',
                outline: 'none',
                cursor: 'pointer',
              }}
            />
            <span style={{ fontSize: '0.9rem', minWidth: '40px' }}>
              {Math.round(volume * 100)}%
            </span>
          </label>
        </div>
      </motion.div>
    </div>
  );
}
