import { Round, type Player as TablePlayer, type Trade } from '@trading-game/core';
import { DEFAULT_DECK } from '@trading-game/shared';
import type { RoomPlayer, RoomRecord, RoomStatus } from './roomService';
import { logger } from '../lib/logger';

export interface TradeSummary {
  id: string;
  player: string;
  counterparty: string;
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
  startRound(room: RoomRecord): GameResult {
    const roundNumber = room.roundNumber + 1;
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

    const tradeSimulation = this.simulateTrades(tablePlayers);
    round.reveal();
    round.settle(tradeSimulation.trades);

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
      trades: tradeSimulation.summaries,
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

  private simulateTrades(players: TablePlayer[]): { trades: Trade[]; summaries: TradeSummary[] } {
    if (players.length < 2) {
      return { trades: [], summaries: [] };
    }

    const trades: Trade[] = [];
    const summaries: TradeSummary[] = [];
    const timestamp = Date.now();

    const sampleCount = Math.min(players.length - 1, 3);
    for (let i = 0; i < sampleCount; i += 1) {
      const seller = players[i];
      const buyer = players[(i + 1) % players.length];
      const price = 95 + Math.floor(Math.random() * 15);
      const quantity = 1 + Math.floor(Math.random() * 3);

      trades.push({
        from: seller.id,
        to: buyer.id,
        price,
        quantity,
      });

      summaries.push({
        id: `trade_${timestamp}_${i}`,
        player: buyer.id,
        counterparty: seller.id,
        quantity,
        price,
        value: price * quantity,
        type: 'buy',
        timestamp: timestamp + i * 1000,
      });
    }

    return { trades, summaries };
  }
}

export const gameEngine = new GameEngine();
