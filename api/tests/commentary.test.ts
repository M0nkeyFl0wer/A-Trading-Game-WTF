/**
 * Bot commentary reaching the client, in the right character's voice.
 *
 * The trading agents have always produced banter (personalities.ts rolls
 * against commentFrequency and pulls from that character's comment pool), but
 * the floor coordinator only logged it -- the lines never left the server.
 * These tests pin the path that carries them out:
 *
 *   agent.activate() -> coordinator -> commentatorService.pushAgentCommentary()
 *     -> generateCommentary() drain -> room:updated payload -> client voice
 *
 * The client picks the highest-priority line and speaks it in that character's
 * voice, so the character field is load-bearing, not decorative.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { commentatorService } from '../services/commentatorService';
import type { RoomRecord } from '../services/roomService';

/**
 * Minimal room shaped just enough for generateCommentary. gameState must be
 * present or the generator early-returns before reaching any of our logic.
 */
function makeRoom(id: string): RoomRecord {
  return {
    id,
    name: 'test room',
    status: 'blind',
    roundNumber: 1,
    players: [],
    gameState: {
      phase: 'blind',
      roundNumber: 1,
      matchedTrades: [],
      revealedCommunityCards: [],
      playerCards: [],
      orders: [],
    },
  } as unknown as RoomRecord;
}

describe('bot commentary delivery', () => {
  beforeEach(() => {
    // generateCommentary is stateful (it diffs against the previous snapshot),
    // so give every test its own room id via removeRoom below.
    commentatorService.removeRoom('room_commentary');
  });

  it('a queued bot line is drained into the next generateCommentary result', () => {
    commentatorService.pushAgentCommentary('room_commentary', 'BULL', 'To the moon!');

    const comments = commentatorService.generateCommentary(makeRoom('room_commentary'));

    const bull = comments.find((c) => c.text === 'To the moon!');
    expect(bull).toBeDefined();
    // The character must survive the trip -- it is what selects the voice.
    expect(bull?.character).toBe('BULL');
  });

  it('bot banter is low priority so the Dealer still leads the client sort', () => {
    commentatorService.pushAgentCommentary('room_commentary', 'ROOKIE', 'Is that good?');

    const comments = commentatorService.generateCommentary(makeRoom('room_commentary'));
    const rookie = comments.find((c) => c.text === 'Is that good?');

    expect(rookie?.priority).toBe('low');
  });

  it('draining is one-shot -- a line is never spoken twice', () => {
    commentatorService.pushAgentCommentary('room_commentary', 'WHALE', 'Size matters.');

    const first = commentatorService.generateCommentary(makeRoom('room_commentary'));
    const second = commentatorService.generateCommentary(makeRoom('room_commentary'));

    expect(first.some((c) => c.text === 'Size matters.')).toBe(true);
    expect(second.some((c) => c.text === 'Size matters.')).toBe(false);
  });

  it('the queue is bounded, keeping only the most recent lines', () => {
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      commentatorService.pushAgentCommentary('room_commentary', 'BEAR', text);
    }

    const comments = commentatorService.generateCommentary(makeRoom('room_commentary'));
    const botLines = comments.filter((c) => c.character === 'BEAR');

    expect(botLines).toHaveLength(3);
    // Stale banter is dropped from the front, not the back.
    expect(botLines.map((c) => c.text)).toEqual(['three', 'four', 'five']);
  });

  it('removing a room discards its pending lines', () => {
    commentatorService.pushAgentCommentary('room_commentary', 'DEALER', 'Orphan line.');
    commentatorService.removeRoom('room_commentary');

    const comments = commentatorService.generateCommentary(makeRoom('room_commentary'));

    expect(comments.some((c) => c.text === 'Orphan line.')).toBe(false);
  });
});
