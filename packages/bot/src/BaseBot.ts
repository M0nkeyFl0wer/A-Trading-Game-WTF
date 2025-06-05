import type { Card, Trade } from '@trading-game/core';

export interface Quote {
  bid: number;
  ask: number;
}

export abstract class BaseBot {
  protected card?: Card;
  constructor(public seat: number) {}
  onCard(card: Card) {
    this.card = card;
  }
  abstract onQuoteRequest(): Quote;
  onTradeUpdate(_trade: Trade): void {}
}
