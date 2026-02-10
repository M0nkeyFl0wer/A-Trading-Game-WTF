import { Round, type Player as TablePlayer, type Trade } from '@trading-game/core';
import { DEFAULT_DECK, computeEV } from '@trading-game/shared';
import type { RoomPlayer, RoomRecord, RoomStatus } from './roomService';
import { logger } from '../lib/logger';

export interface TradeSummary {
  id: string; playerId: string; playerName: string; counterpartyId: string; counterpartyName: string;
  quantity: number; price: number; value: number; type: 'buy' | 'sell'; timestamp: number;
}

export interface RoomGameState {
  roundNumber: number; phase: RoomStatus; communityCards: number[];
  trades: TradeSummary[]; playerCards: Array<{ id: string; value: number }>; updatedAt: number;
}

interface GameResult { players: RoomPlayer[]; status: RoomStatus; roundNumber: number; gameState: RoomGameState; }

const BOT_PROFILES: Record<string, { aggressiveness: number; spreadFactor: number }> = {
  BULL: { aggressiveness: 0.8, spreadFactor: 0.15 },
  BEAR: { aggressiveness: 0.5, spreadFactor: 0.25 },
  WHALE: { aggressiveness: 0.9, spreadFactor: 0.10 },
  ROOKIE: { aggressiveness: 0.4, spreadFactor: 0.35 },
  DEALER: { aggressiveness: 0.6, spreadFactor: 0.20 },
};

export class GameEngine {
  generateBotTrades(room: RoomRecord): TradeSummary[] {
    const bots = room.players.filter((p) => p.isBot);
    const humans = room.players.filter((p) => !p.isBot);
    if (bots.length === 0) return [];
    const allPlayers = room.players;
    const trades: TradeSummary[] = [];
    const timestamp = Date.now();
    for (const bot of bots) {
      const profile = BOT_PROFILES[bot.character] ?? BOT_PROFILES.DEALER;
      const cardDelta = (Math.random() - 0.5) * 20;
      const ev = computeEV(cardDelta);
      const spread = ev * profile.spreadFactor;
      const bid = Number((ev - spread / 2).toFixed(2));
      const ask = Number((ev + spread / 2).toFixed(2));
      const isBuying = Math.random() < profile.aggressiveness;
      const price = isBuying ? ask : bid;
      const quantity = 1 + Math.floor(Math.random() * 3);
      const candidates = humans.length > 0 ? humans : allPlayers.filter((p) => p.id !== bot.id);
      if (candidates.length === 0) continue;
      const counterparty = candidates[Math.floor(Math.random() * candidates.length)];
      trades.push({
        id: `bot-${bot.id}-${timestamp}`, playerId: bot.id, playerName: bot.name,
        counterpartyId: counterparty.id, counterpartyName: counterparty.name,
        quantity, price, value: price * quantity, type: isBuying ? 'buy' : 'sell',
        timestamp: timestamp + trades.length * 400,
      });
    }
    return trades;
  }

  completeRound(room: RoomRecord, pendingTrades: TradeSummary[]): GameResult {
    const roundNumber = room.roundNumber;
    const tablePlayers: TablePlayer[] = room.players.map((player) => ({ id: player.id, balance: player.balance, position: 0 }));
    const round = new Round({ players: tablePlayers, pot: 0 }, [...DEFAULT_DECK]);
    try { round.deal(); } catch (error) { logger.error({ err: error, roomId: room.id }, 'failed to deal round'); throw error; }
    const tradeData = this.prepareTrades(tablePlayers, pendingTrades, room.players);
    round.reveal();
    round.settle(tradeData.trades);
    const winningBalance = Math.max(...tablePlayers.map((p) => p.balance));
    const updatedPlayers: RoomPlayer[] = room.players.map((player) => {
      const tablePlayer = tablePlayers.find((p) => p.id === player.id);
      const balance = tablePlayer?.balance ?? player.balance;
      return { ...player, balance: Number(balance.toFixed(2)), isWinner: balance === winningBalance };
    });
    const gameState: RoomGameState = {
      roundNumber, phase: 'finished', communityCards: round.getCommunityCardValues(),
      trades: tradeData.summaries, playerCards: tablePlayers.map((p) => ({ id: p.id, value: p.card?.value ?? 0 })),
      updatedAt: Date.now(),
    };
    return { players: updatedPlayers, status: 'finished', roundNumber, gameState };
  }

  private prepareTrades(players: TablePlayer[], pending: TradeSummary[], roomPlayers: RoomPlayer[]): { trades: Trade[]; summaries: TradeSummary[] } {
    const trades: Trade[] = [];
    const summaries: TradeSummary[] = [];
    const nameMap = new Map(roomPlayers.map((p) => [p.id, p.name]));
    const addTrade = (summary: TradeSummary) => {
      const buyer = summary.type === 'buy' ? summary.playerId : summary.counterpartyId;
      const seller = summary.type === 'buy' ? summary.counterpartyId : summary.playerId;
      trades.push({ from: seller, to: buyer, price: summary.price, quantity: summary.quantity });
      summaries.push({ ...summary, playerName: nameMap.get(summary.playerId) ?? summary.playerName, counterpartyName: nameMap.get(summary.counterpartyId) ?? summary.counterpartyName });
    };
    pending.forEach(addTrade);
    return { trades, summaries };
  }
}

export const gameEngine = new GameEngine();
