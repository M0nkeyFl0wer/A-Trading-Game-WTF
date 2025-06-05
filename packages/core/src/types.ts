import type { DeckValue } from '@trading-game/shared';

export interface Card {
  value: DeckValue;
}

export interface Player {
  id: string;
  card?: Card;
  balance: number;
  position: number;
}

export interface Trade {
  from: string;
  to: string;
  price: number;
  quantity: number;
}

export interface Table {
  players: Player[];
  pot: number;
}
