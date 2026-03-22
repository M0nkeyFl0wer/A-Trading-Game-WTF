import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'game.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_orders_room ON orders(room_id);
    CREATE INDEX IF NOT EXISTS idx_orders_room_status ON orders(room_id, status);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
