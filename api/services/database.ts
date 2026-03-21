import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'game.db');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  fs.mkdirSync(DB_DIR, { recursive: true });

  db = new Database(DB_PATH);

  // WAL mode for concurrent read performance and crash resilience
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  createTables(db);

  return db;
}

function createTables(db: Database.Database): void {
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_room ON rounds(room_id);
    CREATE INDEX IF NOT EXISTS idx_trades_room ON trades(room_id);
    CREATE INDEX IF NOT EXISTS idx_trades_round ON trades(round_id);
    CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
  `);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
