import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import CharacterAvatar from './CharacterAvatar';
import { CharacterType, CharacterExpression, getExpressionForContext } from '../lib/characterVisuals';
import { voiceService, CHARACTER_PERSONALITIES } from '../lib/elevenlabs';

interface CharacterGalleryProps {
  onCharacterSelect?: (character: CharacterType) => void;
  selectedCharacter?: CharacterType;
  gameContext?: string;
  enableVoice?: boolean;
}

export default function CharacterGallery({
  onCharacterSelect,
  selectedCharacter = 'DEALER',
  gameContext = 'idle',
  enableVoice = true,
}: CharacterGalleryProps) {
  const [hoveredCharacter, setHoveredCharacter] = useState<CharacterType | null>(null);
  const [expressions, setExpressions] = useState<Record<CharacterType, CharacterExpression>>({
    DEALER: 'neutral',
    BULL: 'neutral',
    BEAR: 'neutral',
    WHALE: 'neutral',
    ROOKIE: 'neutral',
  });

  // Update expressions based on game context
  useEffect(() => {
    const contextExpression = getExpressionForContext(gameContext);
    setExpressions(prev => {
      const newExpressions = { ...prev };
      Object.keys(newExpressions).forEach(char => {
        newExpressions[char as CharacterType] = contextExpression;
      });
      return newExpressions;
    });
  }, [gameContext]);

  const handleCharacterClick = async (character: CharacterType) => {
    onCharacterSelect?.(character);

    // Play character's catchphrase when selected
    if (enableVoice) {
      try {
        await voiceService.playCharacterCatchphrase(character);
      } catch (error) {
        console.error('Error playing character voice:', error);
      }
    }

    // Trigger celebration expression
    setExpressions(prev => ({
      ...prev,
      [character]: 'celebrating',
    }));

    setTimeout(() => {
      setExpressions(prev => ({
        ...prev,
        [character]: 'neutral',
      }));
    }, 3000);
  };

  const handleCharacterHover = (character: CharacterType | null) => {
    setHoveredCharacter(character);
    if (character) {
      setExpressions(prev => ({
        ...prev,
        [character]: 'happy',
      }));
    } else if (hoveredCharacter) {
      setExpressions(prev => ({
        ...prev,
        [hoveredCharacter]: 'neutral',
      }));
    }
  };

  const characters: CharacterType[] = ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'];

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: '20px',
        padding: '30px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}
    >
      <h2 style={{
        color: 'white',
        textAlign: 'center',
        fontSize: '2rem',
        marginBottom: '30px',
        fontWeight: 'bold',
      }}>
        🎭 Choose Your Trading Persona
      </h2>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '30px',
        marginBottom: '30px',
      }}>
        {characters.map((character) => {
          const personality = CHARACTER_PERSONALITIES[character];
          const isSelected = selectedCharacter === character;
          const isHovered = hoveredCharacter === character;

          return (
            <motion.div
              key={character}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              style={{
                position: 'relative',
                cursor: 'pointer',
                padding: '20px',
                background: isSelected
                  ? 'rgba(255,255,255,0.2)'
                  : 'rgba(255,255,255,0.1)',
                borderRadius: '15px',
                border: isSelected
                  ? '3px solid white'
                  : '3px solid transparent',
                transition: 'all 0.3s',
              }}
              onClick={() => handleCharacterClick(character)}
              onMouseEnter={() => handleCharacterHover(character)}
              onMouseLeave={() => handleCharacterHover(null)}
            >
              <CharacterAvatar
                character={character}
                expression={expressions[character]}
                autoAnimate={isHovered || isSelected}
                size="small"
                showAsciiArt={isHovered}
              />

              <div style={{
                marginTop: '70px',
                textAlign: 'center',
                color: 'white',
              }}>
                <h3 style={{
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  marginBottom: '5px',
                }}>
                  {personality.name}
                </h3>

                <p style={{
                  fontSize: '0.8rem',
                  opacity: 0.8,
                  marginBottom: '10px',
                }}>
                  {personality.traits.join(' • ')}
                </p>

                {(isHovered || isSelected) && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      fontSize: '0.9rem',
                      fontStyle: 'italic',
                      padding: '10px',
                      background: 'rgba(0,0,0,0.3)',
                      borderRadius: '8px',
                      marginTop: '10px',
                    }}
                  >
                    "{personality.catchphrases[0]}"
                  </motion.div>
                )}
              </div>

              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  style={{
                    position: 'absolute',
                    top: '10px',
                    right: '10px',
                    background: 'white',
                    color: '#667eea',
                    borderRadius: '50%',
                    width: '30px',
                    height: '30px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                  }}
                >
                  ✓
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Character comparison stats */}
      <div style={{
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '15px',
        padding: '20px',
        color: 'white',
      }}>
        <h3 style={{
          fontSize: '1.2rem',
          marginBottom: '15px',
          textAlign: 'center',
        }}>
          📊 Character Traits Comparison
        </h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '10px',
          textAlign: 'center',
        }}>
          {characters.map(char => (
            <div key={char}>
              <div style={{ fontSize: '2rem', marginBottom: '5px' }}>
                {char === 'DEALER' ? '🎰' :
                 char === 'BULL' ? '🐂' :
                 char === 'BEAR' ? '🐻' :
                 char === 'WHALE' ? '🐋' : '👶'}
              </div>
              <div style={{
                fontSize: '0.7rem',
                opacity: 0.8,
              }}>
                {CHARACTER_PERSONALITIES[char].style}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '20px' }}>
          <div style={{ marginBottom: '10px' }}>
            <span style={{ display: 'inline-block', width: '100px' }}>Risk Level:</span>
            <div style={{ display: 'inline-flex', gap: '20px' }}>
              {characters.map(char => (
                <div key={char} style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '10px',
                    height: char === 'BULL' ? '40px' :
                            char === 'ROOKIE' ? '35px' :
                            char === 'WHALE' ? '30px' :
                            char === 'DEALER' ? '20px' : '10px',
                    background: char === 'BULL' ? '#10b981' :
                               char === 'ROOKIE' ? '#eab308' :
                               char === 'WHALE' ? '#8b5cf6' :
                               char === 'DEALER' ? '#6366f1' : '#ef4444',
                    borderRadius: '5px',
                    margin: '0 auto',
                  }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Voice test button */}
      {enableVoice && (
        <div style={{
          marginTop: '20px',
          textAlign: 'center',
        }}>
          <button
            onClick={async () => {
              const randomChar = characters[Math.floor(Math.random() * characters.length)];
              handleCharacterClick(randomChar);
            }}
            style={{
              background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
              border: 'none',
              borderRadius: '30px',
              padding: '12px 30px',
              color: 'white',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
              transition: 'transform 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            🎲 Random Character Voice
          </button>
        </div>
      )}
    </div>
  );
}