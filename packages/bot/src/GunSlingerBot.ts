import { computeEV } from '@trading-game/shared';
import type { Quote } from './BaseBot';
import { BaseBot } from './BaseBot';

export class GunSlingerBot extends BaseBot {
  constructor(seat: number, private tick: number, private rng: () => number) {
    super(seat);
  }

  onQuoteRequest(): Quote {
    const cardValue = this.card?.value ?? 0;
    const mid = computeEV(cardValue);
    const bluffTicks = Math.floor(this.rng() * 11) - 5; // ±5 ticks
    const bluff = bluffTicks * this.tick;
    const bid = mid * 0.8 + bluff;
    const ask = mid * 1.2 + bluff;
    return { bid, ask };
  }
}
