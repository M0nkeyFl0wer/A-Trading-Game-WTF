import type { TradingAgent, AgentContext, AgentResponse, AgentActionType } from './types';
import type { RoomRecord, RoomPlayer } from '../services/roomService';
import type { TradingPhase } from '@trading-game/shared';
import { roomService, RoomServiceError } from '../services/roomService';
import { knowledgeGraph } from '../services/knowledgeGraph';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FloorConfig {
  tickIntervalMs: number;        // how often agents poll (default 3000)
  activationFloor: number;       // min activation to act (default 0.15)
  interruptThreshold: number;    // activation needed for aggressive action (default 0.7)
  activationDecay: number;       // multiplier for recent actors (default 0.3)
  cooldownMs: number;            // time before agent acts at full strength (default 5000)
  maxActionsPerTick: number;     // cap on agents acting per tick (default 3)
  commentaryThrottleMs: number;  // min time between voice lines (default 15000)
  actionDelayMs: [number, number]; // [min, max] delay between individual actions (default [300, 800])
}

const DEFAULT_FLOOR_CONFIG: FloorConfig = {
  tickIntervalMs: 3000,
  activationFloor: 0.15,
  interruptThreshold: 0.7,
  activationDecay: 0.3,
  cooldownMs: 5000,
  maxActionsPerTick: 3,
  commentaryThrottleMs: 15000,
  actionDelayMs: [300, 800],
};

// ---------------------------------------------------------------------------
// FloorCoordinator
// ---------------------------------------------------------------------------

export class FloorCoordinator {
  private agents = new Map<string, TradingAgent>();
  private recentActors = new Map<string, number>(); // agentId -> timestamp
  private lastCommentary = 0;
  private tickTimers = new Map<string, NodeJS.Timeout>(); // roomId -> timer
  private config: FloorConfig;

  constructor(config: Partial<FloorConfig> = {}) {
    this.config = { ...DEFAULT_FLOOR_CONFIG, ...config };
  }

  /** Register an agent (bot) with the coordinator. */
  registerAgent(agent: TradingAgent): void {
    this.agents.set(agent.id, agent);
  }

  /** Unregister an agent. */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /** Check if an agent is registered. */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** Start ticking for a room (called when a trading phase begins). */
  startTicking(roomId: string): void {
    this.stopTicking(roomId);

    const tick = async () => {
      try {
        await this.runTick(roomId);
      } catch (err) {
        logger.error({ err, roomId }, 'floor coordinator tick failed');
      }
    };

    // First tick after a short random delay to avoid synchronization
    setTimeout(tick, 2000 + Math.random() * 1000);

    const timer = setInterval(tick, this.config.tickIntervalMs);
    this.tickTimers.set(roomId, timer);
  }

  /** Stop ticking for a room. */
  stopTicking(roomId: string): void {
    const timer = this.tickTimers.get(roomId);
    if (timer) {
      clearInterval(timer);
      this.tickTimers.delete(roomId);
    }
  }

  /** Stop all ticking and clean up. */
  shutdown(): void {
    for (const [roomId] of this.tickTimers) {
      this.stopTicking(roomId);
    }
    this.agents.clear();
    this.recentActors.clear();
  }

  // -----------------------------------------------------------------------
  // Core tick loop
  // -----------------------------------------------------------------------

  /** Run a single tick: poll all agents, resolve floor, execute actions. */
  private async runTick(roomId: string): Promise<void> {
    let room: RoomRecord;
    try {
      room = await roomService.getRoom(roomId);
    } catch {
      this.stopTicking(roomId);
      return;
    }

    const phase = room.status;
    if (phase !== 'blind' && phase !== 'flop' && phase !== 'turn') {
      this.stopTicking(roomId);
      return;
    }

    const gs = room.gameState;
    if (!gs) return;

    // Find bot players in this room
    const botPlayers = room.players.filter(p => p.isBot);
    if (botPlayers.length === 0) return;

    // Build context and poll each agent
    const responses: Array<{
      agent: TradingAgent;
      player: RoomPlayer;
      response: AgentResponse;
    }> = [];

    for (const player of botPlayers) {
      const agent = this.agents.get(player.id);
      if (!agent) continue;

      const context = this.buildContext(player, room, gs);
      const response = agent.activate(context);

      // Apply activation decay for agents who acted recently
      const lastActed = this.recentActors.get(agent.id);
      if (lastActed && Date.now() - lastActed < this.config.cooldownMs) {
        response.activation *= this.config.activationDecay;
      }

      responses.push({ agent, player, response });
    }

    // Sort by activation descending (highest priority first)
    responses.sort((a, b) => b.response.activation - a.response.activation);

    // Resolve yield chains: agents that defer to others
    const yielded = new Set<string>();
    for (const r of responses) {
      if (r.response.yieldTo) {
        // Find the agent being yielded to by character name
        const target = responses.find(x => x.agent.character === r.response.yieldTo);
        if (target && target.response.activation > this.config.activationFloor) {
          yielded.add(r.agent.id);
        }
      }
    }

    // Filter to candidates: wants floor, above threshold, not yielded
    const candidates = responses.filter(r =>
      r.response.wantsFloor &&
      r.response.activation >= this.config.activationFloor &&
      !yielded.has(r.agent.id),
    );

    // Execute up to maxActionsPerTick agents this tick
    const actors = candidates.slice(0, this.config.maxActionsPerTick);

    for (const actor of actors) {
      await this.executeAgentActions(roomId, actor.agent, actor.player, actor.response);
      this.recentActors.set(actor.agent.id, Date.now());
    }

    // Handle commentary from the highest-activation agent that has something to say
    const topCommentary = actors.find(a => a.response.commentary);
    if (topCommentary?.response.commentary) {
      const now = Date.now();
      if (now - this.lastCommentary > this.config.commentaryThrottleMs) {
        this.lastCommentary = now;
        // Commentary is logged and can be picked up by commentator service via room events
        logger.debug(
          { agent: topCommentary.agent.name, text: topCommentary.response.commentary },
          'agent commentary',
        );
      }
    }

    // Record order-book patterns for every agent that responded this tick.
    // Wrapped in try/catch so KG failures never affect gameplay.
    try {
      this.recordTickPatterns(roomId, phase as TradingPhase, responses, gs);
    } catch (err) {
      logger.debug({ err, roomId }, 'kg: tick pattern recording failed (non-fatal)');
    }
  }

  // -----------------------------------------------------------------------
  // Action execution
  // -----------------------------------------------------------------------

  private async executeAgentActions(
    roomId: string,
    agent: TradingAgent,
    player: RoomPlayer,
    response: AgentResponse,
  ): Promise<void> {
    for (const action of response.actions) {
      try {
        switch (action.type) {
          case 'bid':
          case 'ask': {
            // Clamp price to sane bounds
            const price = Math.max(-50, Math.min(200, Math.round(action.price * 100) / 100));
            const quantity = Math.max(1, Math.min(10, action.quantity));
            await roomService.submitOrder(roomId, agent.id, {
              price,
              quantity,
              side: action.type,
            });
            logger.debug(
              { agent: agent.name, side: action.type, price, quantity, activation: response.activation },
              'agent order',
            );
            break;
          }
          case 'cancel': {
            await roomService.cancelOrder(roomId, agent.id, action.orderId);
            break;
          }
          case 'cancel_all': {
            // Cancel all open orders for this agent
            let room: RoomRecord;
            try {
              room = await roomService.getRoom(roomId);
            } catch {
              break;
            }
            const myOrders = (room.gameState?.orders ?? []).filter(
              o => o.playerId === agent.id && (o.status === 'open' || o.status === 'partial'),
            );
            for (const order of myOrders) {
              try {
                await roomService.cancelOrder(roomId, agent.id, order.id);
              } catch {
                // May fail due to 2s resting cooldown -- that's fine
              }
            }
            break;
          }
          case 'wait':
            break;
        }

        // Stagger between actions to simulate human think-time
        const [minDelay, maxDelay] = this.config.actionDelayMs;
        await new Promise(resolve =>
          setTimeout(resolve, minDelay + Math.random() * (maxDelay - minDelay)),
        );
      } catch (err) {
        if (err instanceof RoomServiceError) {
          logger.debug(
            { agent: agent.name, action: action.type, status: err.status, message: err.message },
            'agent action rejected',
          );
        } else {
          logger.warn({ err, agent: agent.name, action: action.type }, 'agent action failed');
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // KG pattern recording
  // -----------------------------------------------------------------------

  /**
   * After each tick, record per-agent order-book patterns into the
   * knowledge graph. This data feeds getPlayerOrderProfile() for
   * future bot decision-making.
   */
  private recordTickPatterns(
    roomId: string,
    phase: TradingPhase,
    responses: Array<{
      agent: TradingAgent;
      player: RoomPlayer;
      response: AgentResponse;
    }>,
    gs: NonNullable<RoomRecord['gameState']>,
  ): void {
    const orders = gs.orders ?? [];
    const trades = gs.matchedTrades ?? [];

    for (const { agent, player, response } of responses) {
      // Count this agent's open orders by side
      const myOrders = orders.filter(o => o.playerId === agent.id);
      const openBids = myOrders.filter(o => o.side === 'bid' && (o.status === 'open' || o.status === 'partial'));
      const openAsks = myOrders.filter(o => o.side === 'ask' && (o.status === 'open' || o.status === 'partial'));
      const cancelledOrders = myOrders.filter(o => o.status === 'cancelled');

      // Compute average prices (0 if none)
      const avgBid = openBids.length > 0
        ? openBids.reduce((s, o) => s + o.price, 0) / openBids.length
        : 0;
      const avgAsk = openAsks.length > 0
        ? openAsks.reduce((s, o) => s + o.price, 0) / openAsks.length
        : 0;

      // Net position from matched trades
      let netPosition = 0;
      for (const trade of trades) {
        if (trade.buyerId === agent.id) netPosition += trade.quantity;
        if (trade.sellerId === agent.id) netPosition -= trade.quantity;
      }

      // Estimate fair value from the midpoint of the agent's own orders,
      // falling back to the last trade price
      let fairValueEstimate = 0;
      if (avgBid > 0 && avgAsk > 0) {
        fairValueEstimate = (avgBid + avgAsk) / 2;
      } else if (trades.length > 0) {
        fairValueEstimate = trades[trades.length - 1].price;
      }

      knowledgeGraph.recordOrderPattern(agent.id, roomId, phase, {
        bidCount: openBids.length,
        askCount: openAsks.length,
        avgBidPrice: Math.round(avgBid * 100) / 100,
        avgAskPrice: Math.round(avgAsk * 100) / 100,
        cancelCount: cancelledOrders.length,
        netPosition,
        activation: response.activation,
        fairValueEstimate: Math.round(fairValueEstimate * 100) / 100,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Context building
  // -----------------------------------------------------------------------

  private buildContext(
    player: RoomPlayer,
    room: RoomRecord,
    gs: NonNullable<RoomRecord['gameState']>,
  ): AgentContext {
    const myCard = gs.playerCards?.find((c) => c.id === player.id)?.value ?? 0;
    const myOrders = (gs.orders ?? []).filter((o) => o.playerId === player.id);
    const openOrders = myOrders.filter(
      (o) => o.status === 'open' || o.status === 'partial',
    );

    // Calculate net position from matched trades
    let netPosition = 0;
    for (const trade of gs.matchedTrades ?? []) {
      if (trade.buyerId === player.id) netPosition += trade.quantity;
      if (trade.sellerId === player.id) netPosition -= trade.quantity;
    }

    // Determine price direction from the two most recent trades
    const trades = gs.matchedTrades ?? [];
    let priceDirection: 'up' | 'down' | 'flat' = 'flat';
    if (trades.length >= 2) {
      const last = trades[trades.length - 1].price;
      const prev = trades[trades.length - 2].price;
      if (last > prev + 0.5) priceDirection = 'up';
      else if (last < prev - 0.5) priceDirection = 'down';
    }

    // Build order book summary from live orders
    const bids = (gs.orders ?? [])
      .filter((o) => o.side === 'bid' && (o.status === 'open' || o.status === 'partial'))
      .sort((a, b) => b.price - a.price);
    const asks = (gs.orders ?? [])
      .filter((o) => o.side === 'ask' && (o.status === 'open' || o.status === 'partial'))
      .sort((a, b) => a.price - b.price);

    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    const lastTradePrice = trades.length > 0 ? trades[trades.length - 1].price : null;

    const phaseEndsAt = gs.phaseEndsAt ?? Date.now();

    return {
      agentId: player.id,
      myCard,
      revealedCommunityCards: gs.revealedCommunityCards ?? [],
      orderBook: {
        bids: bids.map((o) => ({ price: o.price, quantity: o.quantity - o.filledQuantity })),
        asks: asks.map((o) => ({ price: o.price, quantity: o.quantity - o.filledQuantity })),
        bestBid,
        bestAsk,
        spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
        lastTradePrice,
      },
      matchedTrades: trades,
      phase: gs.phase as AgentContext['phase'],
      timeRemainingMs: Math.max(0, phaseEndsAt - Date.now()),
      playerCount: room.players.length,
      socialState: {
        lastTrader: trades.length > 0 ? trades[trades.length - 1].buyerId : null,
        priceDirection,
        recentVolume: trades.filter((t) => t.timestamp > Date.now() - 10000).length,
        myOpenOrders: openOrders,
        myNetPosition: netPosition,
        myBalance: player.balance,
      },
    };
  }
}
