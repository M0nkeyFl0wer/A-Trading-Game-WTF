
# The Trading Game – Open Strategy Project

A minimalist, accessible version of Gary Stevenson's iconic trading game – designed to teach math, strategy, and trading instincts through social play.

## Vision
Make trading fun, social, and educational. Strip away the jargon and show people how markets work with cards, friends, and quick rounds of bluffing, betting, and psychology.

## MVP Components

### A. Physical Card Game (Print-on-Demand)
- **17 Custom Cards**: Values -10, 1–15, 20
- **Fold-out Trade Tracker Sheet**
- **Printed Instructions (with QR code to online guide)**
- **Tuck Box or Minimal Packaging**
- **Educational focus**: Helps build number sense, probability intuition, and strategic thinking

### B. Online Game (Browser-Based)
- **Solo or 2–5 player mode**
- **See your card, make offers, buy/sell**
- **Track trades and reveal total**
- **Built in React or HTML/JS + Firebase (or socket.io)**
- **Mobile-friendly & sharable**
- **Game log and scoring**

---

## Stretch Goals

### 1. Mobile App Version
- Android/iOS version
- Push notifications for turns
- AI opponents with personality profiles

### 2. Educational Mode
- Hints and guided play for students
- Optional visible odds tracker and graph
- Teacher/classroom tools

### 3. Crypto-Backed Version (Web3)
- Trades placed with micro crypto stakes (e.g. USDC, ETH)
- Winners paid out automatically
- Potential DAO governance or leaderboard prizes

#### Security Considerations:
- Use audited smart contracts for holding and settling stakes
- Avoid custody: connect wallets via MetaMask or WalletConnect
- Limit risk with wager caps and opt-in betting
- Add identity protections (e.g. anonymous play, reputation system)
- Regulatory review for KYC/AML depending on payout method and region

---

## Folder Structure

```
trading-game/
├── physical/
│   ├── card_designs/
│   ├── trade_log_sheet.pdf
│   └── instructions_foldout.pdf
├── online/
│   ├── public/
│   ├── src/
│   └── README.md (dev setup for online game)
└── README.md (this file)
```

## License
MIT License – Open source for public learning and remixing.
