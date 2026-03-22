import type { DeckValue } from '@trading-game/shared';
import type { Card, Table } from './types';
import { OrderBook } from './orderBook';
import type { Order, MatchedTrade, OrderBookSnapshot } from './orderBook';

export type RoundPhase = 'deal' | 'blind' | 'flop' | 'turn' | 'settlement' | 'settled';

/** Phases during which trading is allowed. */
const TRADING_PHASES: ReadonlySet<RoundPhase> = new Set(['blind', 'flop', 'turn']);

/** Phase transition map. */
const NEXT_PHASE: Partial<Record<RoundPhase, RoundPhase>> = {
  blind: 'flop',
  flop: 'turn',
  turn: 'settlement',
};

export interface RoundOptions {
  /** Reserved for future use (timer durations, etc.) */
}

export class Round {
  public phase: RoundPhase = 'deal';
  private deck: DeckValue[];
  private communityCards: Card[] = [];
  private orderBook: OrderBook;

  constructor(
    private table: Table,
    deck: DeckValue[],
    private opts: RoundOptions = {},
  ) {
    this.deck = [...deck];
    this.orderBook = new OrderBook();
  }

  // ---------------------------------------------------------------------------
  // Static factory for reconstructing from persisted state
  // ---------------------------------------------------------------------------

  /**
   * Reconstruct a Round from persisted data.
   * Players must already have their .card set on the table.
   */
  static fromState(
    table: Table,
    communityValues: number[],
    phase: RoundPhase,
    orders: Order[],
    trades: MatchedTrade[],
    opts: RoundOptions = {},
  ): Round {
    const round = new Round(table, [], opts);
    round.communityCards = communityValues.map((v) => ({ value: v as DeckValue }));
    round.phase = phase;
    round.orderBook = OrderBook.fromState(orders, trades);
    return round;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Shuffle the deck, deal 1 card per player + 3 community cards.
   * Transitions from 'deal' to 'blind'.
   */
  deal(): void {
    if (this.phase !== 'deal') {
      throw new Error(`Cannot deal in phase "${this.phase}"`);
    }

    // Fisher-Yates shuffle
    const d = this.deck;
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }

    // Deal 1 card per player
    for (const player of this.table.players) {
      const value = d.pop();
      if (value === undefined) throw new Error('Deck exhausted');
      player.card = { value };
    }

    // Deal 3 community cards (face down for now)
    for (let i = 0; i < 3; i++) {
      const value = d.pop();
      if (value === undefined) throw new Error('Deck exhausted');
      this.communityCards.push({ value });
    }

    this.phase = 'blind';
  }

  /**
   * Advance to the next phase.
   *   blind -> flop  (reveals community card 1)
   *   flop  -> turn  (reveals community card 2)
   *   turn  -> settlement (reveals community card 3 + all player cards)
   *
   * Returns the new phase name.
   */
  advancePhase(): RoundPhase {
    const next = NEXT_PHASE[this.phase];
    if (!next) {
      throw new Error(`Cannot advance from phase "${this.phase}"`);
    }
    this.phase = next;
    return this.phase;
  }

  // ---------------------------------------------------------------------------
  // Trading
  // ---------------------------------------------------------------------------

  /**
   * Submit an order to the order book.
   * Only works during blind/flop/turn phases.
   * Returns any matched trades that resulted.
   */
  submitOrder(order: {
    playerId: string;
    playerName: string;
    side: 'bid' | 'ask';
    price: number;
    quantity: number;
  }): MatchedTrade[] {
    if (!TRADING_PHASES.has(this.phase)) {
      throw new Error(`Cannot submit orders in phase "${this.phase}"`);
    }

    const { trades } = this.orderBook.submitOrder({
      playerId: order.playerId,
      playerName: order.playerName,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
      timestamp: Date.now(),
      phase: this.phase as 'blind' | 'flop' | 'turn',
    });

    return trades;
  }

  /**
   * Cancel an order by ID. Returns true if successfully cancelled.
   */
  cancelOrder(orderId: string): boolean {
    return this.orderBook.cancelOrder(orderId);
  }

  // ---------------------------------------------------------------------------
  // Community card visibility
  // ---------------------------------------------------------------------------

  /**
   * Get community card values visible in the current phase.
   *   blind:              [] (none revealed)
   *   flop:               [card1]
   *   turn:               [card1, card2]
   *   settlement/settled: [card1, card2, card3]
   */
  getRevealedCommunityCards(): number[] {
    const revealCount = this.getRevealCount();
    return this.communityCards.slice(0, revealCount).map((c) => c.value);
  }

  /**
   * Get ALL community card values (only meaningful after settlement).
   */
  getAllCommunityCards(): number[] {
    return this.communityCards.map((c) => c.value);
  }

  private getRevealCount(): number {
    switch (this.phase) {
      case 'deal':
      case 'blind':
        return 0;
      case 'flop':
        return 1;
      case 'turn':
        return 2;
      case 'settlement':
      case 'settled':
        return 3;
    }
  }

  // ---------------------------------------------------------------------------
  // Order book queries
  // ---------------------------------------------------------------------------

  /** Get the order book snapshot for display. */
  getOrderBookSnapshot(): OrderBookSnapshot {
    return this.orderBook.getSnapshot();
  }

  /** Get all matched trades across all phases. */
  getMatchedTrades(): MatchedTrade[] {
    return this.orderBook.getMatchedTrades();
  }

  /** Get all orders (for persistence). */
  getAllOrders(): Order[] {
    return this.orderBook.getAllOrders();
  }

  // ---------------------------------------------------------------------------
  // Settlement
  // ---------------------------------------------------------------------------

  /**
   * Compute the total value of all dealt cards (player cards + 3 community).
   * This is the settlement value that all trades settle against.
   */
  getTotal(): number {
    const playerTotal = this.table.players.reduce(
      (sum, p) => sum + (p.card?.value ?? 0),
      0,
    );
    const communityTotal = this.communityCards.reduce(
      (sum, c) => sum + c.value,
      0,
    );
    return playerTotal + communityTotal;
  }

  /**
   * Settle all trades against the total card value.
   * Can only be called in the 'settlement' phase.
   *
   * For each trade:
   *   buyer PnL  = (total - tradePrice) * quantity
   *   seller PnL = (tradePrice - total) * quantity
   *
   * Updates player balances directly. Sets phase to 'settled'.
   * Returns PnL map (playerId -> net PnL).
   */
  settle(): Map<string, number> {
    if (this.phase !== 'settlement') {
      throw new Error(`Cannot settle in phase "${this.phase}"`);
    }

    const total = this.getTotal();
    const trades = this.orderBook.getMatchedTrades();
    const pnl = new Map<string, number>();

    for (const trade of trades) {
      const buyerPnL = (total - trade.price) * trade.quantity;
      const sellerPnL = (trade.price - total) * trade.quantity;

      pnl.set(trade.buyerId, (pnl.get(trade.buyerId) ?? 0) + buyerPnL);
      pnl.set(trade.sellerId, (pnl.get(trade.sellerId) ?? 0) + sellerPnL);
    }

    // Apply PnL to player balances
    for (const player of this.table.players) {
      const playerPnL = pnl.get(player.id) ?? 0;
      player.balance += playerPnL;
    }

    this.phase = 'settled';
    return pnl;
  }
}
