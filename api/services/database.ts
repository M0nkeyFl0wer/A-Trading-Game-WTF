import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../lib/logger';

let db: Database.Database | null = null;

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'trading-game.db');

export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const dir = path.dirname(DB_PATH);
  const fs = require('fs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);

  logger.info({ path: DB_PATH }, 'SQLite database initialized');
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      room_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      player_id TEXT,
      payload TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_room ON audit_log(room_id);
    CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_log(event_type);

    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      amount REAL NOT NULL,
      entry_type TEXT NOT NULL,
      counterpart_id INTEGER,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_room ON ledger(room_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_player ON ledger(player_id);
  `);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('SQLite database closed');
  }
}
