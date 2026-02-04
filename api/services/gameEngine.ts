import { Round, type Player as TablePlayer, type Trade } from '@trading-game/core';
import { DEFAULT_DECK } from '@trading-game/shared';
import type { RoomPlayer, RoomRecord, RoomStatus } from './roomService';
import { logger } from '../lib/logger';

export interface TradeSummary {
  id: string;
  playerId: string;
  playerName: string;
  counterpartyId: string;
  counterpartyName: string;
  quantity: number;
  price: number;
  value: number;
  type: 'buy' | 'sell';
  timestamp: number;
}

export interface RoomGameState {
  roundNumber: number;
  phase: RoomStatus;
  communityCards: number[];
  trades: TradeSummary[];
  playerCards: Array<{ id: string; value: number }>;
  updatedAt: number;
}

interface GameResult {
  players: RoomPlayer[];
  status: RoomStatus;
  roundNumber: number;
  gameState: RoomGameState;
}

export class GameEngine {
  completeRound(room: RoomRecord, pendingTrades: TradeSummary[]): GameResult {
    const roundNumber = room.roundNumber;
    const tablePlayers: TablePlayer[] = room.players.map((player) => ({
      id: player.id,
      balance: player.balance,
      position: 0,
    }));

    const round = new Round({ players: tablePlayers, pot: 0 }, [...DEFAULT_DECK]);
    try {
      round.deal();
    } catch (error) {
      logger.error({ err: error, roomId: room.id }, 'failed to deal round');
      throw error;
    }

    const tradeData = this.prepareTrades(tablePlayers, pendingTrades);
    round.reveal();
    round.settle(tradeData.trades);

    const winningBalance = Math.max(...tablePlayers.map((p) => p.balance));
    const updatedPlayers: RoomPlayer[] = room.players.map((player) => {
      const tablePlayer = tablePlayers.find((p) => p.id === player.id);
      const balance = tablePlayer?.balance ?? player.balance;
      return {
        ...player,
        balance: Number(balance.toFixed(2)),
        isWinner: balance === winningBalance,
      };
    });

    const gameState: RoomGameState = {
      roundNumber,
      phase: 'finished',
      communityCards: round.getCommunityCardValues(),
      trades: tradeData.summaries,
      playerCards: tablePlayers.map((p) => ({ id: p.id, value: p.card?.value ?? 0 })),
      updatedAt: Date.now(),
    };

    return {
      players: updatedPlayers,
      status: 'finished',
      roundNumber,
      gameState,
    };
  }

  private prepareTrades(players: TablePlayer[], pending: TradeSummary[]): { trades: Trade[]; summaries: TradeSummary[] } {
    const trades: Trade[] = [];
    const summaries: TradeSummary[] = [];

    const addTrade = (summary: TradeSummary) => {
      const buyer = summary.type === 'buy' ? summary.playerId : summary.counterpartyId;
      const seller = summary.type === 'buy' ? summary.counterpartyId : summary.playerId;
      trades.push({
        from: seller,
        to: buyer,
        price: summary.price,
        quantity: summary.quantity,
      });
      summaries.push(summary);
    };

    pending.forEach(addTrade);

    if (summaries.length < 3) {
      const timestamp = Date.now();
      const sampleCount = Math.min(players.length - 1, 3 - summaries.length);
      for (let i = 0; i < sampleCount; i += 1) {
        const seller = players[i];
        const buyer = players[(i + 1) % players.length];
        const price = 90 + Math.floor(Math.random() * 20);
        const quantity = 1 + Math.floor(Math.random() * 2);
        addTrade({
          id: `sim-${timestamp}-${i}`,
          playerId: buyer.id,
          playerName: buyer.id,
          counterpartyId: seller.id,
          counterpartyName: seller.id,
          quantity,
          price,
          value: price * quantity,
          type: 'buy',
          timestamp: timestamp + i * 500,
        });
      }
    }

    return { trades, summaries };
  }
}

export const gameEngine = new GameEngine();
