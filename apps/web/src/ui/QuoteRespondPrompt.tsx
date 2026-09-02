import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../store';
import { useAuth } from '../contexts/AuthContext';
import { respondToQuote } from '../lib/quotes';

interface QuoteRespondPromptProps {
  roomId: string;
}

/**
 * Non-blocking inline strip for an incoming quote request. The target can
 * ignore it -- it just expires -- so this never interrupts or modals over
 * anything else on the table.
 */
export default function QuoteRespondPrompt({ roomId }: QuoteRespondPromptProps) {
  const quotes = useGameStore((state) => state.quotes);
  const { currentUser } = useAuth();
  const myId = currentUser?.uid;
  const [bid, setBid] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incoming = useMemo(
    () => quotes.find((q) => q.targetId === myId && q.status === 'pending'),
    [quotes, myId],
  );

  useEffect(() => {
    setError(null);
  }, [incoming?.id]);

  if (!incoming) return null;

  const ask = bid + 2;

  const handleRespond = async () => {
    if (!currentUser) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await currentUser.getIdToken();
      await respondToQuote(roomId, incoming.id, bid, ask, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send your price');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card quote-respond" aria-label="Quote request">
      <div className="section-heading">
        <h3>{incoming.requesterName} wants a price</h3>
      </div>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        Quote a bid -- the ask is fixed 2 points above it. Ignore it and it will simply expire.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setBid((b) => b - 1)}
          disabled={submitting}
        >
          -
        </button>
        <div style={{ textAlign: 'center', fontFamily: 'monospace', minWidth: 90 }}>
          <div style={{ fontWeight: 700 }}>{bid} bid</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{ask} ask</div>
        </div>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setBid((b) => b + 1)}
          disabled={submitting}
        >
          +
        </button>
      </div>
      {error && (
        <div className="inline-notice inline-notice--error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <button
        type="button"
        className="button button--primary"
        onClick={handleRespond}
        disabled={submitting}
        style={{ width: '100%' }}
      >
        {submitting ? 'Sending...' : `Quote ${bid} / ${ask}`}
      </button>
    </section>
  );
}
