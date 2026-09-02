/**
 * Injectable random-number source for the round engine.
 *
 * The live game must stay cryptographically unpredictable — a player who could
 * guess the shuffle could guess every card. But replay, bot-vs-bot tournaments
 * and the post-round Debrief all need the *opposite* property: given a seed, the
 * exact same deal must come out every time so a hand can be re-run offline with
 * no socket and no UI (see issue #26).
 *
 * We reconcile the two by injecting the randomness. `Round` asks an `Rng` for
 * integers instead of calling `crypto.randomInt` directly:
 *
 *   - live play  → {@link CryptoRng} (the default; behaviour is unchanged)
 *   - sim/replay → {@link SeededRng} (deterministic, reproducible from a seed)
 *
 * Both return *uniformly distributed* integers with no modulo bias, so the
 * seeded path is a faithful stand-in for the crypto path, not a lower-quality
 * shortcut.
 */

import { randomInt } from 'crypto';

export interface Rng {
  /**
   * Return a uniformly-distributed integer in the half-open range
   * `[0, maxExclusive)`. `maxExclusive` must be a positive integer.
   *
   * This is exactly the shape Fisher-Yates needs: `rng.nextInt(i + 1)` picks a
   * swap target in `[0, i]`.
   */
  nextInt(maxExclusive: number): number;
}

/**
 * Cryptographically-secure RNG backed by Node's `crypto.randomInt`. This is the
 * live default; `nextInt(n)` is identical to the previous `randomInt(0, n)`
 * call, so wiring the engine through this interface does not change live deals.
 */
export class CryptoRng implements Rng {
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`nextInt requires a positive integer, got ${maxExclusive}`);
    }
    // randomInt is [min, max) — exactly [0, maxExclusive).
    return randomInt(0, maxExclusive);
  }
}

/** Shared, stateless crypto RNG used as the engine's live default. */
export const cryptoRng: Rng = new CryptoRng();

/**
 * Hash an arbitrary string seed down to a 32-bit unsigned integer so callers can
 * seed a run with something human-readable (e.g. `"tournament-game-7"`). This is
 * the well-known FNV-1a hash — deterministic and platform-independent.
 */
function hashStringToUint32(str: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit space via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // force unsigned 32-bit
}

/**
 * Deterministic, seedable PRNG (mulberry32). Given the same seed it produces the
 * same sequence on every machine and every run — which is the whole point: a
 * `{seed, actions}` pair replays to a byte-identical deal and settlement.
 *
 * mulberry32 is a small, fast, well-distributed 32-bit generator. It is NOT
 * cryptographically secure and must never back live play — only sim/replay.
 */
export class SeededRng implements Rng {
  private state: number;

  constructor(seed: number | string) {
    const numericSeed =
      typeof seed === 'string' ? hashStringToUint32(seed) : seed >>> 0;
    // Avoid a zero state, which would weaken the first few outputs.
    this.state = (numericSeed || 0x9e3779b9) >>> 0;
  }

  /** One step of mulberry32 → a fresh uniformly-distributed uint32. */
  private nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`nextInt requires a positive integer, got ${maxExclusive}`);
    }
    // Rejection sampling to eliminate modulo bias: discard the tail of the
    // uint32 range that does not divide evenly by maxExclusive. For the small
    // ranges used in a deck shuffle the rejection rate is negligible.
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    let x = this.nextUint32();
    while (x >= limit) {
      x = this.nextUint32();
    }
    return x % maxExclusive;
  }
}
