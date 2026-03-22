import { getDatabase } from './database';
import { logger } from '../lib/logger';

export interface LedgerEntry {
  id: number;
  room_id: string;
  round_number: number;
  player_id: string;
  amount: number;
  entry_type: string;
  counterpart_id: number | null;
  timestamp: number;
}

class LedgerService {
  /**
   * Record settlement P&L for all players in a round.
   * Each entry represents the net gain or loss for that player.
   * In a zero-sum game, the sum of all entries for a round should be zero.
   */
  recordSettlement(roomId: string, roundNumber: number, pnl: Record<string, number>): void {
    const db = getDatabase();
    const insert = db.prepare(
      `INSERT INTO ledger (room_id, round_number, player_id, amount, entry_type, counterpart_id, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const now = Date.now();
    const transaction = db.transaction(() => {
      for (const [playerId, amount] of Object.entries(pnl)) {
        insert.run(roomId, roundNumber, playerId, amount, 'settlement_pnl', null, now);
      }
    });
    transaction();

    logger.debug({ roomId, roundNumber, players: Object.keys(pnl).length }, 'ledger entries recorded');
  }

  /**
   * Verify that all ledger entries for a given round sum to zero (within floating-point tolerance).
   */
  verifyZeroSum(roomId: string, roundNumber: number): { valid: boolean; sum: number } {
    const db = getDatabase();
    const result = db
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) as total FROM ledger WHERE room_id = ? AND round_number = ?',
      )
      .get(roomId, roundNumber) as { total: number };
    return { valid: Math.abs(result.total) < 0.01, sum: result.total };
  }

  /**
   * Get all ledger entries for a room, ordered chronologically.
   */
  getEntries(roomId: string): LedgerEntry[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM ledger WHERE room_id = ? ORDER BY id ASC')
      .all(roomId) as LedgerEntry[];
  }

  /**
   * Get cumulative balance for each player in a room across all rounds.
   */
  getPlayerBalances(roomId: string): Record<string, number> {
    const db = getDatabase();
    const rows = db
      .prepare(
        'SELECT player_id, SUM(amount) as total FROM ledger WHERE room_id = ? GROUP BY player_id',
      )
      .all(roomId) as Array<{ player_id: string; total: number }>;

    const balances: Record<string, number> = {};
    for (const row of rows) {
      balances[row.player_id] = row.total;
    }
    return balances;
  }
}

export const ledgerService = new LedgerService();
