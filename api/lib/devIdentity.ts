/**
 * Dev-auth identity resolution (issue #10).
 *
 * When Firebase Admin is not configured and AUTH_DEV_BYPASS=true, the API
 * still needs to tell players apart — otherwise every friend on a tunnel is
 * `dev-user`, a second join is a silent no-op, and the socket identity
 * (`dev-<socket.id>`) never matches the HTTP identity, so `join-room` is
 * rejected and the table freezes after Start.
 *
 * This module is the ONE place that decides who a dev-bypass caller is. It is
 * used by the HTTP middleware (`api/middleware/authenticate.ts`) and by both
 * socket.io bypass branches in `api/server.ts`, so the two transports can
 * never disagree again.
 *
 * Identity sources, in precedence order:
 *   1. Bearer token `dev:<id>` — what the web client sends everywhere (HTTP
 *      Authorization header AND socket handshake `auth.token`). The id is a
 *      per-browser UUID the client mints once into localStorage.
 *   2. Explicit id (`X-Dev-User-Id` header for curl; socket `auth.userId`) —
 *      kept so scripted tests can impersonate a chosen id without a token.
 *   3. `AUTH_DEV_USER_ID` env, else `dev-user` — the shared fallback.
 *
 * Display name: an explicit `X-Dev-User-Name` header (or socket `auth.name`)
 * wins if it passes validation; otherwise `Dev Trader <first 4 chars of id>`,
 * which is exactly what the client shows, so both ends agree on the label.
 *
 * NOTE: under bypass any caller may *choose* any id. That is accepted only for
 * trusted friends on a private URL — gate the hostname (e.g. Cloudflare
 * Access); never enable AUTH_DEV_BYPASS in production (server.ts refuses).
 */

/** Only ever active when the operator opted in via env. */
export const devBypassEnabled = process.env.AUTH_DEV_BYPASS === 'true';

/** Shared fallback identity when no token / id is supplied. */
export const devBypassUserId = process.env.AUTH_DEV_USER_ID || 'dev-user';
export const devBypassUserEmail = process.env.AUTH_DEV_USER_EMAIL || 'dev@example.com';

/** Ids are opaque handles that end up in DB rows and socket rooms: keep them tame. */
export const SAFE_DEV_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
/** Bearer token shape the web client sends in dev mode: `dev:<id>`. */
export const DEV_TOKEN_RE = /^dev:([a-zA-Z0-9_-]{1,64})$/;
/** Display names are rendered in the lobby: letters, digits, space, `_`, `-`; max 32. */
export const SAFE_DEV_NAME_RE = /^[a-zA-Z0-9 _-]{1,32}$/;

export interface DevUser {
  id: string;
  email: string;
  role: 'developer';
  /** Resolved display name — routes use this so each friend is seated under a distinct label. */
  name: string;
}

export interface DevIdentityInput {
  /** Raw bearer token (already stripped of the `Bearer ` prefix), if any. */
  token?: unknown;
  /** Explicit id override: `X-Dev-User-Id` header or socket `auth.userId`. */
  explicitId?: unknown;
  /** Explicit display name: `X-Dev-User-Name` header or socket `auth.name`. */
  explicitName?: unknown;
}

/** `Dev Trader a1b2` — the default label both client and server derive from an id. */
export const defaultDevDisplayName = (id: string): string => `Dev Trader ${id.slice(0, 4)}`;

/** Extract `<id>` from a `dev:<id>` token; null for anything else (including Firebase JWTs). */
export const parseDevToken = (token: unknown): string | null => {
  if (typeof token !== 'string') return null;
  const match = DEV_TOKEN_RE.exec(token);
  return match ? match[1] : null;
};

/** A display name is only honoured when it passes the strict allowlist; otherwise null. */
export const parseDevDisplayName = (name: unknown): string | null => {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return SAFE_DEV_NAME_RE.test(trimmed) ? trimmed : null;
};

/**
 * Resolve the dev-bypass identity for a request or socket handshake.
 *
 * Returns null when dev bypass is NOT enabled — callers must then fall back
 * to the real Firebase path (or reject), never invent an identity.
 */
export const resolveDevUser = (input: DevIdentityInput): DevUser | null => {
  if (!devBypassEnabled) return null;

  const tokenId = parseDevToken(input.token);
  const explicitId =
    typeof input.explicitId === 'string' && SAFE_DEV_ID_RE.test(input.explicitId)
      ? input.explicitId
      : null;

  const id = tokenId ?? explicitId ?? devBypassUserId;
  const name = parseDevDisplayName(input.explicitName) ?? defaultDevDisplayName(id);

  return { id, email: devBypassUserEmail, role: 'developer', name };
};
