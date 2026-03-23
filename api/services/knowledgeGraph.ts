import type Database from 'better-sqlite3';
import type { TradingPhase } from '@trading-game/shared';
import { getDatabase } from './database';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KGEntity {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
}

export interface KGEdge {
  id: number;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  properties: Record<string, unknown> | null;
  created_at: number;
}

export interface PlayerProfile {
  entityId: string;
  totalTrades: number;
  avgPrice: number;
  buyCount: number;
  sellCount: number;
  buySellRatio: number;
  avgTradeSize: number;
  aggressionScore: number; // 0-1, higher = more aggressive
  winRate: number;
  wins: number;
  losses: number;
  observedPatterns: string[];
}

export interface MatchupHistory {
  totalEncounters: number;
  botWins: number;
  opponentWins: number;
  avgPriceDelta: number;
  recentTrades: Array<{
    relation: string;
    weight: number;
    properties: Record<string, unknown> | null;
  }>;
}

export interface MarketSentiment {
  totalBuys: number;
  totalSells: number;
  buyPressure: number; // 0-1
  avgPrice: number;
  volatility: number;
  tradeCount: number;
}

export interface TradeObservation {
  playerId: string;
  counterpartyId: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  value: number;
}

export interface RoundContext {
  roomId: string;
  roundNumber: number;
}

export interface RoundResult {
  playerId: string;
  balanceDelta: number;
  isWinner: boolean;
}

export interface OrderPatternData {
  bidCount: number;
  askCount: number;
  avgBidPrice: number;
  avgAskPrice: number;
  cancelCount: number;
  netPosition: number;
  activation: number;
  fairValueEstimate: number;
}

export interface PhaseSummaryData {
  totalTrades: number;
  avgPrice: number;
  priceRange: [number, number];
  volumeByPlayer: Record<string, number>;
}

export interface PlayerOrderProfile {
  avgSpread: number;
  bidAskRatio: number;        // >1 = buy-biased, <1 = sell-biased
  avgActivation: number;
  cancelRate: number;          // cancels / total orders
  phasePreference: TradingPhase | null;  // which phase they're most active in
}

// ---------------------------------------------------------------------------
// Prepared statement cache – built lazily, once per database connection
// ---------------------------------------------------------------------------

interface Statements {
  upsertEntity: Database.Statement;
  getEntity: Database.Statement;
  findEntities: Database.Statement;
  addEdge: Database.Statement;
  getEdges: Database.Statement;
  getEdgesFiltered: Database.Statement;
  getIncomingEdges: Database.Statement;
  getIncomingEdgesFiltered: Database.Statement;
  updateEdgeWeight: Database.Statement;
  getTradeEdges: Database.Statement;
  getWinLossEdges: Database.Statement;
  getMatchupEdges: Database.Statement;
  getPatternEdges: Database.Statement;
  getRoomTradeEdges: Database.Statement;
  getRecentRoomPrices: Database.Statement;
  getOrderPatternsByPlayer: Database.Statement;
}

let stmts: Statements | null = null;

function prepareStatements(db: Database.Database): Statements {
  if (stmts) return stmts;

  stmts = {
    upsertEntity: db.prepare(`
      INSERT INTO kg_entities (id, type, name, properties, created_at, updated_at)
      VALUES (@id, @type, @name, @properties, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(@name, name),
        properties = COALESCE(@properties, properties),
        updated_at = @now
    `),

    getEntity: db.prepare(`
      SELECT * FROM kg_entities WHERE id = ?
    `),

    findEntities: db.prepare(`
      SELECT * FROM kg_entities WHERE type = ? ORDER BY updated_at DESC LIMIT ?
    `),

    addEdge: db.prepare(`
      INSERT INTO kg_edges (source_id, target_id, relation, weight, properties, created_at)
      VALUES (@source_id, @target_id, @relation, @weight, @properties, @created_at)
    `),

    getEdges: db.prepare(`
      SELECT * FROM kg_edges WHERE source_id = ? ORDER BY created_at DESC LIMIT ?
    `),

    getEdgesFiltered: db.prepare(`
      SELECT * FROM kg_edges WHERE source_id = ? AND relation = ? ORDER BY created_at DESC LIMIT ?
    `),

    getIncomingEdges: db.prepare(`
      SELECT * FROM kg_edges WHERE target_id = ? ORDER BY created_at DESC LIMIT ?
    `),

    getIncomingEdgesFiltered: db.prepare(`
      SELECT * FROM kg_edges WHERE target_id = ? AND relation = ? ORDER BY created_at DESC LIMIT ?
    `),

    updateEdgeWeight: db.prepare(`
      UPDATE kg_edges SET weight = ? WHERE id = ?
    `),

    // Aggregation queries for bot-specific lookups

    getTradeEdges: db.prepare(`
      SELECT relation, weight, properties
      FROM kg_edges
      WHERE source_id = ? AND relation IN ('bought', 'sold')
      ORDER BY created_at DESC
      LIMIT ?
    `),

    getWinLossEdges: db.prepare(`
      SELECT relation, COUNT(*) as cnt
      FROM kg_edges
      WHERE source_id = ? AND relation IN ('beat', 'lost_to')
      GROUP BY relation
    `),

    getMatchupEdges: db.prepare(`
      SELECT relation, weight, properties
      FROM kg_edges
      WHERE source_id = ? AND target_id = ?
        AND relation IN ('traded_with', 'beat', 'lost_to', 'bought', 'sold')
      ORDER BY created_at DESC
      LIMIT ?
    `),

    getPatternEdges: db.prepare(`
      SELECT target_id, weight
      FROM kg_edges
      WHERE source_id = ? AND relation = 'observed_pattern'
      ORDER BY weight DESC
      LIMIT ?
    `),

    getRoomTradeEdges: db.prepare(`
      SELECT relation, weight, properties
      FROM kg_edges
      WHERE source_id = ? AND relation IN ('bought', 'sold')
      ORDER BY created_at DESC
      LIMIT ?
    `),

    getRecentRoomPrices: db.prepare(`
      SELECT
        json_extract(properties, '$.price') AS price,
        relation
      FROM kg_edges
      WHERE source_id = ? AND relation IN ('bought', 'sold')
      ORDER BY created_at DESC
      LIMIT ?
    `),

    getOrderPatternsByPlayer: db.prepare(`
      SELECT e.properties
      FROM kg_entities e
      INNER JOIN kg_edges ed ON ed.target_id = e.id
      WHERE ed.source_id = ? AND ed.relation = 'observed_order_pattern' AND e.type = 'order_pattern'
      ORDER BY e.updated_at DESC
      LIMIT ?
    `),
  };

  return stmts;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class KnowledgeGraphService {
  private get db(): Database.Database {
    return getDatabase();
  }

  private get s(): Statements {
    return prepareStatements(this.db);
  }

  // ---- Entity operations -------------------------------------------------

  upsertEntity(
    id: string,
    type: string,
    name: string,
    properties?: Record<string, unknown>,
  ): void {
    try {
      this.s.upsertEntity.run({
        id,
        type,
        name,
        properties: properties ? JSON.stringify(properties) : null,
        now: Date.now(),
      });
    } catch (err) {
      logger.error({ err, entityId: id }, 'kg: failed to upsert entity');
    }
  }

  getEntity(id: string): KGEntity | null {
    try {
      const row = this.s.getEntity.get(id) as any;
      return row ? this.hydrateEntity(row) : null;
    } catch (err) {
      logger.error({ err, entityId: id }, 'kg: failed to get entity');
      return null;
    }
  }

  findEntities(type: string, limit = 50): KGEntity[] {
    try {
      const rows = this.s.findEntities.all(type, limit) as any[];
      return rows.map(this.hydrateEntity);
    } catch (err) {
      logger.error({ err, type }, 'kg: failed to find entities');
      return [];
    }
  }

  // ---- Edge operations ---------------------------------------------------

  addEdge(
    sourceId: string,
    targetId: string,
    relation: string,
    weight = 1.0,
    properties?: Record<string, unknown>,
  ): void {
    try {
      this.s.addEdge.run({
        source_id: sourceId,
        target_id: targetId,
        relation,
        weight,
        properties: properties ? JSON.stringify(properties) : null,
        created_at: Date.now(),
      });
    } catch (err) {
      logger.error({ err, sourceId, targetId, relation }, 'kg: failed to add edge');
    }
  }

  getEdges(sourceId: string, relation?: string, limit = 50): KGEdge[] {
    try {
      const rows = relation
        ? (this.s.getEdgesFiltered.all(sourceId, relation, limit) as any[])
        : (this.s.getEdges.all(sourceId, limit) as any[]);
      return rows.map(this.hydrateEdge);
    } catch (err) {
      logger.error({ err, sourceId, relation }, 'kg: failed to get edges');
      return [];
    }
  }

  getIncomingEdges(targetId: string, relation?: string, limit = 50): KGEdge[] {
    try {
      const rows = relation
        ? (this.s.getIncomingEdgesFiltered.all(targetId, relation, limit) as any[])
        : (this.s.getIncomingEdges.all(targetId, limit) as any[]);
      return rows.map(this.hydrateEdge);
    } catch (err) {
      logger.error({ err, targetId, relation }, 'kg: failed to get incoming edges');
      return [];
    }
  }

  // ---- Bot-specific queries (the money methods) --------------------------

  getPlayerProfile(playerId: string): PlayerProfile {
    const empty: PlayerProfile = {
      entityId: playerId,
      totalTrades: 0,
      avgPrice: 100,
      buyCount: 0,
      sellCount: 0,
      buySellRatio: 0.5,
      avgTradeSize: 1,
      aggressionScore: 0.5,
      winRate: 0.5,
      wins: 0,
      losses: 0,
      observedPatterns: [],
    };

    try {
      // Trade history
      const tradeRows = this.s.getTradeEdges.all(playerId, 200) as any[];
      if (tradeRows.length === 0) return empty;

      let totalPrice = 0;
      let totalQty = 0;
      let buyCount = 0;
      let sellCount = 0;

      for (const row of tradeRows) {
        const props = row.properties ? JSON.parse(row.properties) : {};
        const price = props.price ?? 100;
        const qty = props.quantity ?? 1;
        totalPrice += price;
        totalQty += qty;
        if (row.relation === 'bought') buyCount++;
        else sellCount++;
      }

      const totalTrades = tradeRows.length;
      const avgPrice = totalPrice / totalTrades;
      const avgTradeSize = totalQty / totalTrades;
      const buySellRatio = totalTrades > 0 ? buyCount / totalTrades : 0.5;

      // Aggression: high buy ratio + high avg price + high volume = aggressive
      const priceAggression = Math.min(avgPrice / 120, 1); // normalize around 120
      const aggressionScore = (buySellRatio * 0.4 + priceAggression * 0.3 + Math.min(avgTradeSize / 3, 1) * 0.3);

      // Win/loss record
      const wlRows = this.s.getWinLossEdges.all(playerId) as any[];
      let wins = 0;
      let losses = 0;
      for (const row of wlRows) {
        if (row.relation === 'beat') wins = row.cnt;
        if (row.relation === 'lost_to') losses = row.cnt;
      }
      const totalMatches = wins + losses;
      const winRate = totalMatches > 0 ? wins / totalMatches : 0.5;

      // Observed patterns
      const patternRows = this.s.getPatternEdges.all(playerId, 10) as any[];
      const observedPatterns = patternRows.map((r: any) => r.target_id);

      return {
        entityId: playerId,
        totalTrades,
        avgPrice,
        buyCount,
        sellCount,
        buySellRatio,
        avgTradeSize,
        aggressionScore,
        winRate,
        wins,
        losses,
        observedPatterns,
      };
    } catch (err) {
      logger.error({ err, playerId }, 'kg: failed to build player profile');
      return empty;
    }
  }

  getMatchupHistory(botId: string, opponentId: string): MatchupHistory {
    const empty: MatchupHistory = {
      totalEncounters: 0,
      botWins: 0,
      opponentWins: 0,
      avgPriceDelta: 0,
      recentTrades: [],
    };

    try {
      const rows = this.s.getMatchupEdges.all(botId, opponentId, 50) as any[];
      if (rows.length === 0) return empty;

      let botWins = 0;
      let opponentWins = 0;
      let priceDeltaSum = 0;
      let priceDeltaCount = 0;

      const recentTrades: MatchupHistory['recentTrades'] = [];

      for (const row of rows) {
        const props = row.properties ? JSON.parse(row.properties) : null;
        if (row.relation === 'beat') botWins++;
        else if (row.relation === 'lost_to') opponentWins++;

        if (props?.price) {
          priceDeltaSum += props.price - 100; // delta from baseline
          priceDeltaCount++;
        }

        recentTrades.push({
          relation: row.relation,
          weight: row.weight,
          properties: props,
        });
      }

      return {
        totalEncounters: rows.length,
        botWins,
        opponentWins,
        avgPriceDelta: priceDeltaCount > 0 ? priceDeltaSum / priceDeltaCount : 0,
        recentTrades: recentTrades.slice(0, 10),
      };
    } catch (err) {
      logger.error({ err, botId, opponentId }, 'kg: failed to get matchup history');
      return empty;
    }
  }

  getMarketSentiment(roomId: string): MarketSentiment {
    const empty: MarketSentiment = {
      totalBuys: 0,
      totalSells: 0,
      buyPressure: 0.5,
      avgPrice: 100,
      volatility: 0,
      tradeCount: 0,
    };

    try {
      const rows = this.s.getRecentRoomPrices.all(roomId, 100) as any[];
      if (rows.length === 0) return empty;

      let totalBuys = 0;
      let totalSells = 0;
      const prices: number[] = [];

      for (const row of rows) {
        if (row.relation === 'bought') totalBuys++;
        else totalSells++;
        if (row.price != null) prices.push(Number(row.price));
      }

      const tradeCount = rows.length;
      const buyPressure = tradeCount > 0 ? totalBuys / tradeCount : 0.5;
      const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 100;

      // Volatility: standard deviation of recent prices
      let volatility = 0;
      if (prices.length > 1) {
        const mean = avgPrice;
        const variance = prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
        volatility = Math.sqrt(variance);
      }

      return { totalBuys, totalSells, buyPressure, avgPrice, volatility, tradeCount };
    } catch (err) {
      logger.error({ err, roomId }, 'kg: failed to get market sentiment');
      return empty;
    }
  }

  // ---- Recording observations --------------------------------------------

  /**
   * Called after each trade is submitted. Creates/updates entity nodes for
   * both participants and adds directed trade edges.
   */
  recordTradeObservation(
    botId: string,
    trade: TradeObservation,
    context: RoundContext,
  ): void {
    try {
      const now = Date.now();

      // Ensure both entities exist
      this.upsertEntity(trade.playerId, 'player', trade.playerId);
      this.upsertEntity(trade.counterpartyId, 'player', trade.counterpartyId);

      // Room entity (for sentiment aggregation)
      this.upsertEntity(context.roomId, 'room', context.roomId);

      const edgeProps = {
        price: trade.price,
        quantity: trade.quantity,
        value: trade.value,
        roomId: context.roomId,
        roundNumber: context.roundNumber,
      };

      // Player -> bought/sold -> counterparty
      const relation = trade.side === 'buy' ? 'bought' : 'sold';
      this.addEdge(trade.playerId, trade.counterpartyId, relation, 1.0, edgeProps);

      // Bidirectional traded_with (lighter edge)
      this.addEdge(trade.playerId, trade.counterpartyId, 'traded_with', 1.0, edgeProps);

      // Room-level trade edge for sentiment aggregation
      this.addEdge(context.roomId, trade.counterpartyId, relation, trade.price, edgeProps);

      // Pattern detection: flag aggressive pricing
      if (trade.price > 110) {
        this.ensurePatternEntity('aggressive_buyer');
        this.addEdge(trade.playerId, 'pattern:aggressive_buyer', 'observed_pattern', trade.price / 100);
      } else if (trade.price < 90) {
        this.ensurePatternEntity('bargain_hunter');
        this.addEdge(trade.playerId, 'pattern:bargain_hunter', 'observed_pattern', (100 - trade.price) / 100);
      }

      if (trade.quantity >= 3) {
        this.ensurePatternEntity('high_volume');
        this.addEdge(trade.playerId, 'pattern:high_volume', 'observed_pattern', trade.quantity / 3);
      }
    } catch (err) {
      logger.error({ err, botId, trade }, 'kg: failed to record trade observation');
    }
  }

  /**
   * Called after a round settles. Records win/loss edges and updates
   * strategy effectiveness.
   */
  recordRoundOutcome(
    roomId: string,
    roundNumber: number,
    results: RoundResult[],
  ): void {
    try {
      const winners = results.filter((r) => r.isWinner);
      const losers = results.filter((r) => !r.isWinner);

      for (const winner of winners) {
        this.upsertEntity(winner.playerId, 'player', winner.playerId, {
          lastBalance: winner.balanceDelta,
        });

        // Winner beat each loser
        for (const loser of losers) {
          this.addEdge(winner.playerId, loser.playerId, 'beat', Math.abs(winner.balanceDelta), {
            roomId,
            roundNumber,
            balanceDelta: winner.balanceDelta,
          });
          this.addEdge(loser.playerId, winner.playerId, 'lost_to', Math.abs(loser.balanceDelta), {
            roomId,
            roundNumber,
            balanceDelta: loser.balanceDelta,
          });
        }
      }
    } catch (err) {
      logger.error({ err, roomId, roundNumber }, 'kg: failed to record round outcome');
    }
  }

  /**
   * Seed an entity for a new player/bot on first encounter.
   */
  ensurePlayerEntity(
    id: string,
    name: string,
    isBot: boolean,
    character?: string,
  ): void {
    const type = isBot ? 'bot' : 'player';
    this.upsertEntity(id, type, name, { character, isBot });
  }

  // ---- Order-book pattern recording -------------------------------------

  /**
   * Record an agent's order-book behavior for a single tick.
   * Upserts a per-player/room/phase entity and links it to the player.
   */
  recordOrderPattern(
    playerId: string,
    roomId: string,
    phase: TradingPhase,
    pattern: OrderPatternData,
  ): void {
    try {
      // Ensure the player entity exists
      this.upsertEntity(playerId, 'player', playerId);

      // Upsert the pattern entity (one per player/room/phase combo, updated each tick)
      const patternId = `pattern_${playerId}_${roomId}_${phase}`;
      this.upsertEntity(patternId, 'order_pattern', `${playerId} ${phase} pattern`, {
        ...pattern,
        roomId,
        phase,
        lastUpdated: Date.now(),
      });

      // Link player -> observed_order_pattern -> pattern entity
      // Use addEdge so we accumulate a history of observations over time
      this.addEdge(playerId, patternId, 'observed_order_pattern', pattern.activation, {
        roomId,
        phase,
        bidCount: pattern.bidCount,
        askCount: pattern.askCount,
        netPosition: pattern.netPosition,
        timestamp: Date.now(),
      });
    } catch (err) {
      logger.error({ err, playerId, roomId, phase }, 'kg: failed to record order pattern');
    }
  }

  /**
   * Record a phase-level summary after a phase ends.
   * Creates a standalone entity with trade/price stats for the phase.
   */
  recordPhaseSummary(
    roomId: string,
    roundNumber: number,
    phase: TradingPhase,
    summary: PhaseSummaryData,
  ): void {
    try {
      const summaryId = `phase_${roomId}_${roundNumber}_${phase}`;
      this.upsertEntity(summaryId, 'phase_summary', `${roomId} R${roundNumber} ${phase}`, {
        roomId,
        roundNumber,
        phase,
        ...summary,
        recordedAt: Date.now(),
      });

      // Link room -> had_phase -> summary
      this.upsertEntity(roomId, 'room', roomId);
      this.addEdge(roomId, summaryId, 'had_phase', summary.totalTrades, {
        roundNumber,
        phase,
        avgPrice: summary.avgPrice,
      });
    } catch (err) {
      logger.error({ err, roomId, roundNumber, phase }, 'kg: failed to record phase summary');
    }
  }

  /**
   * Get a player's historical trading profile from KG order-pattern data.
   * Aggregates across all recorded order patterns to produce stats
   * useful for bot decision-making.
   */
  getPlayerOrderProfile(playerId: string): PlayerOrderProfile | null {
    try {
      const rows = this.s.getOrderPatternsByPlayer.all(playerId, 200) as any[];
      if (rows.length === 0) return null;

      let totalBids = 0;
      let totalAsks = 0;
      let totalCancels = 0;
      let totalOrders = 0;
      let activationSum = 0;
      let spreadSum = 0;
      let spreadCount = 0;

      // Track activity per phase
      const phaseActivity: Record<string, number> = {};

      for (const row of rows) {
        const props = row.properties ? JSON.parse(row.properties) : null;
        if (!props) continue;

        totalBids += props.bidCount ?? 0;
        totalAsks += props.askCount ?? 0;
        totalCancels += props.cancelCount ?? 0;
        totalOrders += (props.bidCount ?? 0) + (props.askCount ?? 0) + (props.cancelCount ?? 0);
        activationSum += props.activation ?? 0;

        // Compute spread from avg bid/ask if both present
        if (props.avgBidPrice > 0 && props.avgAskPrice > 0) {
          spreadSum += props.avgAskPrice - props.avgBidPrice;
          spreadCount++;
        }

        // Accumulate phase activity
        const phase = props.phase as string;
        if (phase) {
          phaseActivity[phase] = (phaseActivity[phase] ?? 0) + (props.bidCount ?? 0) + (props.askCount ?? 0);
        }
      }

      const patternCount = rows.length;

      // Determine which phase has the most order activity
      let phasePreference: TradingPhase | null = null;
      let maxActivity = 0;
      for (const [phase, count] of Object.entries(phaseActivity)) {
        if (count > maxActivity) {
          maxActivity = count;
          phasePreference = phase as TradingPhase;
        }
      }

      return {
        avgSpread: spreadCount > 0 ? spreadSum / spreadCount : 0,
        bidAskRatio: totalAsks > 0 ? totalBids / totalAsks : totalBids > 0 ? Infinity : 1,
        avgActivation: patternCount > 0 ? activationSum / patternCount : 0,
        cancelRate: totalOrders > 0 ? totalCancels / totalOrders : 0,
        phasePreference,
      };
    } catch (err) {
      logger.error({ err, playerId }, 'kg: failed to get player order profile');
      return null;
    }
  }

  // ---- Helpers -----------------------------------------------------------

  private ensurePatternEntity(pattern: string): void {
    const id = `pattern:${pattern}`;
    this.upsertEntity(id, 'pattern', pattern);
  }

  private hydrateEntity(row: any): KGEntity {
    return {
      ...row,
      properties: row.properties ? JSON.parse(row.properties) : null,
    };
  }

  private hydrateEdge(row: any): KGEdge {
    return {
      ...row,
      properties: row.properties ? JSON.parse(row.properties) : null,
    };
  }
}

export const knowledgeGraph = new KnowledgeGraphService();
