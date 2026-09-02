import { describe, it, expect } from 'vitest';
import { bluffedQuoteMid, estimateFairValue } from '../agents/personalities';
import { gameEngine } from '../services/gameEngine';
import type { RoomRecord, RoomPlayer } from '../services/roomService';

function makePlayer(id: string, character: string): RoomPlayer {
  return { id, name: id, joinedAt: Date.now(), balance: 1_000, character };
}

function makeRoom(players: RoomPlayer[]): RoomRecord {
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
  };
  room.gameState = gameEngine.dealRound(room);
  return room;
}

describe('bluffedQuoteMid (issue #27)', () => {
  // A low card -> a low fair value. The room is 4-handed and flat (consensus at
  // fair) so the only thing biasing the quote is the personality.
  const lowCardFair = estimateFairValue(1, [], 4);

  it('the Bull talks it UP: mean quote is above fair almost every time', () => {
    const N = 2000;
    let sum = 0;
    let above = 0;
    for (let i = 0; i < N; i++) {
      const mid = bluffedQuoteMid('BULL', lowCardFair, lowCardFair);
      sum += mid;
      if (mid > lowCardFair) above += 1;
    }
    const mean = sum / N;
    expect(mean).toBeGreaterThan(lowCardFair); // biased up
    // Acceptance: > fair "at least X%" of the time -- deception (6) dwarfs the
    // noise (+/-1.5), so it should be essentially always.
    expect(above / N).toBeGreaterThan(0.9);
  });

  it('the Bear talks it DOWN: mean quote is below fair almost every time', () => {
    const N = 2000;
    let sum = 0;
    let below = 0;
    for (let i = 0; i < N; i++) {
      const mid = bluffedQuoteMid('BEAR', lowCardFair, lowCardFair);
      sum += mid;
      if (mid < lowCardFair) below += 1;
    }
    expect(sum / N).toBeLessThan(lowCardFair);
    expect(below / N).toBeGreaterThan(0.9);
  });

  it('the Dealer is close to honest: mean quote hugs fair value', () => {
    const N = 2000;
    let sum = 0;
    for (let i = 0; i < N; i++) sum += bluffedQuoteMid('DEALER', lowCardFair, lowCardFair);
    // Zero-mean noise, no deception -> mean within a point of fair.
    expect(Math.abs(sum / N - lowCardFair)).toBeLessThan(1);
  });

  it('the Bull leans HARDER into a rising crowd (consensus modulation)', () => {
    // With consensus above fair, the momentum lean adds on top of deception.
    const fair = 40;
    const flat = bluffedQuoteMid('BULL', fair, fair, () => 0.5);     // no noise
    const bullish = bluffedQuoteMid('BULL', fair, fair + 20, () => 0.5);
    expect(bullish).toBeGreaterThan(flat);
  });

  it('the Whale quotes LOUD beyond consensus, independent of its own fair value', () => {
    // Whale holds a middling card but quotes far above a flat consensus.
    const consensus = 45;
    const mid = bluffedQuoteMid('WHALE', 45, consensus, () => 0.5);
    // Steps a full loudness beyond consensus -> far from fair.
    expect(mid).toBeGreaterThan(consensus + 8);
  });

  it('the Whale can MOVE consensus with a loud quote (end to end)', () => {
    const room = makeRoom([
      makePlayer('alice', 'DEALER'),
      makePlayer('whale', 'WHALE'),
    ]);
    const seed = room.gameState!.consensus!;

    // The whale is asked for a quote and prices its bluff off consensus.
    room.gameState = gameEngine.requestQuote(room, 'alice', 'alice', 'whale', 'whale');
    const quoteId = room.gameState.quotes![0].id;
    const whaleFair = estimateFairValue(
      room.gameState.playerCards.find((c) => c.id === 'whale')!.value,
      room.gameState.revealedCommunityCards,
      room.players.length,
    );
    const mid = Math.round(bluffedQuoteMid('WHALE', whaleFair, room.gameState.consensus, () => 0.5));
    room.gameState = gameEngine.respondToQuote(room, quoteId, mid - 1, mid + 1);

    // A single loud whale quote visibly drags consensus off its seed.
    expect(Math.abs(room.gameState.consensus! - seed)).toBeGreaterThan(1);
  });
});
