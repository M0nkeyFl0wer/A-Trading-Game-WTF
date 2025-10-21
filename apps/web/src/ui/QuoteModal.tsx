import { FormEvent, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { voiceService } from '../lib/elevenlabs';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface QuoteFormState {
  bid: number;
  ask: number;
  size: number;
  oneWay: boolean;
}

const initialState: QuoteFormState = {
  bid: 10,
  ask: 12,
  size: 5,
  oneWay: false,
};

interface QuoteModalProps {
  className?: string;
}

export default function QuoteModal({ className = '' }: QuoteModalProps) {
  const [open, setOpen] = useState(false);
  const [formState, setFormState] = useState(initialState);
  const [message, setMessage] = useState<string | null>(null);
  const recordTrade = useGameStore(state => state.recordTrade);
  const voiceEnabled = useGameStore(state => state.isVoiceEnabled);
  const character = useGameStore(state => state.character);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, open);

  const closeModal = () => {
    setOpen(false);
    setMessage(null);
    setFormState({ ...initialState });
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const price = formState.oneWay ? formState.bid : (formState.bid + formState.ask) / 2;
    const quantity = Math.max(1, formState.size);

    recordTrade({
      player: 'You',
      counterparty: formState.oneWay ? 'Market Maker' : 'Crossed',
      quantity,
      price,
      type: formState.oneWay ? 'sell' : 'buy',
      value: price * quantity,
      note: formState.oneWay ? 'One-way quote' : 'Two-sided quote',
    });

    if (voiceEnabled) {
      voiceService
        .announceGameEvent('trade.placed', `${quantity} @ ${price}`, character)
        .catch(console.error);
    }

    setMessage('Quote posted to the pit!');
    setTimeout(() => {
      setMessage(null);
      closeModal();
    }, 800);
  };

  return (
    <div aria-label="Quote order" role="group" className={className}>
      <button
        type="button"
        className="button button--neutral"
        onClick={() => {
          setOpen(true);
          setTimeout(() => firstFieldRef.current?.focus(), 0);
        }}
      >
        💬 Post quote
      </button>

      {open && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => closeModal()}
        >
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quote-modal-title"
            onClick={(event) => event.stopPropagation()}
            ref={dialogRef}
            tabIndex={-1}
          >
            <header className="section-heading" style={{ marginBottom: 16 }}>
              <h2 id="quote-modal-title" style={{ margin: 0 }}>Submit a quote</h2>
              <button type="button" className="button button--ghost" onClick={() => closeModal()}>
                ✕
              </button>
            </header>

            <form className="form-grid" onSubmit={handleSubmit}>
              <div className="grid grid--two">
                <label htmlFor="quote-bid">
                  Bid
                  <input
                    ref={firstFieldRef}
                    id="quote-bid"
                    type="number"
                    min={0}
                    value={formState.bid}
                    onChange={(event) =>
                      setFormState(prev => ({ ...prev, bid: Number(event.target.value) }))
                    }
                    required
                  />
                </label>

                {!formState.oneWay && (
                  <label htmlFor="quote-ask">
                    Ask
                    <input
                      id="quote-ask"
                      type="number"
                      min={formState.bid}
                      value={formState.ask}
                      onChange={(event) =>
                        setFormState(prev => ({ ...prev, ask: Number(event.target.value) }))
                      }
                      required
                    />
                  </label>
                )}
              </div>

              <label htmlFor="quote-size">
                Size
                <input
                  id="quote-size"
                  type="number"
                  min={1}
                  value={formState.size}
                  onChange={(event) =>
                    setFormState(prev => ({ ...prev, size: Number(event.target.value) }))
                  }
                />
              </label>

              <label htmlFor="quote-oneway" style={{ flexDirection: 'row', alignItems: 'center' }}>
                <input
                  id="quote-oneway"
                  type="checkbox"
                  checked={formState.oneWay}
                  onChange={(event) =>
                    setFormState(prev => ({ ...prev, oneWay: event.target.checked }))
                  }
                />
                <span>One-way quote (post bid only)</span>
              </label>

              {message && (
                <div className="inline-notice inline-notice--success" role="status">
                  {message}
                </div>
              )}

              <div className="page__actions" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="button button--ghost" onClick={() => closeModal()}>
                  Cancel
                </button>
                <button type="submit" className="button button--primary">
                  Post quote
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
