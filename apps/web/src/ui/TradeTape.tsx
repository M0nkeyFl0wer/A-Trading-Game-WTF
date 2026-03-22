import { useMemo } from 'react';
import type { MatchedTrade } from '@trading-game/shared';
import { useGameStore } from '../store';
import { useAuth } from '../contexts/AuthContext';

const currency = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

const PHASE_COLORS: Record<string, string> = {
  blind: '#a78bfa',  // purple
  flop: '#60a5fa',   // blue
  turn: '#34d399',   // green
};

function phaseColor(phase: string): string {
  return PHASE_COLORS[phase] ?? 'var(--text-secondary)';
}

export default function TradeTape() {
  const matchedTrades = useGameStore((state) => state.matchedTrades);
  const { currentUser } = useAuth();
  const myId = currentUser?.uid;

  const orderedTrades = useMemo(
    () => [...matchedTrades].sort((a, b) => b.timestamp - a.timestamp),
    [matchedTrades],
  );

  return (
    <section className="card" aria-labelledby="trade-tape-heading">
      <div className="section-heading">
        <h3 id="trade-tape-heading">Trade Tape</h3>
        <span>{matchedTrades.length === 0 ? 'No trades yet' : `${matchedTrades.length} total`}</span>
      </div>

      {orderedTrades.length === 0 ? (
        <p className="card__subtitle">
          Matched trades will appear here as bids and asks cross in the order book.
        </p>
      ) : (
        <ol
          className="list-reset"
          style={{ maxHeight: 260, overflowY: 'auto' }}
          aria-live="polite"
        >
          {orderedTrades.map((trade) => {
            const involvesMe = myId != null && (trade.buyerId === myId || trade.sellerId === myId);
            return (
              <li
                key={trade.id}
                style={{
                  padding: '10px 14px',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'center',
                  gap: 8,
                  background: involvesMe
                    ? 'rgba(99, 102, 241, 0.1)'
                    : 'rgba(15, 23, 42, 0.55)',
                  borderRadius: 8,
                  marginBottom: 4,
                  borderLeft: `3px solid ${phaseColor(trade.phase)}`,
                }}
              >
                <div>
                  <div style={{ fontSize: '0.85rem' }}>
                    <strong style={{ color: trade.buyerId === myId ? '#818cf8' : 'inherit' }}>
                      {trade.buyerName || trade.buyerId.slice(0, 8)}
                    </strong>
                    {' '}bought{' '}
                    <strong>{trade.quantity}</strong>
                    {' '}@ <strong>{currency.format(trade.price)}</strong>
                    {' '}from{' '}
                    <strong style={{ color: trade.sellerId === myId ? '#818cf8' : 'inherit' }}>
                      {trade.sellerName || trade.sellerId.slice(0, 8)}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: `${phaseColor(trade.phase)}22`,
                        color: phaseColor(trade.phase),
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}
                    >
                      {trade.phase}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
                      {new Date(trade.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
                <div style={{
                  textAlign: 'right',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  fontFamily: 'monospace',
                }}>
                  {currency.format(trade.price * trade.quantity)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
