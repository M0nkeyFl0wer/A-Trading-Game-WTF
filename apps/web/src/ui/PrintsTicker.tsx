import { useMemo } from 'react';
import type { MatchedTrade } from '@trading-game/shared';
import { useGameStore } from '../store';

const MAX_PRINTS = 12;

function describeTrade(trade: MatchedTrade): string {
  return `${trade.buyerName || 'a trader'} bought ${trade.quantity} @ ${trade.price} from ${trade.sellerName || 'a trader'}`;
}

/** Scrolling one-liner strip of recent fills -- purely atmospheric. */
export default function PrintsTicker() {
  const matchedTrades = useGameStore((state) => state.matchedTrades);

  const recent = useMemo(
    () =>
      [...matchedTrades]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_PRINTS)
        .reverse(),
    [matchedTrades],
  );

  if (recent.length === 0) return null;

  // Duplicated so the CSS marquee can loop seamlessly at -50%.
  const rail = [...recent, ...recent];

  return (
    <div className="ticker" aria-label="Recent trade prints">
      <div className="ticker__rail">
        {rail.map((trade, i) => (
          <span key={`${trade.id}-${i}`}>{describeTrade(trade)}</span>
        ))}
      </div>
    </div>
  );
}
