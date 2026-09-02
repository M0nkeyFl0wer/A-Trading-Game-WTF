import { useEffect, useState } from 'react';

/**
 * First-run "how to play" walkthrough (issue #30).
 *
 * A short, skippable overlay that explains the one thing a new player can't
 * infer from the board: what they're actually betting on, and what the trading
 * verbs mean. It is localStorage-gated so it appears exactly once, and the
 * "How to play" button lets anyone replay it on demand.
 *
 * Kept deliberately tiny and dependency-free: four steps, Next/Back/Skip, and
 * an Esc-to-close. Mobile-legible -- the card is width-capped and scrolls if a
 * short viewport can't fit it.
 */

const STORAGE_KEY = 'tg.walkthrough.seen.v1';

interface Step {
  title: string;
  body: string;
}

// Four plain-language steps. No jargon in the first read; the jargon
// (hit/lift/bid/ask) is introduced with its meaning attached.
const STEPS: Step[] = [
  {
    title: 'What you’re betting on',
    body:
      'Every player holds one hidden card and there are three shared cards in the middle. '
      + 'The round settles on the TOTAL of all of them. Your job is to guess whether that '
      + 'total ends up higher or lower than the prices being traded.',
  },
  {
    title: 'Fair value vs. the crowd',
    body:
      'The centre shows a "fair" estimate from what you can see, and a drifting CONSENSUS '
      + '— the room’s live belief. Consensus moves as people quote and trade. When the '
      + 'crowd is wrong, that’s your edge.',
  },
  {
    title: 'Asking for a price',
    body:
      'Ask any player for a two-way price and they must quote a bid and an offer, 2 apart. '
      + 'Then YOU choose which side to take — you’re never forced to trade.',
  },
  {
    title: 'Hit = sell, Lift = buy',
    body:
      'Think the total finishes LOWER than the bid? SELL the bid (“hit”). '
      + 'Think it finishes HIGHER than the offer? BUY the offer (“lift”). '
      + 'You win the difference between the price you took and the real total.',
  },
];

function hasSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private mode / storage blocked: treat as "seen" so we never trap a player
    // behind an overlay we can't remember dismissing.
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Best-effort only; a blocked write just means it may show again next time.
  }
}

export default function Walkthrough() {
  // Open automatically on first run; the replay button re-opens it later.
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!hasSeen()) setOpen(true);
  }, []);

  // Esc closes the overlay, matching the Skip button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => {
    markSeen();
    setOpen(false);
    setStep(0);
  };

  const replay = () => {
    setStep(0);
    setOpen(true);
  };

  const isLast = step === STEPS.length - 1;

  return (
    <>
      {/* Always-available replay trigger, so the walkthrough isn't a one-shot. */}
      <button type="button" className="walkthrough-replay" onClick={replay}>
        How to play
      </button>

      {open && (
        <div
          className="walkthrough-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="walkthrough-title"
          onClick={close}
        >
          {/* Stop clicks inside the card from closing via the backdrop handler. */}
          <div className="walkthrough-card" onClick={(e) => e.stopPropagation()}>
            <div className="walkthrough-steps" aria-hidden="true">
              {STEPS.map((_, i) => (
                <span key={i} className={'walkthrough-dot' + (i === step ? ' is-now' : '')} />
              ))}
            </div>

            <h2 id="walkthrough-title" className="walkthrough-title">
              {STEPS[step].title}
            </h2>
            <p className="walkthrough-body">{STEPS[step].body}</p>

            <div className="walkthrough-actions">
              <button type="button" className="walkthrough-skip" onClick={close}>
                Skip
              </button>
              <div className="walkthrough-nav">
                {step > 0 && (
                  <button
                    type="button"
                    className="walkthrough-btn"
                    onClick={() => setStep((s) => s - 1)}
                  >
                    Back
                  </button>
                )}
                {isLast ? (
                  <button type="button" className="walkthrough-btn walkthrough-btn--primary" onClick={close}>
                    Got it
                  </button>
                ) : (
                  <button
                    type="button"
                    className="walkthrough-btn walkthrough-btn--primary"
                    onClick={() => setStep((s) => s + 1)}
                  >
                    Next
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
