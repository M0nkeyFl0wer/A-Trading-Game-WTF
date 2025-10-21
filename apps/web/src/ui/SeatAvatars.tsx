import { useMemo } from 'react';
import { useGameStore, PlayerState } from '../store';

const balanceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const characterEmoji: Record<PlayerState['character'], string> = {
  DEALER: '🎰',
  BULL: '🐂',
  BEAR: '🐻',
  WHALE: '🐋',
  ROOKIE: '👶',
};

export default function SeatAvatars() {
  const players = useGameStore(state => state.players);
  const roundNumber = useGameStore(state => state.roundNumber);

  const seats = useMemo(
    () => players.map(player => ({
      ...player,
      emoji: characterEmoji[player.character],
    })),
    [players]
  );

  return (
    <section className="card" aria-labelledby="seated-players-heading">
      <div className="section-heading">
        <h3 id="seated-players-heading">👥 Seated players</h3>
        <span>Round {roundNumber || 1}</span>
      </div>

      <ul
        className="list-reset"
        style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
      >
        {seats.map(player => (
          <li
            key={player.id}
            className="card"
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              background: player.isWinner ? 'rgba(34,197,94,0.18)' : 'rgba(15,23,42,0.55)',
              borderColor: player.isWinner ? 'rgba(34,197,94,0.45)' : 'rgba(148,163,184,0.2)',
            }}
          >
            <span style={{ fontSize: '2rem' }} aria-hidden="true">
              {player.emoji}
            </span>
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block' }}>
                {player.name}
              </strong>
              <small style={{ color: 'var(--text-secondary)' }}>
                Balance {balanceFormatter.format(player.balance)}
              </small>
              {player.isBot && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  🤖 Bot opponent
                </div>
              )}
            </div>
            {player.isWinner && <span className="tag tag--success">Winner</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
