import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { TradingPhase } from '@trading-game/shared';
import { PHASE_SEQUENCE } from '@trading-game/shared';
import { useGameStore } from '../store';

const PHASE_LABELS: Record<string, string> = {
  blind: 'Blind',
  flop: 'Flop',
  turn: 'Turn',
  settlement: 'Settlement',
};

const ALL_STEPS = [...PHASE_SEQUENCE.map(p => p.phase), 'settlement'] as const;

function getStepState(
  step: string,
  currentPhase: TradingPhase | 'waiting' | 'finished' | null,
): 'completed' | 'active' | 'upcoming' {
  if (currentPhase === 'finished') {
    return 'completed';
  }
  if (!currentPhase || currentPhase === 'waiting') {
    return 'upcoming';
  }
  const currentIdx = ALL_STEPS.indexOf(currentPhase as typeof ALL_STEPS[number]);
  const stepIdx = ALL_STEPS.indexOf(step as typeof ALL_STEPS[number]);
  if (stepIdx < currentIdx) return 'completed';
  if (stepIdx === currentIdx) return 'active';
  return 'upcoming';
}

export default function PhaseIndicator() {
  const tradingPhase = useGameStore((state) => state.tradingPhase);
  const phaseEndsAt = useGameStore((state) => state.phaseEndsAt);
  const revealedCards = useGameStore((state) => state.revealedCommunityCards);
  const [remaining, setRemaining] = useState(0);
  const [totalDuration, setTotalDuration] = useState(30);

  useEffect(() => {
    if (!phaseEndsAt) {
      setRemaining(0);
      return;
    }

    const update = () => {
      const left = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
      setRemaining(left);
    };
    update();

    const initialLeft = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
    if (initialLeft > 0) {
      setTotalDuration(initialLeft);
    }

    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [phaseEndsAt]);

  const progress = totalDuration > 0 ? Math.max(0, Math.min(1, remaining / totalDuration)) : 0;
  const isUrgent = remaining > 0 && remaining <= 5;

  // Cards revealed per phase
  const cardsForPhase = (step: string): number[] => {
    if (step === 'blind') return [];
    if (step === 'flop') return revealedCards.slice(0, 1);
    if (step === 'turn') return revealedCards.slice(0, 2);
    return revealedCards;
  };

  return (
    <section className="card" aria-label="Phase indicator" style={{ padding: '16px 20px' }}>
      {/* Phase steps */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        position: 'relative',
      }}>
        {ALL_STEPS.map((step, idx) => {
          const state = getStepState(step, tradingPhase);
          const isLast = idx === ALL_STEPS.length - 1;
          const phaseCards = cardsForPhase(step);

          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', flex: isLast ? 0 : 1 }}>
              {/* Step marker */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    border: '2px solid',
                    borderColor: state === 'active'
                      ? '#818cf8'
                      : state === 'completed'
                      ? '#22c55e'
                      : 'rgba(148, 163, 184, 0.3)',
                    background: state === 'active'
                      ? 'rgba(129, 140, 248, 0.2)'
                      : state === 'completed'
                      ? 'rgba(34, 197, 94, 0.2)'
                      : 'transparent',
                    color: state === 'active'
                      ? '#818cf8'
                      : state === 'completed'
                      ? '#22c55e'
                      : 'rgba(148, 163, 184, 0.5)',
                    transition: 'all 0.3s',
                  }}
                >
                  {state === 'completed' ? '\u2713' : idx + 1}
                </div>
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: state === 'active' ? 700 : 500,
                  color: state === 'active'
                    ? '#818cf8'
                    : state === 'completed'
                    ? '#22c55e'
                    : 'var(--text-secondary)',
                  marginTop: 4,
                  transition: 'all 0.3s',
                }}>
                  {PHASE_LABELS[step]}
                </span>
                {/* Revealed cards under completed phases */}
                {state === 'completed' && phaseCards.length > 0 && (
                  <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
                    {phaseCards.map((val, ci) => (
                      <span
                        key={ci}
                        style={{
                          fontSize: '0.65rem',
                          padding: '1px 4px',
                          background: 'rgba(99, 102, 241, 0.15)',
                          borderRadius: 3,
                          fontWeight: 600,
                        }}
                      >
                        {val}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Connector line */}
              {!isLast && (
                <div style={{
                  flex: 1,
                  height: 2,
                  marginTop: -16,
                  background: state === 'completed'
                    ? '#22c55e'
                    : 'rgba(148, 163, 184, 0.2)',
                  transition: 'background 0.3s',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Timer bar with urgency */}
      {tradingPhase && tradingPhase !== 'waiting' && tradingPhase !== 'finished' && (
        <div className={isUrgent ? 'timer-urgent' : ''}>
          <div
            style={{
              width: '100%',
              height: 6,
              borderRadius: 3,
              background: 'rgba(148, 163, 184, 0.15)',
              overflow: 'hidden',
            }}
            role="progressbar"
            aria-valuenow={remaining}
            aria-valuemin={0}
            aria-valuemax={totalDuration}
            aria-label="Phase timer"
          >
            <motion.div
              style={{
                height: '100%',
                borderRadius: 3,
                background: isUrgent
                  ? 'linear-gradient(90deg, #ef4444, #f87171)'
                  : 'linear-gradient(90deg, #818cf8, #6366f1)',
              }}
              animate={{ width: `${progress * 100}%` }}
              transition={{ ease: 'linear', duration: 0.5 }}
            />
          </div>
          <div
            className={isUrgent ? 'timer-urgent-text' : ''}
            style={{
              textAlign: 'center',
              marginTop: 6,
              fontSize: '0.8rem',
              color: isUrgent ? '#ef4444' : 'var(--text-secondary)',
              fontWeight: isUrgent ? 700 : 400,
              fontFamily: 'monospace',
            }}
          >
            {remaining}s{isUrgent ? ' - HURRY!' : ''}
          </div>
        </div>
      )}
    </section>
  );
}
