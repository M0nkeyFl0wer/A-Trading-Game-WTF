import { useMemo } from 'react';
import { estimateFairValue } from '@trading-game/shared';
import { useGameStore } from '../store';
import { useAuth } from '../contexts/AuthContext';

const currency = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/**
 * This round's fills involving me, with a live mark against the current EV
 * estimate -- distinct from TradeTape (the anonymous book's public tape);
 * both coexist.
 */
export default function TradeBlotter() {
  const matchedTrades = useGameStore((state) => state.matchedTrades);
  const myCard = useGameStore((state) => state.myCard);
  // The corrected fair value marks the blotter against the same number the bots
  // price against (issue #24): conditioned on table size and revealed cards.
  const players = useGameStore((state) => state.players);
  const revealedCommunityCards = useGameStore((state) => state.revealedCommunityCards);
  const { currentUser } = useAuth();
  const myId = currentUser?.uid;

  const myTrades = useMemo(
    () =>
      matchedTrades
        .filter((t) => t.buyerId === myId || t.sellerId === myId)
        .sort((a, b) => b.timestamp - a.timestamp),
    [matchedTrades, myId],
  );

  const markValue =
    myCard != null
      ? estimateFairValue(myCard, revealedCommunityCards, players.length)
      : null;

  return (
    <section className="card" aria-labelledby="blotter-heading">
      <div className="section-heading">
        <h3 id="blotter-heading">Your blotter</h3>
        <span>{markValue != null ? `marking ~${markValue.toFixed(1)}` : 'no mark yet'}</span>
      </div>

      {myTrades.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">--</div>
          <div>Nothing struck yet this round.</div>
        </div>
      ) : (
        <ul className="list-reset" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {myTrades.map((trade) => {
            const isBuy = trade.buyerId === myId;
            const counterparty = isBuy ? trade.sellerName : trade.buyerName;
            const markPnl =
              markValue != null
                ? (isBuy ? markValue - trade.price : trade.price - markValue) * trade.quantity
                : null;
            return (
              <li
                key={trade.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: 10,
                  alignItems: 'baseline',
                  fontSize: '0.85rem',
                  borderBottom: '1px dashed var(--border-subtle)',
                  paddingBottom: 6,
                }}
              >
                <span style={{ fontWeight: 700, color: isBuy ? '#22c55e' : '#ef4444' }}>
                  {isBuy ? 'BOT' : 'SLD'}
                </span>
                <span>
                  <strong>{trade.price}</strong> &times; {trade.quantity}{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {isBuy ? 'from' : 'to'} {counterparty}
                  </span>
                </span>
                {markPnl != null && (
                  <span
                    style={{
                      fontWeight: 600,
                      color: markPnl >= 0 ? '#22c55e' : '#ef4444',
                      fontFamily: 'monospace',
                    }}
                  >
                    {markPnl >= 0 ? '+' : ''}
                    {currency.format(markPnl)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
