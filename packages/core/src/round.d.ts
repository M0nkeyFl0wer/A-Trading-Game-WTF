import type { DeckValue } from '@trading-game/shared';
import type { Table, Trade } from './types';
export type RoundState = 'deal' | 'trading' | 'reveal' | 'settle';
export interface RoundOptions {
    houseFee?: number;
}
export declare class Round {
    private table;
    private opts;
    state: RoundState;
    private deck;
    private community;
    constructor(table: Table, deck: DeckValue[], opts?: RoundOptions);
    /**
     * Reconstruct a Round from cards that were already dealt.
     * Players must already have their .card set. Community values are passed in.
     * The returned Round is in 'trading' state, ready for reveal() then settle().
     */
    static fromDealt(table: Table, communityValues: number[], opts?: RoundOptions): Round;
    shuffle(): void;
    deal(): void;
    reveal(): void;
    settle(trades: Trade[]): void;
    getCommunityCardValues(): number[];
}
//# sourceMappingURL=round.d.ts.map