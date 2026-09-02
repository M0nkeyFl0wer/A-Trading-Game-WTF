export type DeckValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 20 | -10;

export type Deck = DeckValue[];

export interface TickConfig {
  tickSize: number;
}

export interface TableConfig {
  seats: number;
  roundSeconds: number;
  deck: Deck;
  tick: TickConfig;
  houseFee: number;
}

export const DEFAULT_TICK_PRESETS = [0.1, 1, 5];
export const DEFAULT_DECK: Deck = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,20,-10];
export const DEFAULT_TABLE_CONFIG: TableConfig = {
  seats: 5,
  roundSeconds: 120,
  deck: DEFAULT_DECK,
  tick: { tickSize: 0.1 },
  houseFee: 0.01,
};

// ---------------------------------------------------------------------------
// Fair-value estimation (issue #24)
//
// The round settles on the SUM of every dealt card: one card per player plus
// three community cards. A player only ever knows their own card and whichever
// community cards have been revealed so far; every other card is an unknown
// drawn from the deck. The fair value of the total is therefore:
//
//     (cards I can see) + (cards I can't) * (deck mean)
//
// Both the server (bot pricing) and the web client (the number shown to the
// human) import THIS one function so the player is never anchored to a
// different fair value than the bots price against. See issue #24.
// ---------------------------------------------------------------------------

// Derive the deck statistics from DEFAULT_DECK so there is a single source of
// truth. For the shipped deck this is sum = 130 over 17 cards → mean ≈ 7.647.
const DECK_SUM = DEFAULT_DECK.reduce((sum, card) => sum + card, 0);
const DECK_SIZE = DEFAULT_DECK.length;
export const DECK_MEAN = DECK_SUM / DECK_SIZE;

// Every round deals exactly three community cards, regardless of table size.
export const COMMUNITY_CARD_COUNT = 3;

/**
 * Estimate the fair value of the round's settlement total from one player's
 * point of view.
 *
 * @param myCard                 the value of the caller's own hole card
 * @param revealedCommunityCards community cards visible in the current phase
 * @param playerCount            how many players (incl. bots) are at the table
 *
 * The known portion is the caller's card plus the revealed community cards.
 * The unknown portion is every other player's hidden card ((playerCount - 1)
 * of them) plus the community cards not yet turned over. Each unknown card is
 * valued at the deck mean.
 */
export function estimateFairValue(
  myCard: number,
  revealedCommunityCards: number[],
  playerCount: number,
): number {
  const knownTotal = myCard + revealedCommunityCards.reduce((s, c) => s + c, 0);
  const unknownCount =
    (playerCount - 1) + (COMMUNITY_CARD_COUNT - revealedCommunityCards.length);
  return knownTotal + unknownCount * DECK_MEAN;
}

/**
 * @deprecated Use {@link estimateFairValue} instead. This function is wrong on
 * two counts: it double-counts the caller's own card (61.2 already includes an
 * average for every seat, then `cardDelta` adds the real card on top) and it
 * hard-codes the 5-player / 8-card table, ignoring the actual player count and
 * revealed community cards. Kept only so nothing breaks mid-migration (#24);
 * remove once no call sites remain.
 *
 * Compute the expected value of the sum of all 8 dealt cards.
 * Deck values: -10,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,20  (17 cards, sum = 130)
 * With 8 cards drawn from 17, EV(total) = 130 * (8/17) ≈ 61.2
 * cardDelta adjusts for known information (revealed community cards, etc.)
 */
export function computeEV(cardDelta: number): number {
  return 61.2 + cardDelta;
}

export * from './security';
export * from './voice';

// ============================================================================
// Character Types (moved from web app for cross-package use)
// ============================================================================

export type CharacterType = 'DEALER' | 'BULL' | 'BEAR' | 'WHALE' | 'ROOKIE';

export type CharacterExpression =
  | 'neutral' | 'happy' | 'sad' | 'excited'
  | 'worried' | 'thinking' | 'celebrating' | 'shocked';

// ============================================================================
// Market & Trading Types (for bot package)
// ============================================================================

export interface MarketData {
  price: number;
  bid: number;
  ask: number;
  volume: number;
  high24h: number;
  low24h: number;
  change24h: number;
  timestamp: number;
  // Extended fields for bot strategies
  open24h?: number;
  volume24h?: number;
  avgVolume?: number;
  buyVolume?: number;
  sellVolume?: number;
  avgTradeSize?: number;
  priceHistory?: number[];
}

export interface Position {
  size: number;
  entryPrice: number;
  pnl: number;
  balance: number;
}

export type TradeType = 'buy' | 'sell' | 'MARKET_BUY' | 'MARKET_SELL' | 'LIMIT_BUY' | 'LIMIT_SELL';

export interface Trade {
  from?: string;  // Optional for internal bot trades
  to?: string;    // Optional for internal bot trades
  price: number;
  quantity?: number;  // Use size for bot strategies
  size?: number;  // Alternative to quantity for bot strategies
  timestamp?: number;
  type?: TradeType;
  character?: CharacterType;  // Bot character that made the trade
  voiceLine?: string;  // Character voice line to play
}

export interface BotResult {
  success: boolean;
  trade?: Trade;
  error?: string;
  executionTime: number;
  memoryUsed: number;
}

export type Indicator = 'RSI' | 'MACD' | 'VWAP' | 'SMA' | 'EMA' | 'BOLLINGER';

// ============================================================================
// Order Book & Phase Types (New Game Mechanics)
// ============================================================================

export type TradingPhase = 'blind' | 'flop' | 'turn' | 'settlement';

export interface Order {
  id: string;
  playerId: string;
  playerName: string;
  side: 'bid' | 'ask';
  price: number;
  quantity: number;
  filledQuantity: number;
  timestamp: number;
  phase: TradingPhase;
  status: 'open' | 'filled' | 'partial' | 'cancelled';
}

export interface MatchedTrade {
  id: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  price: number;
  quantity: number;
  buyOrderId: string;
  sellOrderId: string;
  phase: TradingPhase;
  timestamp: number;
}

export interface OrderBookSnapshot {
  bids: Order[];   // sorted by price descending (best bid first)
  asks: Order[];   // sorted by price ascending (best ask first)
}

// ============================================================================
// Two-Way Quote Requests (ask a named player for a price)
// ============================================================================

export type QuoteStatus = 'pending' | 'quoted' | 'accepted' | 'expired';

export interface QuoteRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  targetId: string;
  targetName: string;
  status: QuoteStatus;
  /** Set once the target responds. Always exactly 2 apart from askPrice. */
  bidPrice?: number;
  askPrice?: number;
  createdAt: number;
  /** Unix-ms deadline; never later than the phase's own end. */
  expiresAt: number;
  respondedAt?: number;
  resolvedAt?: number;
  resolution?: { side: 'hit' | 'lift'; price: number; tradeId: string };
}

export interface PhaseConfig {
  phase: TradingPhase;
  durationMs: number;
  communityCardsRevealed: number;
}

export const PHASE_SEQUENCE: PhaseConfig[] = [
  { phase: 'blind', durationMs: 30_000, communityCardsRevealed: 0 },
  { phase: 'flop',  durationMs: 20_000, communityCardsRevealed: 1 },
  { phase: 'turn',  durationMs: 20_000, communityCardsRevealed: 2 },
];

// Total phase duration for the full round
export const TOTAL_ROUND_MS = PHASE_SEQUENCE.reduce((sum, p) => sum + p.durationMs, 0);

// Pause between a round settling and the next one being dealt. The server's
// scheduleNextRound timer and the client's SettlementScreen countdown both
// read this one value so the P&L overlay is on screen exactly as long as the
// server waits (#14). Rooms without a human player never auto-continue at all.
export const NEXT_ROUND_DELAY_MS = 15_000;

// ============================================================================
// Commit-Reveal Card Verification
// ============================================================================

/**
 * The canonical string that gets hashed for a card commitment.
 * Both server and client must agree on this format.
 *
 * Formula: SHA-256( "<value>:<nonce>" )  where value is the numeric card value
 * and nonce is the 32-char hex string generated at deal time.
 */
export function commitmentPreimage(value: number, nonce: string): string {
  return `${value}:${nonce}`;
}

/**
 * Verify a card commitment using the Web Crypto API (works in browsers and
 * Node 18+).  Returns a promise that resolves to true when the commitment
 * matches SHA-256(value:nonce).
 *
 * Usage (browser):
 *   const ok = await verifyCardCommitment(cardValue, nonce, publishedCommitment);
 *
 * Usage (Node with 'crypto'):
 *   import { createHash } from 'crypto';
 *   const hash = createHash('sha256').update(commitmentPreimage(value, nonce)).digest('hex');
 *   const ok = hash === publishedCommitment;
 */
export async function verifyCardCommitment(
  value: number,
  nonce: string,
  commitment: string,
): Promise<boolean> {
  const preimage = commitmentPreimage(value, nonce);
  const encoded = new TextEncoder().encode(preimage);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex === commitment;
}
