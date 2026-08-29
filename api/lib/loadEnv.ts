/**
 * loadEnv — read `api/.env` into process.env before anything else runs.
 *
 * Why this exists: nothing in the API ever read `.env` (no dotenv, no
 * `--env-file`), so `AUTH_DEV_BYPASS=true` in the file had no effect and every
 * /api/room route answered 503. This module fixes that with Node's BUILT-IN
 * `process.loadEnvFile` (Node >= 20.12) — no new dependency.
 *
 * Rules:
 *   1. It must be the FIRST import in server.ts. ES imports are hoisted and
 *      evaluated in order, and several modules (logger, authenticate, database)
 *      read process.env at import time, so this has to run before them.
 *   2. Variables already set in the shell win. `process.loadEnvFile` never
 *      overrides existing keys, so `PORT=3300 npx tsx server.ts` still works
 *      with a `.env` that says PORT=3001.
 *   3. A missing `.env` is fine (the contract is "nothing is required"), and a
 *      malformed one must not crash the boot — we warn and carry on.
 */
import { existsSync } from 'fs';
import path from 'path';

// Resolve relative to THIS file, not the cwd, so `api/.env` is found whether
// the server is started from the repo root or from inside api/.
const envPath = path.join(__dirname, '..', '.env');

if (existsSync(envPath)) {
  try {
    // Older Node builds (< 20.12) lack loadEnvFile; guard so the API still
    // boots there, just without file-based config.
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
    } else {
      console.warn(`[loadEnv] process.loadEnvFile unavailable on Node ${process.version}; ${envPath} ignored`);
    }
  } catch (err) {
    // Parse errors etc. — report, but never take the server down over config.
    console.warn(`[loadEnv] failed to load ${envPath}:`, err);
  }
}
