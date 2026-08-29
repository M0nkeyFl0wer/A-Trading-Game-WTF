/**
 * DATA_DIR -- the single base directory for the API's on-disk state (issue #15).
 *
 * Both the SQLite database (services/database.ts) and the Ed25519 signing
 * keypair (lib/signing.ts) used to anchor themselves at `__dirname/../data`
 * independently. That resolves to `api/data` when run through tsx but to
 * `api/dist/data` from a compiled build, so switching launch method silently
 * generated a NEW keypair and an empty database. Deploy scripts also had no
 * way to put state on a persistent volume.
 *
 * Resolution order:
 *   1. `DATA_DIR` env var (absolute, or relative to the process cwd).
 *   2. `api/data` next to this source tree (the historical default, so an
 *      existing dev checkout keeps its lobby and keys).
 *
 * `DB_PATH` still wins over `DATA_DIR/game.db` for the database specifically --
 * the test harness relies on that to point every run at a temp file.
 */
import path from 'path';

export const DATA_DIR: string = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
