import { createHash } from 'crypto';
import { getDatabase } from './database';
import { gameEvents, type GameEvent } from '../lib/gameEvents';
import { logger } from '../lib/logger';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

class AuditService {
  private lastHash: string = GENESIS_HASH;
  private initialized = false;

  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    const db = getDatabase();
    const lastRow = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as
      | { hash: string }
      | undefined;

    if (lastRow) {
      this.lastHash = lastRow.hash;
    }

    gameEvents.on('game_event', (event) => {
      try {
        this.logEvent(event);
      } catch (err) {
        logger.error({ err, event: event.type }, 'failed to write audit log entry');
      }
    });

    logger.info('Audit service initialized');
  }

  logEvent(event: GameEvent): void {
    const payload = JSON.stringify(event.payload);
    const hash = createHash('sha256')
      .update(this.lastHash + event.type + payload + event.timestamp)
      .digest('hex');

    const db = getDatabase();
    db.prepare(
      `INSERT INTO audit_log (event_type, room_id, round_number, player_id, payload, timestamp, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.type,
      event.roomId,
      event.roundNumber,
      (event.payload.playerId as string) ?? null,
      payload,
      event.timestamp,
      this.lastHash,
      hash,
    );

    this.lastHash = hash;
  }

  verifyChain(roomId?: string): { valid: boolean; brokenAt?: number } {
    const db = getDatabase();
    const query = roomId
      ? 'SELECT * FROM audit_log WHERE room_id = ? ORDER BY id ASC'
      : 'SELECT * FROM audit_log ORDER BY id ASC';
    const rows: AuditRow[] = roomId
      ? (db.prepare(query).all(roomId) as AuditRow[])
      : (db.prepare(query).all() as AuditRow[]);

    let prevHash = GENESIS_HASH;
    for (const row of rows) {
      const expected = createHash('sha256')
        .update(prevHash + row.event_type + row.payload + row.timestamp)
        .digest('hex');
      if (expected !== row.hash) {
        return { valid: false, brokenAt: row.id };
      }
      prevHash = row.hash;
    }
    return { valid: true };
  }

  getEvents(roomId: string): AuditRow[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM audit_log WHERE room_id = ? ORDER BY id ASC')
      .all(roomId) as AuditRow[];
  }
}

interface AuditRow {
  id: number;
  event_type: string;
  room_id: string;
  round_number: number;
  player_id: string | null;
  payload: string;
  timestamp: number;
  prev_hash: string;
  hash: string;
}

export const auditService = new AuditService();
