import Database from 'better-sqlite3';
import path from 'path';
<<<<<<< HEAD
import fs from 'fs';
import { logger } from '../lib/logger';

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'game.db');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
=======
import { logger } from '../lib/logger';

let db: Database.Database | null = null;

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'trading-game.db');

export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const dir = path.dirname(DB_PATH);
  const fs = require('fs');
>>>>>>> worktree-agent-ae062c60
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
<<<<<<< HEAD
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  createTables(db);
=======

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
>>>>>>> worktree-agent-ae062c60

  logger.info({ path: DB_PATH }, 'SQLite database initialized');
  return db;
}

<<<<<<< HEAD
function createTables(db: Database.Database): void {
  db.exec(`
    -- Core game tables --------------------------------------------------

    CREATE TABLE IF NOT EXISTS rooms (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      host_id       TEXT NOT NULL,
      host_name     TEXT NOT NULL,
      max_players   INTEGER NOT NULL DEFAULT 5,
      status        TEXT NOT NULL DEFAULT 'waiting',
      round_number  INTEGER NOT NULL DEFAULT 0,
      round_ends_at INTEGER,
      game_state    TEXT,
      pending_trades TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id            TEXT NOT NULL,
      room_id       TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      character     TEXT NOT NULL DEFAULT 'DEALER',
      balance       REAL NOT NULL DEFAULT 1000,
      is_host       INTEGER NOT NULL DEFAULT 0,
      is_bot        INTEGER NOT NULL DEFAULT 0,
      is_winner     INTEGER NOT NULL DEFAULT 0,
      joined_at     INTEGER NOT NULL,
      PRIMARY KEY (id, room_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id       TEXT NOT NULL,
      round_number  INTEGER NOT NULL,
      phase         TEXT NOT NULL DEFAULT 'playing',
      community_cards TEXT,
      started_at    INTEGER NOT NULL,
      ended_at      INTEGER,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trades (
      id            TEXT PRIMARY KEY,
      round_id      INTEGER,
      room_id       TEXT NOT NULL,
      player_id     TEXT NOT NULL,
      player_name   TEXT NOT NULL,
      counterparty_id   TEXT NOT NULL,
      counterparty_name TEXT NOT NULL,
      direction     TEXT NOT NULL,
      price         REAL NOT NULL,
      quantity      INTEGER NOT NULL DEFAULT 1,
      value         REAL NOT NULL,
      timestamp     INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE SET NULL
    );

    -- Knowledge graph tables --------------------------------------------

    CREATE TABLE IF NOT EXISTS kg_entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      properties TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kg_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      properties TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (source_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES kg_entities(id) ON DELETE CASCADE
    );

    -- Order book (new game mechanics) ------------------------------------

    CREATE TABLE IF NOT EXISTS orders (
      id            TEXT PRIMARY KEY,
      round_id      INTEGER,
      room_id       TEXT NOT NULL,
      player_id     TEXT NOT NULL,
      player_name   TEXT NOT NULL,
      side          TEXT NOT NULL,
      price         REAL NOT NULL,
      quantity      INTEGER NOT NULL DEFAULT 1,
      filled_qty    INTEGER NOT NULL DEFAULT 0,
      phase         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'open',
      timestamp     INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    -- Indexes -----------------------------------------------------------

    CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_room ON rounds(room_id);
    CREATE INDEX IF NOT EXISTS idx_trades_room ON trades(room_id);
    CREATE INDEX IF NOT EXISTS idx_trades_round ON trades(round_id);
    CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
    CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(type);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_source ON kg_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_target ON kg_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_relation ON kg_edges(relation);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_source_relation ON kg_edges(source_id, relation);
    CREATE INDEX IF NOT EXISTS idx_orders_room ON orders(room_id);
    CREATE INDEX IF NOT EXISTS idx_orders_room_status ON orders(room_id, status);
=======
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
>>>>>>> worktree-agent-ae062c60
  `);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('SQLite database closed');
  }
}
