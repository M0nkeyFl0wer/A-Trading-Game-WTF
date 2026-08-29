/**
 * Vitest setup file for the api package (issue #8: hermetic tests).
 *
 * Runs BEFORE any test file is loaded, which matters because
 * `api/services/database.ts` reads `process.env.DB_PATH` at module load and
 * `api/server.ts` reads PORT/HOST at module load. Anything set here is
 * therefore already in place when a test does `await import('../server')`.
 *
 * Guarantees:
 *   - DB_PATH points at a per-process temp file, never `api/data/game.db`,
 *     so tests can never write "Smoke Test Room" rows into the real lobby.
 *   - PORT=0 lets the OS pick a free port if anything does listen, so two
 *     concurrent runs (or a running dev server on 3001) never clash.
 *   - HOST=127.0.0.1 keeps any accidental listener off the LAN.
 *   - afterAll closes the SQLite handle and deletes the temp file.
 */
import { afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// One directory per test process: vitest may run files in parallel workers,
// and better-sqlite3 will happily let two processes share (and corrupt) a file.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-game-api-test-'));
const dbPath = path.join(tmpDir, `${process.pid}.db`);

process.env.DB_PATH = dbPath;
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';

afterAll(async () => {
  // Close the connection before unlinking; otherwise SQLite keeps the inode
  // alive and the -wal / -shm sidecars linger.
  try {
    const { closeDatabase } = await import('../services/database');
    closeDatabase();
  } catch {
    // database module may never have been imported by this test file
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
