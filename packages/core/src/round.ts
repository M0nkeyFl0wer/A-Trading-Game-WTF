import { DeckValue, DEFAULT_TICK_PRESETS } from '@trading-game/shared';
import { Card, Player, Table, Trade } from './types';

export type RoundState = 'deal' | 'trading' | 'reveal' | 'settle';

export interface RoundOptions {
  houseFee?: number; // percentage (e.g., 0.01)
}

export class Round {
  public state: RoundState = 'deal';
  private deck: DeckValue[];
  private community: Card[] = [];

  constructor(private table: Table, deck: DeckValue[], private opts: RoundOptions = {}) {
    this.deck = [...deck];
  }

  shuffle() {
    const d = this.deck;
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
  }

  deal() {
    if (this.state !== 'deal') throw new Error('invalid state');
    this.shuffle();
    this.table.players.forEach(p => {
      const value = this.deck.pop();
      if (value === undefined) throw new Error('deck empty');
      p.card = { value };
    });
    for (let i = 0; i < 3; i++) {
      const value = this.deck.pop();
      if (value === undefined) throw new Error('deck empty');
      this.community.push({ value });
    }
    this.state = 'trading';
  }

  reveal() {
    if (this.state !== 'trading') throw new Error('invalid state');
    this.state = 'reveal';
  }

  settle(trades: Trade[]) {
    if (this.state !== 'reveal') throw new Error('invalid state');
    const communityTotal = this.community.reduce((a, c) => a + c.value, 0);
    const feeRate = this.opts.houseFee ?? 0.01;
    const tradeVolume: Record<string, number> = {};
    const position: Record<string, number> = {};

    trades.forEach(t => {
      tradeVolume[t.from] = (tradeVolume[t.from] || 0) + t.price * Math.abs(t.quantity);
      tradeVolume[t.to] = (tradeVolume[t.to] || 0) + t.price * Math.abs(t.quantity);
      position[t.from] = (position[t.from] || 0) - t.quantity;
      position[t.to] = (position[t.to] || 0) + t.quantity;
    });

    this.table.players.forEach(p => {
      const cardValue = p.card?.value ?? 0;
      const finalValue = cardValue + communityTotal + (position[p.id] || 0);
      const fees = (tradeVolume[p.id] || 0) * feeRate;
      p.balance += finalValue - fees;
    });

    this.state = 'settle';
  }
}
