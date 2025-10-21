# 🎰 The Trading Game – Open Strategy Project

A **voice-enabled**, **character-driven** trading game that brings markets to life through personality, sound, and social play. Learn trading through interactive characters who speak, react, and guide you through the excitement of the trading floor.

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![React](https://img.shields.io/badge/React-18.2-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io/)

## 🎮 Play Now

**Development Server Running**: http://localhost:3001

## ✨ Features

### 🎙️ **Voice-Enabled Characters**
- **5 Unique Trading Personalities** with distinct voices via ElevenLabs API
- Real-time voice announcements for game events
- Character catchphrases and contextual dialogue
- Emotional voice tones matching game situations

### 🎭 **Visual Character System**
- **Animated Character Avatars** with 8 expressions each
- Dynamic particle effects and animations
- Expression changes based on game events
- Interactive character selection gallery

### 🎯 **Game Modes**
- **Physical Card Game**: 17 custom cards with values from -10 to 20
- **Online Multiplayer**: Real-time trading with 2-5 players
- **Solo Practice**: Play against AI personalities
- **Web3 Integration**: Optional crypto-backed micro-stakes (coming soon)

### 🔥 **Production-Ready Infrastructure**
- Firebase Authentication & Real-time Database
- Socket.io for multiplayer functionality
- CI/CD with GitHub Actions
- Vercel deployment configuration
- Environment-based configuration

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/M0nkeyFl0wer/A-Trading-Game-WTF.git
cd A-Trading-Game-WTF

# Install dependencies
pnpm install

# Build workspace packages
pnpm --filter @trading-game/shared build
pnpm --filter @trading-game/core build
pnpm --filter @trading-game/bot build

# Set up environment variables
cp apps/web/.env.example apps/web/.env
# Edit .env with your API keys
```

### Required API Keys

1. **ElevenLabs API** (for voice features)
   - Get your key at: https://elevenlabs.io
   - Add to `.env`: `VITE_ELEVENLABS_API_KEY=your_key`

2. **Firebase** (for authentication & database)
   - Create project at: https://console.firebase.google.com
   - Enable Authentication and Realtime Database
   - Add Firebase config to `.env`

### Development

```bash
# Start development server
cd apps/web
pnpm dev

# Access at http://localhost:3000
```

## 🎨 Meet the Characters

### 🎰 **The Dealer**
- **Personality**: Professional, neutral, authoritative
- **Voice Style**: Calm and measured
- **Catchphrase**: "The market waits for no one"

### 🐂 **Bull Runner**
- **Personality**: Optimistic, aggressive, risk-taker
- **Voice Style**: Excited and confident
- **Catchphrase**: "To the moon!"

### 🐻 **Bear Necessities**
- **Personality**: Pessimistic, analytical, conservative
- **Voice Style**: Cautious and skeptical
- **Catchphrase**: "The crash is coming"

### 🐋 **The Whale**
- **Personality**: Mysterious, strategic, influential
- **Voice Style**: Deep and commanding
- **Catchphrase**: "I move markets"

### 👶 **Fresh Trader**
- **Personality**: Naive, enthusiastic, learning
- **Voice Style**: Young and energetic
- **Catchphrase**: "YOLO!"

## 🏗️ Architecture

```
A-Trading-Game-WTF/
├── apps/
│   └── web/                    # React web application
│       ├── src/
│       │   ├── lib/            # Core libraries
│       │   │   ├── elevenlabs.ts      # Voice integration
│       │   │   ├── firebase.ts        # Firebase config
│       │   │   ├── gameRoom.ts        # Multiplayer logic
│       │   │   └── characterVisuals.ts # Visual system
│       │   ├── ui/             # UI components
│       │   │   ├── VoiceControls.tsx
│       │   │   ├── CharacterAvatar.tsx
│       │   │   └── CharacterGallery.tsx
│       │   ├── hooks/          # Custom React hooks
│       │   ├── pages/          # Page components
│       │   └── contexts/       # React contexts
├── packages/                    # Shared packages
│   ├── shared/                 # Shared types & utils
│   ├── core/                   # Game logic
│   ├── bot/                    # AI players
│   └── contract/              # Smart contracts
├── api/                        # Serverless functions
├── .github/workflows/          # CI/CD pipelines
└── vercel.json                # Deployment config
```

## 🔊 Voice Integration

The game features full voice integration with:
- **Pre-game lobby announcements**
- **Round start/end notifications**
- **Trade confirmations**
- **Win/loss reactions**
- **Character-specific commentary**

### Voice Control Features:
- Toggle on/off
- Volume control
- Character selection
- Manual phrase triggering
- Queue management for sequential dialogue

## 🔄 Front-End UX Refresh (Beta Prep)

Recent red-team and UX feedback led to a full lobby and table overhaul:

- **Adaptive Layouts** – lobby/table pages now use responsive cards, skeleton loading states, and accessible ARIA labels.
- **State Management Overhaul** – a normalized zustand store exposes trades, rounds, players, and voice preferences for deterministic renders.
- **Voice Fallbacks** – ElevenLabs requests gracefully downgrade to the browser SpeechSynthesis API (or console logs in SSR/tests) when API keys are missing.
- **Accessible Modals & Controls** – table creation, quoting, and voice controls trap focus, surface live regions, and support keyboard flows.
- **Offline Lobby Cache** – when the realtime backend is offline, the lobby hydrates with sanitized mock table data so QA can rehearse the flow.

## 💳 Payment Portal Scaffold

Navigate to [`/payments`](http://localhost:3000/payments) to review the new payment experience skeleton:

- **Multi-Rail Selector** – wallet deposits, card checkout, and ACH transfers with statuses (`available`, `coming soon`).
- **Workflow Blueprint** – disabled forms outline required data capture while highlighting integration points (Stripe, Plaid, compliance vendors).
- **Risk & Compliance Sidebar** – checklists reference Travel Rule, AML screening, PCI, and SOC2 tasks surfaced in the security audit.
- **Escrow Notes** – copy documents the pull-payment settlement strategy and latency expectations per network.

> ⚙️ Everything renders with sandbox placeholders. Replace the disabled buttons with real provider SDK calls once credentials and compliance gates are cleared.

## ✅ Verification Checklist

1. **Install & run the web app** – `pnpm install && pnpm --filter @trading-game/web dev` then open http://localhost:3000.
2. **Lobby smoke test** – ensure the lobby shows skeleton cards, then populated mock tables, and voice controls toggle without errors when ElevenLabs keys are absent (you should see SpeechSynthesis or console fallbacks).
3. **Table experience** – join a table, trigger the quick actions, submit a sample quote, and confirm trades appear in the tape with timestamps.
4. **Payments scaffold** – navigate to `/payments`, switch between rails, and review compliance notes against the `SECURITY_AUDIT_PREBETA.md` findings.
5. **Security regression script** – rerun `./tests/red-team-termux.sh` to ensure middleware, rate limiting, and headers still pass after UI updates (backend must be running).

## 🎮 Gameplay

### Basic Rules:
1. Each player receives one card (value: -10 to 20)
2. Players trade shares based on expected total
3. Market value = Sum of all cards ÷ Number of players
4. Winners profit from accurate predictions

### Game Flow:
1. **Deal Phase**: Cards distributed
2. **Trading Phase**: 2-minute trading window
3. **Reveal Phase**: Cards shown, market value calculated
4. **Settlement Phase**: Profits/losses determined

## 🚀 Deployment

### Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy to production
vercel --prod
```

### Environment Variables (Vercel Dashboard):
- `VITE_ELEVENLABS_API_KEY`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- All other Firebase config vars

## 🧪 Testing

```bash
# Run tests
pnpm test

# Run with coverage
pnpm test:coverage
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📋 Roadmap

### ✅ Completed
- [x] Voice-enabled characters with ElevenLabs
- [x] Visual character system with animations
- [x] Firebase authentication
- [x] Real-time multiplayer infrastructure
- [x] CI/CD pipeline
- [x] Vercel deployment configuration

### 🚧 In Progress
- [ ] Complete game logic implementation
- [ ] Mobile responsive design
- [ ] Comprehensive test coverage

### 📅 Planned
- [ ] AI opponent personalities
- [ ] Tournament mode
- [ ] Leaderboards
- [ ] Educational tutorials
- [ ] Mobile app (React Native)
- [ ] Web3 micro-stakes integration

## 🔒 Security

- Environment variables for sensitive data
- Firebase security rules
- Input validation
- Rate limiting (planned)
- Secure WebSocket connections

## 📄 License

MIT License – Open source for public learning and remixing.

## 🙏 Acknowledgments

- Gary Stevenson for the original trading game concept
- ElevenLabs for voice synthesis API
- Firebase for backend infrastructure
- Vercel for deployment platform

## 📞 Support

- **Issues**: https://github.com/M0nkeyFl0wer/A-Trading-Game-WTF/issues
- **Discussions**: https://github.com/M0nkeyFl0wer/A-Trading-Game-WTF/discussions

---

**Built with ❤️ and 🎙️ voices by the community**
