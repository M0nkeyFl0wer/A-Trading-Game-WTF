export const DEFAULT_TICK_PRESETS = [0.1, 1, 5];
export const DEFAULT_DECK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, -10];
export const DEFAULT_TABLE_CONFIG = {
    seats: 5,
    roundSeconds: 120,
    deck: DEFAULT_DECK,
    tick: { tickSize: 0.1 },
    houseFee: 0.01,
};
export function computeEV(cardDelta) {
    return 61.2 + cardDelta;
}
export * from './security';
export * from './voice';
