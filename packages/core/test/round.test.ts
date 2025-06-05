import { describe, it, expect, beforeEach } from 'vitest';
import { Round } from '../src/round';
import type { Player, Trade } from '../src/types';
import { DeckValue } from '@trading-game/shared';

const deck: DeckValue[] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,20,-10];

function createPlayers(): Player[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `P${i}`,
    balance: 0,
    position: 0,
  }));
}

describe('Round', () => {
  let round: Round;
  let players: Player[];

  beforeEach(() => {
    players = createPlayers();
    round = new Round({ players, pot: 0 }, [...deck]);
  });

  it('shuffles deck', () => {
    const before = [...(round as any).deck];
    round.shuffle();
    expect((round as any).deck).not.toEqual(before);
  });

  it('deals cards and community', () => {
    round.deal();
    expect(players.every(p => p.card)).toBe(true);
    // community cards stored privately; check state
    expect(round.state).toBe('trading');
  });

  it('calculates P/L with house cut and tie', () => {
    round.deal();
    round.reveal();
    const trades: Trade[] = [
      { from: 'P0', to: 'P1', price: 10, quantity: 1 },
      { from: 'P2', to: 'P3', price: 5, quantity: 2 }
    ];
    round.settle(trades);
    const totalBalances = players.reduce((a, p) => a + p.balance, 0);
    // fees collected by house reduce total payouts
    expect(totalBalances).toBeLessThan(0);
    expect(round.state).toBe('settle');
  });
});
