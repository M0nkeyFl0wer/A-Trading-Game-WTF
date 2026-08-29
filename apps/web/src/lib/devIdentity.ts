/**
 * Per-browser dev identity (issue #10).
 *
 * When the app runs with VITE_DEV_AUTH=true there is no Firebase user, so the
 * client mints its own identity ONCE per browser and keeps it in localStorage.
 * Every friend on the tunnel therefore gets a distinct uid, and the same uid
 * is carried in the bearer token `dev:<uid>` on every HTTP request AND in the
 * socket handshake — the API resolves both through one helper
 * (`api/lib/devIdentity.ts`), so HTTP identity always equals socket identity.
 *
 * Before this, the uid was hard-coded to `dev-user` and the token to
 * `dev-token`: everyone merged into one player and sockets were assigned an
 * unrelated `dev-<socket.id>`, so `join-room` was refused and the table froze.
 */

/** localStorage key holding the generated id. */
export const DEV_USER_ID_KEY = 'dev-user-id';

/** The server accepts exactly this shape as a dev id (`api/lib/devIdentity.ts`). */
export const SAFE_DEV_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Minimal storage surface so tests can pass an in-memory stand-in. */
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Accessing localStorage throws in some privacy modes / sandboxed frames.
    return null;
  }
};

/** Fresh id: a UUID with the dashes stripped, so it stays within the server's allowlist. */
export const generateDevUserId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  // Very old browsers: still random enough for a friend test, still allowlisted.
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
};

/**
 * Return this browser's dev user id, creating and persisting it on first use.
 *
 * A stored value that fails the allowlist (hand-edited, corrupted) is replaced
 * rather than trusted, since the server would reject it anyway. Without any
 * usable storage the id is regenerated per call — fine for a single page load
 * but tabs won't share it, which is the best we can do.
 */
export const getDevUserId = (storage: StorageLike | null = defaultStorage()): string => {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(DEV_USER_ID_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored && SAFE_DEV_ID_RE.test(stored)) {
    return stored;
  }
  const fresh = generateDevUserId();
  try {
    storage?.setItem(DEV_USER_ID_KEY, fresh);
  } catch {
    // Storage full / disabled: proceed with the in-memory id.
  }
  return fresh;
};

/** `Dev Trader a1b2` — must match the server's default so lobby and client agree. */
export const devDisplayName = (uid: string): string => `Dev Trader ${uid.slice(0, 4)}`;

/** The bearer token the API's dev bypass parses: `dev:<uid>`. */
export const devIdToken = (uid: string): string => `dev:${uid}`;
