/**
 * Price-time priority order book with continuous matching engine.
 *
 * Matching rules:
 *   1. Best price first, then earliest timestamp (price-time priority).
 *   2. Execution price is the RESTING order's price (the one already in the book).
 *      If both orders arrive simultaneously, the ask price is used.
 *   3. Partial fills leave the remainder in the book.
 *   4. Self-trade prevention: a player cannot match against their own order.
 */

// TradingPhase is not yet in @trading-game/shared; define locally.
export type TradingPhase = 'pre-open' | 'open' | 'closing' | 'closed';

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
  bids: Order[];
  asks: Order[];
  /** best ask - best bid, or null when one side is empty */
  spread: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
}

let orderCounter = 0;

export class OrderBook {
  private bids: Order[] = []; // sorted: price DESC, timestamp ASC
  private asks: Order[] = []; // sorted: price ASC,  timestamp ASC
  private trades: MatchedTrade[] = [];
  private tradeCounter = 0;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Submit a new order. Returns the materialised order and any trades that
   * resulted from matching.
   */
  submitOrder(
    incoming: Omit<Order, 'id' | 'filledQuantity' | 'status'>,
  ): { order: Order; trades: MatchedTrade[] } {
    const order: Order = {
      ...incoming,
      id: `ord_${++orderCounter}`,
      filledQuantity: 0,
      status: 'open',
    };

    if (order.side === 'bid') {
      this.insertBid(order);
    } else {
      this.insertAsk(order);
    }

    const trades = this.match();
    return { order, trades };
  }

  /**
   * Cancel an order. Returns true if found and cancelled.
   * Only open or partial orders can be cancelled.
   */
  cancelOrder(orderId: string): boolean {
    const cancel = (list: Order[]): boolean => {
      const idx = list.findIndex(
        (o) => o.id === orderId && (o.status === 'open' || o.status === 'partial'),
      );
      if (idx === -1) return false;
      list[idx].status = 'cancelled';
      list.splice(idx, 1);
      return true;
    };

    return cancel(this.bids) || cancel(this.asks);
  }

  /**
   * Cancel all open/partial orders for a player. Returns count cancelled.
   */
  cancelAllForPlayer(playerId: string): number {
    let count = 0;

    const cancelSide = (list: Order[]): void => {
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        if (
          o.playerId === playerId &&
          (o.status === 'open' || o.status === 'partial')
        ) {
          o.status = 'cancelled';
          list.splice(i, 1);
          count++;
        }
      }
    };

    cancelSide(this.bids);
    cancelSide(this.asks);
    return count;
  }

  /** Current order book state for display. */
  getSnapshot(): OrderBookSnapshot {
    const bestBid = this.bids.length > 0 ? this.bids[0].price : null;
    const bestAsk = this.asks.length > 0 ? this.asks[0].price : null;

    const spread =
      bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

    const lastTrade =
      this.trades.length > 0
        ? this.trades[this.trades.length - 1].price
        : null;

    return {
      bids: [...this.bids],
      asks: [...this.asks],
      spread,
      bestBid,
      bestAsk,
      lastTradePrice: lastTrade,
    };
  }

  /** All orders that are currently open or partially filled. */
  getOpenOrders(): Order[] {
    return [...this.bids, ...this.asks];
  }

  /** All matched trades in submission order. */
  getMatchedTrades(): MatchedTrade[] {
    return [...this.trades];
  }

  /** Every order ever submitted (open, filled, partial, cancelled). */
  getAllOrders(): Order[] {
    // Collect from the live book plus filled/cancelled orders stored in trades.
    // We need to track all orders, so we keep a separate ledger.
    // NOTE: bids/asks only contain live orders. Filled/cancelled orders are
    // removed from the arrays but we still reference them through trades.
    // For a complete picture we reconstruct from trades + live book.
    const seen = new Set<string>();
    const all: Order[] = [];

    for (const o of this.bids) {
      if (!seen.has(o.id)) { seen.add(o.id); all.push(o); }
    }
    for (const o of this.asks) {
      if (!seen.has(o.id)) { seen.add(o.id); all.push(o); }
    }
    // Orders that were fully filled or cancelled are tracked in allOrders.
    for (const o of this.completedOrders) {
      if (!seen.has(o.id)) { seen.add(o.id); all.push(o); }
    }

    return all;
  }

  /**
   * Reconstruct an OrderBook from persisted state.
   */
  static fromState(orders: Order[], trades: MatchedTrade[]): OrderBook {
    const book = new OrderBook();
    book.trades = [...trades];
    book.tradeCounter = trades.length;

    for (const order of orders) {
      if (order.status === 'open' || order.status === 'partial') {
        if (order.side === 'bid') {
          book.insertBid(order);
        } else {
          book.insertAsk(order);
        }
      } else {
        book.completedOrders.push(order);
      }
    }

    // Restore global counter so new IDs don't collide.
    const maxId = orders.reduce((max, o) => {
      const num = parseInt(o.id.replace('ord_', ''), 10);
      return Number.isNaN(num) ? max : Math.max(max, num);
    }, orderCounter);
    orderCounter = maxId;

    return book;
  }

  // -----------------------------------------------------------------------
  // Private matching engine
  // -----------------------------------------------------------------------

  /** Ledger of orders that left the book (filled or cancelled). */
  private completedOrders: Order[] = [];

  /**
   * Continuously match the best bid against the best ask while the market
   * is crossed (best bid >= best ask).
   */
  private match(): MatchedTrade[] {
    const newTrades: MatchedTrade[] = [];

    while (this.bids.length > 0 && this.asks.length > 0) {
      // Find the first eligible pair (skip self-trades).
      const pair = this.findMatchablePair();
      if (!pair) break;

      const { bidIdx, askIdx } = pair;
      const bid = this.bids[bidIdx];
      const ask = this.asks[askIdx];

      // Execution price: resting order's price.
      // The resting order is the one that was in the book first.
      // If timestamps are equal, use the ask price.
      const executionPrice =
        bid.timestamp < ask.timestamp ? bid.price : ask.price;

      const bidRemaining = bid.quantity - bid.filledQuantity;
      const askRemaining = ask.quantity - ask.filledQuantity;
      const fillQty = Math.min(bidRemaining, askRemaining);

      bid.filledQuantity += fillQty;
      ask.filledQuantity += fillQty;

      // Update statuses
      if (bid.filledQuantity >= bid.quantity) {
        bid.status = 'filled';
      } else {
        bid.status = 'partial';
      }

      if (ask.filledQuantity >= ask.quantity) {
        ask.status = 'filled';
      } else {
        ask.status = 'partial';
      }

      const trade: MatchedTrade = {
        id: `trade_${++this.tradeCounter}`,
        buyerId: bid.playerId,
        buyerName: bid.playerName,
        sellerId: ask.playerId,
        sellerName: ask.playerName,
        price: executionPrice,
        quantity: fillQty,
        buyOrderId: bid.id,
        sellOrderId: ask.id,
        phase: bid.phase,
        timestamp: Date.now(),
      };

      newTrades.push(trade);
      this.trades.push(trade);

      // Remove fully filled orders from the book.
      if (bid.status === 'filled') {
        this.bids.splice(bidIdx, 1);
        this.completedOrders.push(bid);
      }
      if (ask.status === 'filled') {
        // Adjust index if the bid was removed first from the same conceptual list.
        this.asks.splice(askIdx, 1);
        this.completedOrders.push(ask);
      }
    }

    return newTrades;
  }

  /**
   * Walk the book to find the first matchable bid/ask pair, skipping
   * self-trades. Returns null if no crossing pair exists.
   */
  private findMatchablePair(): { bidIdx: number; askIdx: number } | null {
    for (let bi = 0; bi < this.bids.length; bi++) {
      for (let ai = 0; ai < this.asks.length; ai++) {
        const bid = this.bids[bi];
        const ask = this.asks[ai];

        // Market is not crossed at this price level - no further matches.
        if (bid.price < ask.price) return null;

        // Self-trade prevention.
        if (bid.playerId === ask.playerId) continue;

        return { bidIdx: bi, askIdx: ai };
      }
      // If we exhausted all asks for this bid without a non-self match,
      // move to next bid.
    }
    return null;
  }

  /** Insert a bid maintaining price DESC, timestamp ASC order. */
  private insertBid(order: Order): void {
    let lo = 0;
    let hi = this.bids.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const existing = this.bids[mid];
      // Higher price comes first; ties broken by earlier timestamp.
      if (
        existing.price > order.price ||
        (existing.price === order.price && existing.timestamp <= order.timestamp)
      ) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    this.bids.splice(lo, 0, order);
  }

  /** Insert an ask maintaining price ASC, timestamp ASC order. */
  private insertAsk(order: Order): void {
    let lo = 0;
    let hi = this.asks.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const existing = this.asks[mid];
      // Lower price comes first; ties broken by earlier timestamp.
      if (
        existing.price < order.price ||
        (existing.price === order.price && existing.timestamp <= order.timestamp)
      ) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    this.asks.splice(lo, 0, order);
  }
}
