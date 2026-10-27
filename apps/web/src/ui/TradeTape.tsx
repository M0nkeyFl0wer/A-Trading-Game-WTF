import { useMemo, useRef, useEffect, useState } from 'react';
import { useGameStore, TradeEvent } from '../store';

const currency = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

const shareFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const tradeIcon = (trade: TradeEvent) => (trade.type === 'buy' ? '🟢' : '🔻');

export default function TradeTape() {
  const trades = useGameStore(state => state.trades);
  const listRef = useRef<HTMLOListElement>(null);
  const prevCountRef = useRef(0);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  const orderedTrades = useMemo(
    () => [...trades].sort((a, b) => b.timestamp - a.timestamp),
    [trades]
  );

  useEffect(() => {
    if (trades.length > prevCountRef.current && listRef.current) {
      listRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      const newIds = new Set(
        trades.slice(prevCountRef.current).map(t => t.id)
      );
      setFreshIds(newIds);
      const timer = setTimeout(() => setFreshIds(new Set()), 2000);
      prevCountRef.current = trades.length;
      return () => clearTimeout(timer);
    }
    prevCountRef.current = trades.length;
  }, [trades]);

  return (
    <section className="card" aria-labelledby="trade-tape-heading">
      <div className="section-heading">
        <h3 id="trade-tape-heading">📈 Trade tape</h3>
        <span>{trades.length === 0 ? 'No trades yet' : `${trades.length} total`}</span>
      </div>

      {orderedTrades.length === 0 ? (
        <p className="card__subtitle">
          Trades will stream here as players buy and sell shares during the round.
        </p>
      ) : (
        <ol
          ref={listRef}
          className="list-reset"
          style={{ maxHeight: 220, overflowY: 'auto' }}
          aria-live="polite"
        >
          {orderedTrades.map(trade => (
            <li
              key={trade.id}
              className="card"
              style={{
                padding: '14px 16px',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center',
                gap: 12,
                background: freshIds.has(trade.id)
                  ? 'rgba(99,102,241,0.25)'
                  : 'rgba(15,23,42,0.55)',
                transition: 'background 0.5s ease',
              }}
            >
              <span style={{ fontSize: '1.4rem' }}>{tradeIcon(trade)}</span>
              <div>
                <strong style={{ display: 'block' }}>
                  {trade.player} → {trade.counterparty}
                </strong>
                <small style={{ color: 'var(--text-secondary)' }}>
                  {shareFormatter.format(trade.quantity)} @ {currency.format(trade.price)}
                </small>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontWeight: 600 }}>
                  {trade.type === 'buy' ? '+' : '-'}
                  {currency.format(trade.value)}
                </span>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  {new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
