// Character Visual System - Avatar representations and expressions

export type CharacterExpression = 'neutral' | 'happy' | 'sad' | 'excited' | 'worried' | 'thinking' | 'celebrating' | 'shocked';

export type CharacterType = 'DEALER' | 'BULL' | 'BEAR' | 'WHALE' | 'ROOKIE';

// Character visual configurations with emoji-based avatars and ASCII art
export const CHARACTER_VISUALS: Record<CharacterType, {
  name: string;
  baseEmoji: string;
  color: string;
  gradient: string;
  expressions: Record<CharacterExpression, {
    emoji: string;
    asciiArt: string[];
  }>;
}> = {
  DEALER: {
    name: 'The Dealer',
    baseEmoji: '🎰',
    color: '#6366f1',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    expressions: {
      neutral: {
        emoji: '🎰',
        asciiArt: [
          '    ┌─────┐    ',
          '    │ ♠ ♥ │    ',
          '    │  🎰  │    ',
          '    │ ♣ ♦ │    ',
          '    └─────┘    ',
        ],
      },
      happy: {
        emoji: '🎊',
        asciiArt: [
          '    ┌─────┐    ',
          '    │ ★ ★ │    ',
          '    │  😊  │    ',
          '    │ ♠ ♥ │    ',
          '    └─────┘    ',
        ],
      },
      sad: {
        emoji: '🎲',
        asciiArt: [
          '    ┌─────┐    ',
          '    │ • • │    ',
          '    │  😔  │    ',
          '    │ ♣ ♦ │    ',
          '    └─────┘    ',
        ],
      },
      excited: {
        emoji: '🎉',
        asciiArt: [
          '    ┌─────┐    ',
          '    │ ✨✨ │    ',
          '    │  🤩  │    ',
          '    │ ♠ ♥ │    ',
          '    └─────┘    ',
        ],
      },
      worried: {
        emoji: '🎯',
        asciiArt: [
          '    ┌─────┐    ',
          '    │ ? ? │    ',
          '    │  😟  │    ',
          '    │ ♣ ♦ │    ',
          '    └─────┘    ',
        ],
      },
      thinking: {
        emoji: '🤔',
        asciiArt: [
          '    ┌─────┐    ',
          '    │ ... │    ',
          '    │  🤔  │    ',
          '    │ ♠ ♥ │    ',
          '    └─────┘    ',
        ],
      },
      celebrating: {
        emoji: '🎊',
        asciiArt: [
          '    ┌─────┐    ',
          '    │ 🎉🎉 │    ',
          '    │  🥳  │    ',
          '    │ ★ ★ │    ',
          '    └─────┘    ',
        ],
      },
      shocked: {
        emoji: '😱',
        asciiArt: [
          '    ┌─────┐    ',
          '    │ ! ! │    ',
          '    │  😱  │    ',
          '    │ ♠ ♥ │    ',
          '    └─────┘    ',
        ],
      },
    },
  },
  BULL: {
    name: 'Bull Runner',
    baseEmoji: '🐂',
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
    expressions: {
      neutral: {
        emoji: '🐂',
        asciiArt: [
          '     ♉♉♉     ',
          '    /   \\    ',
          '   ( 🐂  )   ',
          '    \\___/    ',
          '    📈📈📈    ',
        ],
      },
      happy: {
        emoji: '🚀',
        asciiArt: [
          '     🚀🚀🚀     ',
          '    /   \\    ',
          '   ( 😄  )   ',
          '    \\___/    ',
          '    📈📈📈    ',
        ],
      },
      sad: {
        emoji: '📉',
        asciiArt: [
          '     ...     ',
          '    /   \\    ',
          '   ( 😢  )   ',
          '    \\___/    ',
          '    📉📉📉    ',
        ],
      },
      excited: {
        emoji: '🎯',
        asciiArt: [
          '    🌟🌟🌟    ',
          '    /   \\    ',
          '   ( 🤩  )   ',
          '    \\___/    ',
          '    🚀🚀🚀    ',
        ],
      },
      worried: {
        emoji: '😰',
        asciiArt: [
          '     ???     ',
          '    /   \\    ',
          '   ( 😰  )   ',
          '    \\___/    ',
          '    📊📊📊    ',
        ],
      },
      thinking: {
        emoji: '💭',
        asciiArt: [
          '     💭💭     ',
          '    /   \\    ',
          '   ( 🤔  )   ',
          '    \\___/    ',
          '    📈?📉    ',
        ],
      },
      celebrating: {
        emoji: '🎉',
        asciiArt: [
          '    🎉🎉🎉    ',
          '    /   \\    ',
          '   ( 🥳  )   ',
          '    \\___/    ',
          '    💰💰💰    ',
        ],
      },
      shocked: {
        emoji: '🤯',
        asciiArt: [
          '    !!!!!!    ',
          '    /   \\    ',
          '   ( 🤯  )   ',
          '    \\___/    ',
          '    📈!!!    ',
        ],
      },
    },
  },
  BEAR: {
    name: 'Bear Necessities',
    baseEmoji: '🐻',
    color: '#ef4444',
    gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    expressions: {
      neutral: {
        emoji: '🐻',
        asciiArt: [
          '    ʕ•ᴥ•ʔ    ',
          '   /     \\   ',
          '  (  🐻   )  ',
          '   \\_____/   ',
          '    📉📉📉    ',
        ],
      },
      happy: {
        emoji: '😏',
        asciiArt: [
          '    ʕ•ᴥ•ʔ    ',
          '   /     \\   ',
          '  (  😏   )  ',
          '   \\_____/   ',
          '    💹💹💹    ',
        ],
      },
      sad: {
        emoji: '😔',
        asciiArt: [
          '    ʕ•︵•ʔ    ',
          '   /     \\   ',
          '  (  😔   )  ',
          '   \\_____/   ',
          '    📉📉📉    ',
        ],
      },
      excited: {
        emoji: '🎯',
        asciiArt: [
          '    ʕ!ᴥ!ʔ    ',
          '   /     \\   ',
          '  (  😈   )  ',
          '   \\_____/   ',
          '    🔻🔻🔻    ',
        ],
      },
      worried: {
        emoji: '😟',
        asciiArt: [
          '    ʕ?ᴥ?ʔ    ',
          '   /     \\   ',
          '  (  😟   )  ',
          '   \\_____/   ',
          '    ⚠️⚠️⚠️    ',
        ],
      },
      thinking: {
        emoji: '🧐',
        asciiArt: [
          '    ʕ...ʔ    ',
          '   /     \\   ',
          '  (  🧐   )  ',
          '   \\_____/   ',
          '    📊📊📊    ',
        ],
      },
      celebrating: {
        emoji: '🎊',
        asciiArt: [
          '    ʕ★ᴥ★ʔ    ',
          '   /     \\   ',
          '  (  🥳   )  ',
          '   \\_____/   ',
          '    💸💸💸    ',
        ],
      },
      shocked: {
        emoji: '😨',
        asciiArt: [
          '    ʕ!!!ʔ    ',
          '   /     \\   ',
          '  (  😨   )  ',
          '   \\_____/   ',
          '    ‼️‼️‼️    ',
        ],
      },
    },
  },
  WHALE: {
    name: 'The Whale',
    baseEmoji: '🐋',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    expressions: {
      neutral: {
        emoji: '🐋',
        asciiArt: [
          '   ╭─────╮   ',
          '  │ 🌊🌊🌊 │  ',
          '  │  🐋   │  ',
          '  │ 💎💎💎 │  ',
          '   ╰─────╯   ',
        ],
      },
      happy: {
        emoji: '🏆',
        asciiArt: [
          '   ╭─────╮   ',
          '  │ 👑👑👑 │  ',
          '  │  😌   │  ',
          '  │ 💰💰💰 │  ',
          '   ╰─────╯   ',
        ],
      },
      sad: {
        emoji: '💔',
        asciiArt: [
          '   ╭─────╮   ',
          '  │ 💔💔💔 │  ',
          '  │  😞   │  ',
          '  │ 📉📉📉 │  ',
          '   ╰─────╯   ',
        ],
      },
      excited: {
        emoji: '💎',
        asciiArt: [
          '   ╭─────╮   ',
          '  │ 💎💎💎 │  ',
          '  │  😎   │  ',
          '  │ 🚀🚀🚀 │  ',
          '   ╰─────╯   ',
        ],
      },
      worried: {
        emoji: '🌊',
        asciiArt: [
          '   ╭─────╮   ',
          '  │ 🌊🌊🌊 │  ',
          '  │  😐   │  ',
          '  │ ???   │  ',
          '   ╰─────╯   ',
        ],
      },
      thinking: {
        emoji: '🎯',
        asciiArt: [
          '   ╭─────╮   ',
          '  │ 🎯🎯🎯 │  ',
          '  │  🤔   │  ',
          '  │ 📈📉📊 │  ',
          '   ╰─────╯   ',
        ],
      },
      celebrating: {
        emoji: '🏆',
        asciiArt: [
          '   ╭─────╮   ',
          '  │ 🏆🏆🏆 │  ',
          '  │  🥳   │  ',
          '  │ 🎉🎉🎉 │  ',
          '   ╰─────╯   ',
        ],
      },
      shocked: {
        emoji: '🌪️',
        asciiArt: [
          '   ╭─────╮   ',
          '  │ ⚡⚡⚡ │  ',
          '  │  😱   │  ',
          '  │ 🌪️🌪️🌪️ │  ',
          '   ╰─────╯   ',
        ],
      },
    },
  },
  ROOKIE: {
    name: 'Fresh Trader',
    baseEmoji: '👶',
    color: '#eab308',
    gradient: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
    expressions: {
      neutral: {
        emoji: '👶',
        asciiArt: [
          '    ○○○○○    ',
          '   │     │   ',
          '   │ 👶  │   ',
          '   │     │   ',
          '    📚📚📚    ',
        ],
      },
      happy: {
        emoji: '😃',
        asciiArt: [
          '    ★★★★★    ',
          '   │     │   ',
          '   │ 😃  │   ',
          '   │     │   ',
          '    🎈🎈🎈    ',
        ],
      },
      sad: {
        emoji: '😭',
        asciiArt: [
          '    .....    ',
          '   │     │   ',
          '   │ 😭  │   ',
          '   │     │   ',
          '    💧💧💧    ',
        ],
      },
      excited: {
        emoji: '🤗',
        asciiArt: [
          '    !!!!!    ',
          '   │     │   ',
          '   │ 🤗  │   ',
          '   │     │   ',
          '    🎮🎮🎮    ',
        ],
      },
      worried: {
        emoji: '😰',
        asciiArt: [
          '    ?????    ',
          '   │     │   ',
          '   │ 😰  │   ',
          '   │     │   ',
          '    ❓❓❓    ',
        ],
      },
      thinking: {
        emoji: '🤓',
        asciiArt: [
          '    .....    ',
          '   │     │   ',
          '   │ 🤓  │   ',
          '   │     │   ',
          '    📖📖📖    ',
        ],
      },
      celebrating: {
        emoji: '🥳',
        asciiArt: [
          '    🎉🎉🎉    ',
          '   │     │   ',
          '   │ 🥳  │   ',
          '   │     │   ',
          '    🍾🍾🍾    ',
        ],
      },
      shocked: {
        emoji: '🤯',
        asciiArt: [
          '    💥💥💥    ',
          '   │     │   ',
          '   │ 🤯  │   ',
          '   │     │   ',
          '    ‼️‼️‼️    ',
        ],
      },
    },
  },
};

// Function to get expression based on game context
export function getExpressionForContext(
  context: string,
  value?: number
): CharacterExpression {
  const contextMap: Record<string, CharacterExpression> = {
    'game.start': 'excited',
    'game.win': 'celebrating',
    'game.lose': 'sad',
    'round.start': 'neutral',
    'round.reveal': 'thinking',
    'trade.big': value && value > 10 ? 'excited' : 'worried',
    'trade.loss': 'sad',
    'trade.win': 'happy',
    'waiting': 'thinking',
    'timeout': 'worried',
    'close_call': 'shocked',
  };

  return contextMap[context] || 'neutral';
}

// Animation sequences for different situations
export const EXPRESSION_SEQUENCES: Record<string, CharacterExpression[]> = {
  idle: ['neutral', 'thinking', 'neutral', 'happy'],
  winning: ['happy', 'excited', 'celebrating'],
  losing: ['worried', 'sad', 'shocked'],
  trading: ['thinking', 'excited', 'neutral'],
  waiting: ['neutral', 'thinking', 'worried', 'neutral'],
};

// Function to cycle through expressions
export function* expressionCycler(sequence: CharacterExpression[]): Generator<CharacterExpression> {
  let index = 0;
  while (true) {
    yield sequence[index];
    index = (index + 1) % sequence.length;
  }
}