import { useGameStore } from '../store';

const CARD_STYLE_BASE = {
  width: 72,
  height: 100,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontSize: '1.6rem',
  transition: 'transform 0.5s, background 0.3s',
  position: 'relative' as const,
};

interface CommunityCardsProps {
  className?: string;
}

export default function CommunityCards({ className = '' }: CommunityCardsProps) {
  const revealedCards = useGameStore((state) => state.revealedCommunityCards);
  const settlementTotal = useGameStore((state) => state.settlementTotal);
  const tradingPhase = useGameStore((state) => state.tradingPhase);

  const isSettled = tradingPhase === 'finished';
  const totalSlots = 3;

  return (
    <section className={`card ${className}`} aria-label="Community cards" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        {Array.from({ length: totalSlots }).map((_, idx) => {
          const value = revealedCards[idx];
          const isRevealed = value != null;

          return (
            <div
              key={idx}
              style={{
                perspective: 600,
              }}
            >
              <div
                style={{
                  ...CARD_STYLE_BASE,
                  transform: isRevealed ? 'rotateY(0deg)' : 'rotateY(180deg)',
                  background: isRevealed
                    ? 'linear-gradient(135deg, #1e293b 0%, #334155 100%)'
                    : 'linear-gradient(135deg, #4338ca 0%, #6366f1 100%)',
                  border: isRevealed
                    ? '2px solid rgba(148, 163, 184, 0.3)'
                    : '2px solid rgba(99, 102, 241, 0.4)',
                  color: isRevealed ? '#f1f5f9' : 'transparent',
                  boxShadow: isRevealed
                    ? '0 4px 20px rgba(0, 0, 0, 0.3)'
                    : '0 4px 20px rgba(99, 102, 241, 0.2)',
                }}
              >
                {isRevealed ? (
                  <span>{value}</span>
                ) : (
                  <span style={{
                    color: 'rgba(255, 255, 255, 0.3)',
                    fontSize: '2rem',
                    transform: 'rotateY(180deg)',
                  }}>
                    ?
                  </span>
                )}
              </div>
              <div style={{
                textAlign: 'center',
                marginTop: 6,
                fontSize: '0.7rem',
                color: 'var(--text-secondary)',
              }}>
                Card {idx + 1}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total display */}
      {isSettled && settlementTotal != null && (
        <div style={{
          textAlign: 'center',
          marginTop: 16,
          padding: '10px 16px',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15))',
          borderRadius: 10,
          border: '1px solid rgba(99, 102, 241, 0.25)',
        }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Settlement Total
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#818cf8' }}>
            {settlementTotal}
          </div>
        </div>
      )}

      {/* Inline total for non-settled states */}
      {!isSettled && revealedCards.length > 0 && (
        <div style={{
          textAlign: 'center',
          marginTop: 10,
          fontSize: '0.85rem',
          color: 'var(--text-secondary)',
        }}>
          Revealed so far: <strong style={{ color: 'var(--text-primary)' }}>
            {revealedCards.reduce((s, v) => s + v, 0)}
          </strong>
          {' '}({revealedCards.length}/3 cards)
        </div>
      )}
    </section>
  );
}
