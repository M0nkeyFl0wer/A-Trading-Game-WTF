# 🎰 A-Trading-Game-WTF - Claude Development Guide

## 📋 Project Overview

This is a voice-enabled, character-driven trading game with real-time multiplayer capabilities, animated character avatars, and production-ready infrastructure.

**Repository**: https://github.com/M0nkeyFl0wer/A-Trading-Game-WTF
**Current Branch**: main
**Dev Server**: http://localhost:3001

## 🚀 Quick Commands

```bash
# Start development
cd apps/web && pnpm dev

# Build all packages
pnpm --filter @trading-game/shared build
pnpm --filter @trading-game/core build
pnpm --filter @trading-game/bot build

# Run tests
pnpm test

# Deploy to production
vercel --prod
```

## 🏗️ Architecture Overview

### Tech Stack
- **Frontend**: React 18.2 + TypeScript 5.4
- **Styling**: CSS-in-JS + Framer Motion
- **State**: Zustand
- **Voice**: ElevenLabs API
- **Backend**: Firebase (Auth + Realtime DB)
- **Multiplayer**: Socket.io + Firebase
- **Web3**: Wagmi v2 + Viem v2
- **Build**: Vite + pnpm workspaces
- **Deploy**: Vercel + GitHub Actions

### Project Structure
```
├── apps/web/                 # Main React application
│   ├── src/
│   │   ├── lib/             # Core libraries
│   │   │   ├── elevenlabs.ts       # Voice synthesis service
│   │   │   ├── characterVisuals.ts # Character avatar system
│   │   │   ├── firebase.ts         # Firebase configuration
│   │   │   └── gameRoom.ts         # Multiplayer room management
│   │   ├── ui/              # UI Components
│   │   │   ├── VoiceControls.tsx   # Voice control panel
│   │   │   ├── CharacterAvatar.tsx # Animated character display
│   │   │   └── CharacterGallery.tsx # Character selection
│   │   ├── hooks/           # Custom React hooks
│   │   │   ├── useGameVoice.ts     # Voice integration hook
│   │   │   └── useBotAI.ts         # AI player logic
│   │   ├── pages/           # Page components
│   │   │   ├── LobbyPage.tsx       # Game lobby with characters
│   │   │   └── TablePage.tsx       # Game table with voice
│   │   └── contexts/        # React contexts
│   │       └── AuthContext.tsx     # Firebase authentication
├── packages/
│   ├── shared/              # Shared types and utilities
│   ├── core/                # Game logic engine
│   ├── bot/                 # AI player implementations
│   └── contract/            # Smart contracts (future)
├── api/                     # Serverless API functions
└── .github/workflows/       # CI/CD pipelines
```

## 🎭 Character System

### Voice Characters (ElevenLabs)
1. **The Dealer** (EXAVITQu4vr4xnSDxMaL) - Professional narrator
2. **Bull Runner** (21m00Tcm4TlvDq8ikWAM) - Optimistic trader
3. **Bear Necessities** (AZnzlk1XvdvUeBnXmlld) - Pessimistic analyst
4. **The Whale** (pNInz6obpgDQGcFmaJgB) - Big player
5. **Fresh Trader** (yoZ06aMxZJJ28mfd3POQ) - Enthusiastic rookie

### Visual System
- **8 Expressions**: neutral, happy, sad, excited, worried, thinking, celebrating, shocked
- **Canvas Animations**: Particle effects, pulsing, rings
- **ASCII Art**: Retro character representations
- **Auto-Animation**: Idle expression cycling

## 🔑 Environment Variables

### Required for Development
```env
# ElevenLabs Voice API
VITE_ELEVENLABS_API_KEY=your_elevenlabs_api_key_here

# Firebase Configuration
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Web3 Configuration (optional)
VITE_WALLET_CONNECT_PROJECT_ID=
VITE_ALCHEMY_API_KEY=
```

## 🎮 Game Features

### Implemented ✅
- Voice-enabled character system
- Visual character avatars with expressions
- Character selection gallery
- Voice control panel with volume
- Firebase authentication setup
- Multiplayer room management
- Real-time game state sync
- CI/CD pipeline with GitHub Actions
- Vercel deployment configuration

### In Progress 🚧
- Complete game logic implementation
- Mobile responsive design
- Comprehensive test coverage

### Planned 📅
- AI opponent personalities
- Tournament mode
- Leaderboards
- Web3 micro-stakes
- Mobile app

## 🔊 Voice Integration Details

### ElevenLabs Service (`lib/elevenlabs.ts`)
- **Text-to-Speech**: Converts dialogue to voice
- **Character Voices**: 5 unique voice IDs
- **Voice Settings**: Different emotional tones
- **Audio Caching**: Stores generated audio
- **Queue Management**: Sequential dialogue playback

### Voice Hook (`hooks/useGameVoice.ts`)
- **Auto-announcements**: Game events trigger voice
- **Context-aware**: Different reactions based on game state
- **Character reactions**: Personality-specific responses
- **Queue system**: Manages multiple voice lines

### Voice Controls (`ui/VoiceControls.tsx`)
- **On/Off Toggle**: Enable/disable voice
- **Character Selection**: Switch between personalities
- **Volume Control**: Adjust voice volume
- **Test Buttons**: Preview character voices
- **Visual Feedback**: Shows current phrase

## 🎨 Visual Character System

### Character Visuals (`lib/characterVisuals.ts`)
- **Expression Types**: 8 different emotions
- **Character Configs**: Colors, gradients, emojis
- **ASCII Art**: Text-based character representations
- **Animation Sequences**: Idle, winning, losing, trading

### Character Avatar (`ui/CharacterAvatar.tsx`)
- **Canvas Animation**: Dynamic particle effects
- **Expression Changes**: Smooth transitions
- **Size Options**: Small, medium, large
- **Auto-Animation**: Idle expression cycling
- **Visual Effects**: Particles, rings, pulsing

### Character Gallery (`ui/CharacterGallery.tsx`)
- **Interactive Selection**: Click to choose character
- **Voice Integration**: Plays catchphrase on selection
- **Trait Comparison**: Visual risk level display
- **Hover Effects**: Preview character personality

## 🚀 Deployment

### GitHub Actions CI/CD
- **Build Pipeline**: Tests and builds on push
- **Matrix Testing**: Node 18.x and 20.x
- **Artifact Upload**: Stores build outputs
- **Auto-deploy**: Pushes to Vercel on main

### Vercel Configuration
- **Build Command**: `pnpm -r build && pnpm --filter @trading-game/web build`
- **Output Directory**: `apps/web/dist`
- **Environment Variables**: Set in Vercel dashboard
- **Serverless Functions**: API routes in `/api`

## 🐛 Known Issues

1. **Viem Version**: Had to upgrade to v2 for wagmi compatibility
2. **TypeScript**: verbatimModuleSyntax requires type-only imports
3. **Emulators**: Firebase emulators need sessionStorage flag
4. **Build Order**: Packages must build before web app

## 📝 Development Notes

### Best Practices
- Always build packages before running dev server
- Use type-only imports for TypeScript types
- Test voice features with actual API key
- Check console for WebSocket connections
- Monitor Firebase usage for costs

### Testing Voice Features
1. Open lobby page
2. Click character to hear voice
3. Test different emotional states
4. Check volume controls
5. Verify character animations sync

### Adding New Characters
1. Add voice ID to `CHARACTER_VOICES`
2. Create personality in `CHARACTER_PERSONALITIES`
3. Add visual config to `CHARACTER_VISUALS`
4. Update character gallery
5. Test voice and visuals

## 🔧 Troubleshooting

### Common Issues

**Dev server won't start**
```bash
# Rebuild packages
pnpm --filter @trading-game/shared build
pnpm --filter @trading-game/core build
pnpm --filter @trading-game/bot build
```

**Voice not working**
- Check ElevenLabs API key in .env
- Verify browser allows audio
- Check console for API errors
- Test with different character

**Firebase connection issues**
- Verify Firebase config in .env
- Check Firebase console for project status
- Ensure Realtime Database is enabled
- Check security rules

## 📚 Resources

- **ElevenLabs Docs**: https://docs.elevenlabs.io
- **Firebase Docs**: https://firebase.google.com/docs
- **Wagmi Docs**: https://wagmi.sh
- **Vercel Docs**: https://vercel.com/docs

## 🤝 Contributing Guidelines

1. **Branch Naming**: feature/description or fix/description
2. **Commit Messages**: Use conventional commits
3. **Testing**: Add tests for new features
4. **Documentation**: Update README and CLAUDE.md
5. **Code Style**: Follow existing patterns

## 📞 Contact & Support

- **GitHub Issues**: Report bugs and feature requests
- **Discussions**: Community Q&A
- **Owner**: @M0nkeyFl0wer

---

*Last Updated: 2025*
*Claude Code Assistant Ready* 🤖