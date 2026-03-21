import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../lib/logger';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'game.db');

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dir = path.dirname(DB_PATH);
  const fs = require('fs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  createTables(db);

  logger.info({ path: DB_PATH }, 'SQLite database initialized');
  return db;
}

function createTables(db: Database.Database): void {
  db.exec(`
    -- Core game tables --------------------------------------------------

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      max_players INTEGER NOT NULL DEFAULT 5,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_bot INTEGER NOT NULL DEFAULT 0,
      character TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      counterparty_id TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      value REAL NOT NULL,
      timestamp INTEGER NOT NULL
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

    CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(type);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_source ON kg_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_target ON kg_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_relation ON kg_edges(relation);
    CREATE INDEX IF NOT EXISTS idx_kg_edges_source_relation ON kg_edges(source_id, relation);
  `);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('SQLite database closed');
  }
}
