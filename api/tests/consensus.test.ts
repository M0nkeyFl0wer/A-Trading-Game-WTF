import { describe, it, expect } from 'vitest';
import {
  gameEngine,
  ewma,
  neutralConsensus,
  CONSENSUS_ALPHA,
} from '../services/gameEngine';
import { DECK_MEAN, COMMUNITY_CARD_COUNT } from '@trading-game/shared';
import type { RoomRecord, RoomPlayer } from '../services/roomService';

// Mirrors the helpers in gameEngine.quotes.test.ts: a two-player blind-phase
// room with a freshly dealt game state.
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

/** Respond to a fresh quote from alice->bob at a mid, returning new consensus. */
function quoteAt(room: RoomRecord, mid: number): number {
  room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
  const quoteId = room.gameState.quotes![room.gameState.quotes!.length - 1].id;
  room.gameState = gameEngine.respondToQuote(room, quoteId, mid - 1, mid + 1);
  return room.gameState.consensus!;
}

describe('consensus EWMA helper (issue #23)', () => {
  it('takes the first sample as the seed', () => {
    expect(ewma(undefined, 42)).toBe(42);
  });

  it('drags the previous value a fixed fraction toward the sample', () => {
    // new = alpha*sample + (1-alpha)*prev
    expect(ewma(50, 60)).toBeCloseTo(CONSENSUS_ALPHA * 60 + (1 - CONSENSUS_ALPHA) * 50, 6);
  });

  it('treats a non-finite previous as no prior', () => {
    expect(ewma(NaN, 10)).toBe(10);
  });
});

describe('neutralConsensus seed (issue #23)', () => {
  it('values every dealt card at the deck mean', () => {
    // 4 players -> 4 hole cards + 3 community = 7 cards at the deck mean.
    expect(neutralConsensus(4)).toBeCloseTo((4 + COMMUNITY_CARD_COUNT) * DECK_MEAN, 6);
  });
});

describe('gameEngine consensus wiring (issue #23)', () => {
  it('seeds consensus at deal time to the no-information prior', () => {
    const room = makeRoom(); // 2 players
    expect(room.gameState!.consensus).toBeCloseTo(neutralConsensus(2), 6);
  });

  it('a sequence of high quotes drives consensus UP', () => {
    const room = makeRoom();
    const seed = room.gameState!.consensus!;
    // Quote well above the seed, repeatedly. Each should pull consensus higher.
    let last = seed;
    for (let i = 0; i < 5; i++) {
      const next = quoteAt(room, seed + 40);
      expect(next).toBeGreaterThan(last); // strictly monotone toward the target
      last = next;
    }
    expect(last).toBeGreaterThan(seed);
  });

  it('a sequence of low quotes drives consensus DOWN', () => {
    const room = makeRoom();
    const seed = room.gameState!.consensus!;
    let last = seed;
    for (let i = 0; i < 5; i++) {
      const next = quoteAt(room, seed - 40);
      expect(next).toBeLessThan(last);
      last = next;
    }
    expect(last).toBeLessThan(seed);
  });

  it('a fill (hit/lift) moves consensus toward the print price', () => {
    const room = makeRoom();
    const seed = room.gameState!.consensus!;
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'bob', 'bob');
    const quoteId = room.gameState.quotes![0].id;
    // Quote a two-way market far above the seed, then lift the ask (a print).
    room.gameState = gameEngine.respondToQuote(room, quoteId, seed + 49, seed + 51);
    const afterQuote = room.gameState.consensus!;
    const { gameState } = gameEngine.recordQuoteTrade(room, quoteId, 'lift');
    // Lifting the ask prints at seed+51, above the post-quote consensus, so the
    // fill drags consensus up further.
    expect(gameState.consensus!).toBeGreaterThan(afterQuote);
  });

  it('order-book fills fold into consensus in time order', () => {
    // Two players cross the book: bob bids high, alice sells into it -> a print.
    const room = makeRoom();
    const seed = room.gameState!.consensus!;
    const bidPrice = Math.round(seed + 30);
    room.gameState = gameEngine.submitOrder(room, 'bob', 'bob', {
      price: bidPrice,
      quantity: 1,
      side: 'bid',
    }).gameState;
    // Resting bid alone is not a print -> consensus unchanged so far.
    expect(room.gameState.consensus).toBeCloseTo(seed, 6);
    // Alice sells at/under the bid -> a fill at bidPrice -> consensus rises.
    const { gameState, newTrades } = gameEngine.submitOrder(room, 'alice', 'alice', {
      price: bidPrice,
      quantity: 1,
      side: 'ask',
    });
    expect(newTrades.length).toBeGreaterThan(0);
    expect(gameState.consensus!).toBeGreaterThan(seed);
  });
});
