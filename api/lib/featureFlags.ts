/**
 * Server-side feature flags (issue #25).
 *
 * The web client already gates the felt-table redesign behind the build-time
 * `VITE_ENABLE_TRADING_FLOOR` flag (see apps/web/src/lib/featureFlags.ts). That
 * flag only decides how the BROWSER renders; the SERVER needs its own switch so
 * that when the floor UI is live, the bots trade the same way the human does --
 * through two-way QUOTES -- instead of quietly matching each other in the hidden
 * order book (whose fills used to leak onto the tape).
 *
 * One env var, read at the moment the bot service builds its coordinator:
 *
 *   ENABLE_TRADING_FLOOR=true
 *     -> "floor mode": the FloorCoordinator drives bots ONLY through the
 *        Strategy quote interface (requestQuote / respondQuote / hit / lift).
 *        The order-book path (submitOrder) is never taken for bots.
 *
 *   unset / anything else
 *     -> "legacy mode": bots drive the order book via submitOrder exactly as
 *        before. Nothing about the old layout changes.
 *
 * Kept deliberately dumb (an exact "true" match, like the client) so the two
 * sides read the flag the same way and there is no third truthy interpretation
 * to drift on.
 */

/** True only when the env var is exactly the string "true". */
export function isFloorModeEnabled(): boolean {
  return process.env.ENABLE_TRADING_FLOOR === 'true';
}
