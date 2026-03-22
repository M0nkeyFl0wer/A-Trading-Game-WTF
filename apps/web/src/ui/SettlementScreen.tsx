import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '../store';

const balanceFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const pnlFmt = (value: number) => {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${balanceFmt.format(value)}`;
};

export default function SettlementScreen() {
  const tradingPhase = useGameStore((state) => state.tradingPhase);
  const settlementTotal = useGameStore((state) => state.settlementTotal);
  const revealedCards = useGameStore((state) => state.revealedCommunityCards);
  const pnl = useGameStore((state) => state.pnl);
  const players = useGameStore((state) => state.players);
  const [countdown, setCountdown] = useState(10);

  const isVisible = tradingPhase === 'finished';

  useEffect(() => {
    if (!isVisible) {
      setCountdown(10);
      return;
    }
    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isVisible]);

  // Sort players by PnL descending
  const sortedPlayers = [...players].sort((a, b) => {
    const pnlA = pnl?.[a.id] ?? 0;
    const pnlB = pnl?.[b.id] ?? 0;
    return pnlB - pnlA;
  });

  const winnerId = sortedPlayers.length > 0 ? sortedPlayers[0].id : null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(2, 6, 23, 0.88)',
            backdropFilter: 'blur(8px)',
            padding: 24,
          }}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 20 }}
            style={{
              width: '100%',
              maxWidth: 560,
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: 16,
              border: '1px solid rgba(148, 163, 184, 0.15)',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
              padding: 28,
            }}
          >
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                Round Complete
              </div>
              <div style={{ fontSize: '2.4rem', fontWeight: 800, color: '#818cf8' }}>
                Settlement
              </div>
            </div>

            {/* Community cards */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 16 }}>
              {Array.from({ length: 3 }).map((_, idx) => {
                const value = revealedCards[idx];
                return (
                  <div
                    key={idx}
                    style={{
                      width: 60,
                      height: 84,
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '1.4rem',
                      background: 'linear-gradient(135deg, #1e293b, #334155)',
                      border: '2px solid rgba(148, 163, 184, 0.3)',
                      color: '#f1f5f9',
                    }}
                  >
                    {value != null ? value : '?'}
                  </div>
                );
              })}
            </div>

            {/* Total */}
            {settlementTotal != null && (
              <div style={{
                textAlign: 'center',
                marginBottom: 20,
                padding: '10px 16px',
                background: 'rgba(99, 102, 241, 0.1)',
                borderRadius: 10,
                border: '1px solid rgba(99, 102, 241, 0.2)',
              }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total</span>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#e0e7ff' }}>{settlementTotal}</div>
              </div>
            )}

            {/* PnL table */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: '6px 16px',
                padding: '8px 12px',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: '1px solid rgba(148,163,184,0.15)',
              }}>
                <span>Player</span>
                <span style={{ textAlign: 'right' }}>Card</span>
                <span style={{ textAlign: 'right' }}>Net PnL</span>
              </div>
              {sortedPlayers.map((player) => {
                const playerPnl = pnl?.[player.id] ?? 0;
                const isWinner = player.id === winnerId && playerPnl > 0;
                return (
                  <div
                    key={player.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      gap: '6px 16px',
                      padding: '10px 12px',
                      borderRadius: 6,
                      background: isWinner ? 'rgba(34, 197, 94, 0.08)' : 'transparent',
                      fontSize: '0.88rem',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {isWinner && <span style={{ marginRight: 4 }}>&#128081;</span>}
                      {player.name}
                      {player.isBot && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: 6 }}>BOT</span>}
                    </span>
                    <span style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {player.cardValue != null ? player.cardValue : '--'}
                    </span>
                    <span style={{
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      fontWeight: 700,
                      color: playerPnl > 0 ? '#22c55e' : playerPnl < 0 ? '#ef4444' : 'var(--text-secondary)',
                    }}>
                      {pnlFmt(playerPnl)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Next round countdown */}
            <div style={{
              textAlign: 'center',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
            }}>
              {countdown > 0
                ? `Next round starting in ${countdown}s...`
                : 'Starting next round...'}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
