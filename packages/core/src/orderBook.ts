import type { Order, MatchedTrade } from '@trading-game/shared';

/**
 * A simple price-time priority order book for the trading game.
 *
 * Bids are sorted highest-price-first; asks are sorted lowest-price-first.
 * When a new order arrives it is matched greedily against resting orders
 * on the opposite side.
 */
export class OrderBook {
  private bids: Order[] = [];
  private asks: Order[] = [];
  private trades: MatchedTrade[] = [];
  private nextTradeId = 1;

  /** Reconstruct an OrderBook from serialised state (orders + trades). */
  static fromState(orders: Order[], trades: MatchedTrade[]): OrderBook {
    const book = new OrderBook();
    book.trades = [...trades];
    book.nextTradeId = trades.length + 1;

    for (const order of orders) {
      if (order.status === 'open' || order.status === 'partial') {
        const copy = { ...order };
        if (copy.side === 'bid') {
          book.bids.push(copy);
        } else {
          book.asks.push(copy);
        }
      }
    }

    // Maintain sort invariants
    book.sortBids();
    book.sortAsks();
    return book;
  }

  /**
   * Submit a new order. Returns any trades that resulted from matching.
   * The order object is mutated to reflect fills.
   */
  submit(order: Order): MatchedTrade[] {
    const newTrades: MatchedTrade[] = [];

    if (order.side === 'bid') {
      // Match against resting asks (lowest price first)
      while (order.remainingQty > 0 && this.asks.length > 0) {
        const bestAsk = this.asks[0];
        if (order.price < bestAsk.price) break; // no match

        const fillQty = Math.min(order.remainingQty, bestAsk.remainingQty);
        const fillPrice = bestAsk.price; // price-time priority: resting order's price

        const trade = this.createTrade(order.id, bestAsk.id, order.playerId, bestAsk.playerId, fillPrice, fillQty);
        newTrades.push(trade);
        this.trades.push(trade);

        order.remainingQty -= fillQty;
        bestAsk.remainingQty -= fillQty;

        if (bestAsk.remainingQty === 0) {
          bestAsk.status = 'filled';
          this.asks.shift();
        } else {
          bestAsk.status = 'partial';
        }
      }

      if (order.remainingQty === 0) {
        order.status = 'filled';
      } else if (order.remainingQty < order.quantity) {
        order.status = 'partial';
        this.bids.push(order);
        this.sortBids();
      } else {
        // No fills at all
        this.bids.push(order);
        this.sortBids();
      }
    } else {
      // Ask side: match against resting bids (highest price first)
      while (order.remainingQty > 0 && this.bids.length > 0) {
        const bestBid = this.bids[0];
        if (order.price > bestBid.price) break;

        const fillQty = Math.min(order.remainingQty, bestBid.remainingQty);
        const fillPrice = bestBid.price;

        const trade = this.createTrade(bestBid.id, order.id, bestBid.playerId, order.playerId, fillPrice, fillQty);
        newTrades.push(trade);
        this.trades.push(trade);

        order.remainingQty -= fillQty;
        bestBid.remainingQty -= fillQty;

        if (bestBid.remainingQty === 0) {
          bestBid.status = 'filled';
          this.bids.shift();
        } else {
          bestBid.status = 'partial';
        }
      }

      if (order.remainingQty === 0) {
        order.status = 'filled';
      } else if (order.remainingQty < order.quantity) {
        order.status = 'partial';
        this.asks.push(order);
        this.sortAsks();
      } else {
        this.asks.push(order);
        this.sortAsks();
      }
    }

    return newTrades;
  }

  /**
   * Cancel an open or partially-filled order. Returns true if found and cancelled.
   */
  cancel(orderId: string): boolean {
    for (const list of [this.bids, this.asks]) {
      const idx = list.findIndex((o) => o.id === orderId);
      if (idx !== -1) {
        list[idx].status = 'cancelled';
        list[idx].remainingQty = 0;
        list.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  /** All trades matched so far. */
  getTrades(): MatchedTrade[] {
    return this.trades;
  }

  /** Snapshot of all resting orders (bids then asks). */
  getRestingOrders(): Order[] {
    return [...this.bids, ...this.asks];
  }

  // --- private helpers ---

  private createTrade(
    buyOrderId: string,
    sellOrderId: string,
    buyerId: string,
    sellerId: string,
    price: number,
    quantity: number,
  ): MatchedTrade {
    return {
      id: `match_${this.nextTradeId++}`,
      buyOrderId,
      sellOrderId,
      buyerId,
      sellerId,
      price,
      quantity,
      timestamp: Date.now(),
    };
  }

  /** Highest price first, then earliest timestamp. */
  private sortBids() {
    this.bids.sort((a, b) => b.price - a.price || a.timestamp - b.timestamp);
  }

  /** Lowest price first, then earliest timestamp. */
  private sortAsks() {
    this.asks.sort((a, b) => a.price - b.price || a.timestamp - b.timestamp);
  }
}
