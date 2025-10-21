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
      setRemaining(prev => {
        const next = Math.max(0, seconds - Math.floor(elapsed));
        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [seconds, isPaused]);

  const progress = Math.max(0, Math.min(1, remaining / seconds));

  return (
    <div>
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
        />
      </div>
      <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        {isPaused ? 'Paused' : `${remaining}s remaining`}
      </div>
    </div>
  );
}
