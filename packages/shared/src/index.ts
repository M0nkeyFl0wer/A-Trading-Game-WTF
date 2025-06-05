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

export function computeEV(cardDelta: number): number {
  return 61.2 + cardDelta;
}
