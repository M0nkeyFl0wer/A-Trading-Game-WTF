import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface Props { seconds: number; }

export default function TimerBar({ seconds }: Props) {
  const [progress, setProgress] = useState(1);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setProgress(Math.max(0, 1 - elapsed / seconds));
    }, 1000);
    return () => clearInterval(timer);
  }, [seconds]);
  return (
    <div className="timer-bar" style={{ background: '#eee', height: 10 }}>
      <motion.div style={{ height: 10, background: 'green' }} animate={{ width: `${progress*100}%` }} />
    </div>
  );
}
