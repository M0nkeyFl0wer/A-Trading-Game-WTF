import { useMemo, useState } from 'react';
import { useGameStore } from '../store';
import { useAuth } from '../contexts/AuthContext';
import { requestQuote, hitQuote, liftQuote } from '../lib/quotes';

interface QuoteRequestPanelProps {
  roomId: string;
  disabled?: boolean;
}

/** "Ask a player for a price" -- the requester's half of the two-way-quote mechanic. */
export default function QuoteRequestPanel({ roomId, disabled }: QuoteRequestPanelProps) {
  const players = useGameStore((state) => state.players);
  const quotes = useGameStore((state) => state.quotes);
  const { currentUser } = useAuth();
  const myId = currentUser?.uid;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opponents = useMemo(() => players.filter((p) => p.id !== myId), [players, myId]);

  const myQuote = useMemo(
    () => quotes.find((q) => q.requesterId === myId && (q.status === 'pending' || q.status === 'quoted')),
    [quotes, myId],
  );

  const handleAsk = async (targetId: string) => {
    if (!currentUser || disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await currentUser.getIdToken();
      await requestQuote(roomId, targetId, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request a quote');
    } finally {
      setSubmitting(false);
    }
  };

  const resolve = async (action: typeof hitQuote) => {
    if (!currentUser || !myQuote) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await currentUser.getIdToken();
      await action(roomId, myQuote.id, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete the trade');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card" aria-label="Ask a player for a price">
      <div className="section-heading">
        <h3>Ask a player for a price</h3>
      </div>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Pick someone and they must quote a two-way market -- a bid and an offer, exactly 2 apart.
        You choose which side to take.
      </p>

      <div className="chip-row" role="group" aria-label="Request a quote from a player">
        {opponents.map((p) => (
          <button
            key={p.id}
            type="button"
            className="chip"
            aria-pressed={myQuote?.targetId === p.id}
            disabled={disabled || submitting || Boolean(myQuote)}
            onClick={() => handleAsk(p.id)}
          >
            {p.name}
          </button>
        ))}
        {opponents.length === 0 && (
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            No one else is seated yet.
          </span>
        )}
      </div>

      {myQuote?.status === 'pending' && (
        <div className="inline-notice inline-notice--info" role="status" style={{ marginTop: 12 }}>
          Waiting on {myQuote.targetName} for a price...
        </div>
      )}

      {myQuote?.status === 'quoted' && myQuote.bidPrice != null && myQuote.askPrice != null && (
        <div className="quote-price-row">
          <div className="quote-price-row__who">
            <strong>{myQuote.targetName}</strong>
            <span>made a price</span>
          </div>
          {/*
            Hit/Lift are trading jargon. Spell out what each one MEANS for a new
            player (issue #30): hitting the bid is selling because you think the
            total finishes below that price; lifting the offer is buying because
            you think it finishes above. The plain-language caption and the
            aria-label both carry the meaning.
          */}
          <button
            type="button"
            className="quote-price-btn quote-price-btn--hit"
            onClick={() => resolve(hitQuote)}
            disabled={submitting}
            aria-label={`Hit the bid: sell at ${myQuote.bidPrice} because you think the total finishes lower`}
          >
            <small>SELL the bid</small>
            <b>{myQuote.bidPrice}</b>
            <span className="quote-price-btn__why">you think it finishes LOWER</span>
          </button>
          <button
            type="button"
            className="quote-price-btn quote-price-btn--lift"
            onClick={() => resolve(liftQuote)}
            disabled={submitting}
            aria-label={`Lift the offer: buy at ${myQuote.askPrice} because you think the total finishes higher`}
          >
            <small>BUY the offer</small>
            <b>{myQuote.askPrice}</b>
            <span className="quote-price-btn__why">you think it finishes HIGHER</span>
          </button>
        </div>
      )}

      {error && (
        <div className="inline-notice inline-notice--error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </section>
  );
}
