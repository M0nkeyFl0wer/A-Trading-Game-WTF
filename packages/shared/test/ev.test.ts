import { describe, expect, it } from 'vitest';
import {
  computeEV,
  estimateFairValue,
  DECK_MEAN,
  COMMUNITY_CARD_COUNT,
} from '../src';

describe('computeEV (deprecated)', () => {
  it('adds card delta to base EV', () => {
    expect(computeEV(5)).toBe(66.2);
  });
});

describe('estimateFairValue (issue #24)', () => {
  it('values every unknown card at the deck mean', () => {
    // 5 players, no community card revealed. I hold a 10.
    // Known = 10. Unknown = (5-1) other players + 3 community = 7 cards.
    // Fair = 10 + 7 * DECK_MEAN.
    expect(estimateFairValue(10, [], 5)).toBeCloseTo(10 + 7 * DECK_MEAN, 6);
  });

  it('shrinks the unknown pool as the table shrinks', () => {
    // Same card, 3 players instead of 5 -> fewer hidden cards -> lower total.
    const fivePlayer = estimateFairValue(10, [], 5);
    const threePlayer = estimateFairValue(10, [], 3);
    expect(threePlayer).toBeLessThan(fivePlayer);
    // Exactly two fewer unknown cards -> down by 2 deck means.
    expect(fivePlayer - threePlayer).toBeCloseTo(2 * DECK_MEAN, 6);
  });

  it('moves as community cards are revealed, replacing a mean with a real value', () => {
    const blind = estimateFairValue(10, [], 5);
    // Reveal a high community card (15): the unknown pool drops by one card
    // (its mean) and the known total gains the real 15.
    const afterHighReveal = estimateFairValue(10, [15], 5);
    expect(afterHighReveal - blind).toBeCloseTo(15 - DECK_MEAN, 6);
    // A revealed card below the mean should push the estimate down instead.
    const afterLowReveal = estimateFairValue(10, [1], 5);
    expect(afterLowReveal - blind).toBeCloseTo(1 - DECK_MEAN, 6);
  });

  it('counts exactly COMMUNITY_CARD_COUNT community cards in total', () => {
    // With all three community cards revealed and a single player, the only
    // remaining unknowns are (playerCount - 1) = 0 -> the total is fully known.
    const revealed = [5, 6, 7];
    expect(revealed.length).toBe(COMMUNITY_CARD_COUNT);
    expect(estimateFairValue(10, revealed, 1)).toBeCloseTo(10 + 5 + 6 + 7, 6);
  });
});
