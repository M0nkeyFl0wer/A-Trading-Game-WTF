import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface TimerBarProps {
  seconds: number;
  label?: string;
  isPaused?: boolean;
}

export default function TimerBar({ seconds, label = 'Round timer', isPaused = false }: TimerBarProps) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (isPaused) return;

    setRemaining(seconds);
    const start = Date.now();

    const interval = window.setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setRemaining(() => {
        const next = Math.max(0, seconds - Math.floor(elapsed));
        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [seconds, isPaused]);

  const progress = Math.max(0, Math.min(1, remaining / seconds));
  const isUrgent = remaining > 0 && remaining <= 5;

  return (
    <div className={isUrgent ? 'timer-urgent' : ''}>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-live="polite"
      >
        <motion.div
          className="progress-track__bar"
          initial={{ width: '100%' }}
          animate={{ width: `${progress * 100}%` }}
          transition={{ ease: 'easeInOut', duration: 0.8 }}
          style={{
            background: isUrgent
              ? 'linear-gradient(135deg, #ef4444, #f87171)'
              : undefined,
          }}
        />
      </div>
      <div
        className={isUrgent ? 'timer-urgent-text' : ''}
        style={{
          marginTop: 8,
          color: isUrgent ? '#ef4444' : 'var(--text-secondary)',
          fontSize: '0.85rem',
          fontWeight: isUrgent ? 700 : 400,
        }}
      >
        {isPaused ? 'Paused' : `${remaining}s remaining${isUrgent ? ' - HURRY!' : ''}`}
      </div>
    </div>
  );
}
