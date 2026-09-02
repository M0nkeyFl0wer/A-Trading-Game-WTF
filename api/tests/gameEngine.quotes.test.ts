import { describe, it, expect } from 'vitest';
import { gameEngine } from '../services/gameEngine';
import type { RoomRecord, RoomPlayer } from '../services/roomService';

function makePlayer(id: string, overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    id,
    name: id,
    joinedAt: Date.now(),
    balance: 1_000,
    character: 'DEALER',
    ...overrides,
  };
}

function makeRoom(overrides: Partial<RoomRecord> = {}): RoomRecord {
  const players = overrides.players ?? [makePlayer('alice'), makePlayer('bob')];
  const room: RoomRecord = {
    id: 'room_TEST',
    name: 'Test room',
    hostId: players[0].id,
    hostName: players[0].name,
    maxPlayers: 5,
    status: 'blind',
    players,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    roundNumber: 1,
    ...overrides,
  };
  room.gameState = gameEngine.dealRound(room);
  return room;
}

describe('gameEngine quote requests', () => {
  it('requestQuote appends a pending quote that expires no later than the phase', () => {
    const room = makeRoom();
    const gs = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');

    expect(gs.quotes).toHaveLength(1);
    const quote = gs.quotes![0];
    expect(quote.status).toBe('pending');
    expect(quote.requesterId).toBe('alice');
    expect(quote.targetId).toBe('bob');
    expect(quote.expiresAt).toBeLessThanOrEqual(room.gameState!.phaseEndsAt);
  });

  it('respondToQuote requires the bid/ask to be exactly 2 apart', () => {
    const room = makeRoom();
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
    const quoteId = room.gameState.quotes![0].id;

    expect(() => gameEngine.respondToQuote(room, quoteId, 60, 63)).toThrow(/2 points/);
  });

  it('respondToQuote flips a pending quote to quoted with the given prices', () => {
    const room = makeRoom();
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
    const quoteId = room.gameState.quotes![0].id;

    const gs = gameEngine.respondToQuote(room, quoteId, 60, 62);
    const quote = gs.quotes!.find((q) => q.id === quoteId)!;
    expect(quote.status).toBe('quoted');
    expect(quote.bidPrice).toBe(60);
    expect(quote.askPrice).toBe(62);
  });

  it('recordQuoteTrade for "hit" makes the requester the seller at the bid price', () => {
    const room = makeRoom();
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
    const quoteId = room.gameState.quotes![0].id;
    room.gameState = gameEngine.respondToQuote(room, quoteId, 60, 62);

    const { gameState, trade } = gameEngine.recordQuoteTrade(room, quoteId, 'hit');
    expect(trade.price).toBe(60);
    expect(trade.sellerId).toBe('alice');
    expect(trade.buyerId).toBe('bob');
    expect(trade.quantity).toBe(1);
    expect(gameState.matchedTrades).toContainEqual(trade);
    expect(gameState.quotes!.find((q) => q.id === quoteId)!.status).toBe('accepted');
  });

  it('recordQuoteTrade for "lift" makes the requester the buyer at the ask price', () => {
    const room = makeRoom();
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
    const quoteId = room.gameState.quotes![0].id;
    room.gameState = gameEngine.respondToQuote(room, quoteId, 60, 62);

    const { trade } = gameEngine.recordQuoteTrade(room, quoteId, 'lift');
    expect(trade.price).toBe(62);
    expect(trade.buyerId).toBe('alice');
    expect(trade.sellerId).toBe('bob');
  });

  it('recordQuoteTrade rejects a quote that has not been priced yet', () => {
    const room = makeRoom();
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
    const quoteId = room.gameState.quotes![0].id;

    expect(() => gameEngine.recordQuoteTrade(room, quoteId, 'hit')).toThrow(/not open/);
  });

  it('recordQuoteTrade rejects a second hit/lift on an already-accepted quote', () => {
    const room = makeRoom();
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
    const quoteId = room.gameState.quotes![0].id;
    room.gameState = gameEngine.respondToQuote(room, quoteId, 60, 62);
    room.gameState = gameEngine.recordQuoteTrade(room, quoteId, 'hit').gameState;

    expect(() => gameEngine.recordQuoteTrade(room, quoteId, 'lift')).toThrow(/not open/);
  });

  it('advancePhase expires any pending/quoted quote but leaves accepted ones alone', () => {
    const room = makeRoom();
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
    const pendingId = room.gameState.quotes![0].id;

    room.gameState = gameEngine.requestQuote(room, 'bob', 'bob', 'alice', 'alice');
    const quotedId = room.gameState.quotes![1].id;
    room.gameState = gameEngine.respondToQuote(room, quotedId, 58, 60);
    room.gameState = gameEngine.recordQuoteTrade(room, quotedId, 'hit').gameState;

    // A third quote, still pending, to prove expiry hits every open one.
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
    const secondPendingId = room.gameState.quotes![2].id;

    const advanced = gameEngine.advancePhase(room)!;
    const byId = Object.fromEntries(advanced.quotes!.map((q) => [q.id, q.status]));
    expect(byId[pendingId]).toBe('expired');
    expect(byId[secondPendingId]).toBe('expired');
    expect(byId[quotedId]).toBe('accepted');
  });
});
