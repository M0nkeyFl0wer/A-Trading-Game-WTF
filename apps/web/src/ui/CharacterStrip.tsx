import type { CharacterType } from '../lib/characterVisuals';
import { CHARACTER_PERSONALITIES } from '../lib/elevenlabs';

const CHARACTER_EMOJI: Record<string, string> = {
  DEALER: '🎰',
  BULL: '🐂',
  BEAR: '🐻',
  WHALE: '🐋',
  ROOKIE: '👶',
};

const characters: CharacterType[] = ['DEALER', 'BULL', 'BEAR', 'WHALE', 'ROOKIE'];

interface CharacterStripProps {
  selectedCharacter: CharacterType;
  onCharacterSelect: (character: CharacterType) => void;
}

export default function CharacterStrip({
  selectedCharacter,
  onCharacterSelect,
}: CharacterStripProps) {
  return (
    <div className="character-strip" role="radiogroup" aria-label="Choose your trading persona">
      {characters.map((char) => {
        const personality = CHARACTER_PERSONALITIES[char];
        const isSelected = selectedCharacter === char;
        return (
          <button
            key={char}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={`character-chip${isSelected ? ' character-chip--selected' : ''}`}
            onClick={() => onCharacterSelect(char)}
          >
            <span className="character-chip__emoji" aria-hidden="true">
              {CHARACTER_EMOJI[char] ?? '🎭'}
            </span>
            <span className="character-chip__name">
              {personality.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
