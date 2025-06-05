import { describe, expect, it } from 'vitest';
import { computeEV } from '../src';

describe('computeEV', () => {
  it('adds card delta to base EV', () => {
    expect(computeEV(5)).toBe(66.2);
  });
});
