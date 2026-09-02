import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateFairValue } from '@trading-game/shared';
import { useGameStore } from '../store';
import type { PlayerState } from '../store';
import { useAuth } from '../contexts/AuthContext';

const characterEmoji: Record<PlayerState['character'], string> = {
  DEALER: '\u{1F3B0}',
  BULL: '\u{1F402}',
  BEAR: '\u{1F43B}',
  WHALE: '\u{1F40B}',
  ROOKIE: '\u{1F476}',
};

const PHASES = ['blind', 'flop', 'turn'] as const;

function useCountdown(phaseEndsAt: number | null): string {
  const [label, setLabel] = useState('--:--');

  useEffect(() => {
    if (!phaseEndsAt) {
      setLabel('--:--');
      return;
    }
    const tick = () => {
      const remainingMs = Math.max(0, phaseEndsAt - Date.now());
      const totalSeconds = Math.ceil(remainingMs / 1000);
      setLabel(`${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phaseEndsAt]);

  return label;
}

/**
 * Track which way a number last moved, so the drifting consensus readout can
 * show an up/down tint and arrow (issue #23). Returns 'up' | 'down' | 'flat'
 * by comparing the latest value against the previous one we saw.
 */
function useDrift(value: number | null): 'up' | 'down' | 'flat' {
  const prev = useRef<number | null>(null);
  const [dir, setDir] = useState<'up' | 'down' | 'flat'>('flat');

  useEffect(() => {
    if (value == null) {
      prev.current = null;
      setDir('flat');
      return;
    }
    if (prev.current != null) {
      // Ignore sub-tick noise so a barely-moving average doesn't strobe.
      const delta = value - prev.current;
      if (Math.abs(delta) >= 0.05) setDir(delta > 0 ? 'up' : 'down');
    }
    prev.current = value;
  }, [value]);

  return dir;
}

/**
 * The oval-table shell: rail/timer, felt, dealer, seats arranged around the
 * oval, and your own seat at the bottom. Reads straight from the store, same
 * as SeatAvatars -- no forked seat-data hook until real duplication shows up.
 */
export default function TradingFloor() {
  const players = useGameStore((state) => state.players);
  const tradingPhase = useGameStore((state) => state.tradingPhase);
  const phaseEndsAt = useGameStore((state) => state.phaseEndsAt);
  const revealedCommunityCards = useGameStore((state) => state.revealedCommunityCards);
  const myCard = useGameStore((state) => state.myCard);
  const consensus = useGameStore((state) => state.consensus);
  const commentary = useGameStore((state) => state.commentary);
  const { currentUser } = useAuth();
  const myId = currentUser?.uid;

  const clock = useCountdown(phaseEndsAt);

  const you = players.find((p) => p.id === myId);
  const opponents = useMemo(() => players.filter((p) => p.id !== myId), [players, myId]);

  const seats = useMemo(() => {
    const n = opponents.length;
    if (n === 0) return [];
    // Spread opponents across the upper arc of the oval; you sit at the bottom.
    return opponents.map((player, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const angle = ((190 + t * 160) * Math.PI) / 180;
      return {
        player,
        left: 50 + 44 * Math.cos(angle),
        top: 46 + 40 * Math.sin(angle),
      };
    });
  }, [opponents]);

  const dealerLine = commentary[0]?.text ?? 'The market is open.';
  const phaseIndex = PHASES.indexOf((tradingPhase ?? '') as (typeof PHASES)[number]);
  // The player's fair value -- the SAME function the bots price against
  // (issue #24). Conditions on the real table size and the community cards
  // revealed so far, so it tracks reveals and shrinks as the table shrinks.
  const expectedTotal =
    myCard != null
      ? estimateFairValue(myCard, revealedCommunityCards, players.length)
      : null;

  // The DRIFTING consensus (issue #23) -- the room's live belief, distinct from
  // the static fair value above. `drift` tints it as it moves.
  const drift = useDrift(consensus);
  const driftGlyph = drift === 'up' ? '▲' : drift === 'down' ? '▼' : '•';
  const driftColor = drift === 'up' ? '#22c55e' : drift === 'down' ? '#ef4444' : 'var(--text-secondary)';

  return (
    <div className="floor" aria-label="Trading table">
      <div className="floor__rail">
        <span className="floor__phase-label">{tradingPhase ?? 'Waiting'}</span>
        <div className="floor__phases">
          {PHASES.map((phase, i) => (
            <span
              key={phase}
              className={
                'floor__phase-dot' +
                (i < phaseIndex ? ' is-done' : '') +
                (i === phaseIndex ? ' is-now' : '')
              }
            />
          ))}
        </div>
        <span className="floor__timer">{clock}</span>
      </div>

      <div className="floor__table" />

      <div className="floor__centre">
        {/*
          Legibility one-liner (issue #30): spell out in plain words what the
          player is betting on and the corrected fair value they're pricing
          against. `totalCards` is one card per seat plus the 3 community cards.
        */}
        <span className="floor__explainer">
          Betting on the total of all <b>{players.length + 3}</b> cards
          {expectedTotal != null && (
            <> &middot; fair &asymp; <b>{expectedTotal.toFixed(1)}</b></>
          )}
        </span>
        {/*
          The DRIFTING consensus (issue #23): the room's live market belief.
          Deliberately distinct from the static fair value above -- this is the
          number the whole game is about moving.
        */}
        <span
          className="floor__consensus"
          style={{ color: driftColor }}
          aria-label="Live market consensus"
        >
          <span className="floor__consensus-label">consensus</span>
          <b>{consensus != null ? consensus.toFixed(1) : '--'}</b>
          <span aria-hidden="true">{driftGlyph}</span>
        </span>
        <div className="floor__board">
          {[0, 1, 2].map((i) => {
            const value = revealedCommunityCards[i];
            return (
              <div key={i} className={value == null ? 'floor-card is-down' : 'floor-card'}>
                {value != null && <span>{value}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="floor__dealer">
        <div className="floor__dealer-chip">D</div>
        <div className="floor__dealer-say">&ldquo;{dealerLine}&rdquo;</div>
      </div>

      {seats.map(({ player, left, top }) => (
        <div key={player.id} className="floor-seat" style={{ left: `${left}%`, top: `${top}%` }}>
          <div className="floor-seat__token" aria-hidden="true">
            {characterEmoji[player.character] ?? '?'}
          </div>
          <div className="floor-seat__name">{player.name}</div>
          <div className="floor-seat__meta">stack {Math.round(player.balance)}</div>
        </div>
      ))}

      {you && (
        <div className="floor-seat floor-seat--you">
          {myCard != null && (
            <div className="floor-card floor-card--small">
              <span>{myCard}</span>
            </div>
          )}
          <div className="floor-seat__name">You</div>
          <div className="floor-seat__meta">stack {Math.round(you.balance)}</div>
        </div>
      )}
    </div>
  );
}
