import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../store';
import type { PlayerState } from '../store';
import { useAuth } from '../contexts/AuthContext';

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
  const orders = useGameStore(state => state.orders);
  const { currentUser } = useAuth();
  const currentUserId = currentUser?.uid;

  // Track bot activity: flash when a bot places a new order
  const [activeBotIds, setActiveBotIds] = useState<Set<string>>(new Set());
  const prevOrderCountRef = useRef(orders.length);

  useEffect(() => {
    if (orders.length <= prevOrderCountRef.current) {
      prevOrderCountRef.current = orders.length;
      return;
    }

    // Find bot IDs from new orders
    const newOrders = orders.slice(prevOrderCountRef.current);
    const botIds = new Set<string>();
    for (const order of newOrders) {
      const player = players.find(p => p.id === (order as any).playerId);
      if (player?.isBot) {
        botIds.add(player.id);
      }
    }

    if (botIds.size > 0) {
      setActiveBotIds(botIds);
      const timer = setTimeout(() => setActiveBotIds(new Set()), 800);
      return () => clearTimeout(timer);
    }

    prevOrderCountRef.current = orders.length;
  }, [orders, players]);

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
        <h3 id="seated-players-heading">Seated players</h3>
        <span>Round {roundNumber || 1}</span>
      </div>

      {seats.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">--</div>
          <div>Waiting for players to join...</div>
        </div>
      ) : (
        <ul
          className="list-reset"
          style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        >
          {seats.map(player => {
            const isOwnCard = player.id === currentUserId;
            const showCard =
              typeof player.cardValue === 'number' &&
              (player.cardRevealed || isOwnCard);
            const isBotActive = activeBotIds.has(player.id);

            return (
              <li
                key={player.id}
                className={`card${isBotActive ? ' bot-active' : ''}`}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  background: player.isWinner
                    ? 'rgba(34,197,94,0.18)'
                    : isOwnCard && typeof player.cardValue === 'number'
                    ? 'rgba(59,130,246,0.15)'
                    : 'rgba(15,23,42,0.55)',
                  borderColor: player.isWinner
                    ? 'rgba(34,197,94,0.45)'
                    : isOwnCard && typeof player.cardValue === 'number'
                    ? 'rgba(59,130,246,0.45)'
                    : 'rgba(148,163,184,0.2)',
                }}
              >
                <span style={{ fontSize: '2rem' }} aria-hidden="true">
                  {player.emoji}
                </span>
                <div style={{ flex: 1 }}>
                  <strong style={{ display: 'block' }}>
                    {player.name}{isOwnCard ? ' (You)' : ''}
                  </strong>
                  <small style={{ color: 'var(--text-secondary)' }}>
                    Balance {balanceFormatter.format(player.balance)}
                  </small>
                  {showCard && (
                    <div style={{
                      fontSize: isOwnCard && !player.cardRevealed ? '0.95rem' : '0.8rem',
                      color: isOwnCard && !player.cardRevealed ? 'var(--accent, #60a5fa)' : 'var(--text-secondary)',
                      fontWeight: isOwnCard && !player.cardRevealed ? 600 : 400,
                    }}>
                      {isOwnCard && !player.cardRevealed ? 'Your card' : 'Card value'}: <strong>{player.cardValue}</strong>
                    </div>
                  )}
                  {!showCard && typeof player.cardValue === 'number' && !player.cardRevealed && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Card hidden
                    </div>
                  )}
                  {player.isBot && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Bot opponent{isBotActive ? ' -- placing order...' : ''}
                    </div>
                  )}
                </div>
                {player.isWinner && <span className="tag tag--success">Winner</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
