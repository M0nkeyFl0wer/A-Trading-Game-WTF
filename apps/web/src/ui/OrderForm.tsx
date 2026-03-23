import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useGameStore } from '../store';
import { voiceService } from '../lib/elevenlabs';

interface OrderFormProps {
  roomId: string;
  disabled?: boolean;
  myCardValue?: number | null;
}

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export default function OrderForm({ roomId, disabled, myCardValue }: OrderFormProps) {
  const [side, setSide] = useState<'bid' | 'ask'>('bid');
  const [price, setPrice] = useState(61);
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { currentUser } = useAuth();
  const voiceEnabled = useGameStore((state) => state.isVoiceEnabled);
  const character = useGameStore((state) => state.character);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || disabled) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_BASE}/api/room/${roomId}/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ price, quantity, side }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to place order');
      }

      setSuccess(side === 'bid'
        ? `Bet placed: total will be HIGHER than ${price}`
        : `Bet placed: total will be LOWER than ${price}`
      );
      setTimeout(() => setSuccess(null), 2500);

      if (voiceEnabled) {
        voiceService
          .announceGameEvent('trade.placed', `${quantity} @ ${price}`, character)
          .catch(console.error);
      }
    } catch (err) {
      console.error('Order submission failed', err);
      setError(err instanceof Error ? err.message : 'Unable to place order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="card" aria-label="Place your bet">
      <div className="section-heading">
        <h3>Place Your Bet</h3>
      </div>

      {/* Plain-language explanation */}
      <p style={{
        fontSize: '0.82rem',
        color: 'var(--text-secondary)',
        margin: '8px 0 14px',
        lineHeight: 1.5,
      }}>
        {side === 'bid'
          ? `You think the total will be HIGHER than ${price}. If it is, you profit.`
          : `You think the total will be LOWER than ${price}. If it is, you profit.`
        }
      </p>

      {/* Side toggle -- plain language */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setSide('bid')}
          disabled={disabled}
          style={{
            flex: 1,
            padding: '12px 16px',
            border: side === 'bid' ? '2px solid #22c55e' : '2px solid rgba(148,163,184,0.3)',
            borderRadius: 8,
            background: side === 'bid' ? 'rgba(34, 197, 94, 0.2)' : 'transparent',
            color: side === 'bid' ? '#22c55e' : 'var(--text-secondary)',
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            fontSize: '0.9rem',
          }}
        >
          HIGHER
          <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 400, marginTop: 2 }}>
            Buy / Bid
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSide('ask')}
          disabled={disabled}
          style={{
            flex: 1,
            padding: '12px 16px',
            border: side === 'ask' ? '2px solid #ef4444' : '2px solid rgba(148,163,184,0.3)',
            borderRadius: 8,
            background: side === 'ask' ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
            color: side === 'ask' ? '#ef4444' : 'var(--text-secondary)',
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            fontSize: '0.9rem',
          }}
        >
          LOWER
          <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 400, marginTop: 2 }}>
            Sell / Ask
          </span>
        </button>
      </div>

      <form className="form-grid" onSubmit={handleSubmit} style={{ gap: 12 }}>
        {/* Price input with +/- buttons */}
        <label htmlFor="order-price" style={{ marginBottom: 0 }}>
          Target price
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              type="button"
              className="button button--ghost"
              style={{ minWidth: 36, padding: '6px 8px' }}
              onClick={() => setPrice((p) => Math.max(0, p - 1))}
              disabled={disabled}
            >
              -
            </button>
            <input
              id="order-price"
              type="number"
              min={0}
              step={1}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              disabled={disabled}
              style={{ flex: 1, textAlign: 'center' }}
              required
            />
            <button
              type="button"
              className="button button--ghost"
              style={{ minWidth: 36, padding: '6px 8px' }}
              onClick={() => setPrice((p) => p + 1)}
              disabled={disabled}
            >
              +
            </button>
          </div>
        </label>

        {/* Quantity input */}
        <label htmlFor="order-qty" style={{ marginBottom: 0 }}>
          Contracts
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              type="button"
              className="button button--ghost"
              style={{ minWidth: 36, padding: '6px 8px' }}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={disabled}
            >
              -
            </button>
            <input
              id="order-qty"
              type="number"
              min={1}
              max={10}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(10, Number(e.target.value))))}
              disabled={disabled}
              style={{ flex: 1, textAlign: 'center' }}
              required
            />
            <button
              type="button"
              className="button button--ghost"
              style={{ minWidth: 36, padding: '6px 8px' }}
              onClick={() => setQuantity((q) => Math.min(10, q + 1))}
              disabled={disabled}
            >
              +
            </button>
          </div>
        </label>

        {success && (
          <div className="inline-notice inline-notice--success" role="status">
            {success}
          </div>
        )}
        {error && (
          <div className="inline-notice inline-notice--error" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={disabled || submitting}
          style={{
            padding: '12px 16px',
            border: 'none',
            borderRadius: 8,
            background: side === 'bid'
              ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
              : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
            color: 'white',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: disabled || submitting ? 'not-allowed' : 'pointer',
            opacity: disabled || submitting ? 0.5 : 1,
            transition: 'all 0.2s',
          }}
        >
          {submitting
            ? 'Placing...'
            : side === 'bid'
              ? `Bet HIGHER than ${price}`
              : `Bet LOWER than ${price}`
          }
        </button>
      </form>
    </section>
  );
}
