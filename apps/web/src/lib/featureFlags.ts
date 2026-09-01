/**
 * Build-time feature flags.
 *
 * Money rails (crypto wallet, Stripe credit purchases) are built but NOT ready
 * to show players: there is no funded flow, no credits ledger UI, and enabling
 * a wallet button implies real value is at stake. Keep them dark until the
 * paid path is deliberately switched on. Everything defaults OFF; a flag turns
 * on only when its VITE_* var is exactly "true" at build time.
 *
 *   VITE_ENABLE_WALLET=true   -> show the Connect Wallet button
 *   VITE_ENABLE_CREDITS=true  -> show the Payments / Buy Credits entry (Stripe)
 */
const on = (v: unknown): boolean => v === 'true';

export const WALLET_ENABLED = on(import.meta.env.VITE_ENABLE_WALLET);
export const CREDITS_ENABLED = on(import.meta.env.VITE_ENABLE_CREDITS);
