import { useParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import QuoteModal from '../ui/QuoteModal';
import TradeTape from '../ui/TradeTape';
import TimerBar from '../ui/TimerBar';
import SeatAvatars from '../ui/SeatAvatars';
import ConnectWalletButton from '../ui/ConnectWalletButton';
import VoiceControls from '../ui/VoiceControls';
import { useGameVoice } from '../hooks/useGameVoice';
import { useGameStore, type PlayerState } from '../store';
import { useRoomState } from '../hooks/useRoomState';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export default function TablePage() {
  const { id } = useParams<{ id: string }>();
  const { room, status: roomStatus, error: roomError } = useRoomState(id);
  const voiceEnabled = useGameStore((state) => state.isVoiceEnabled);
  const selectedCharacter = useGameStore((state) => state.character);
  const roundNumber = useGameStore((state) => state.roundNumber);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const trades = useGameStore((state) => state.trades);
  const players = useGameStore((state) => state.players);
  const [timeLeft, setTimeLeft] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [startingRound, setStartingRound] = useState(false);
  const [addingBot, setAddingBot] = useState(false);
  const [botCharacter, setBotCharacter] = useState<'BULL' | 'BEAR' | 'WHALE' | 'ROOKIE'>('BULL');
  const { currentUser } = useAuth();
  const isHost = Boolean(currentUser && room?.hostId && currentUser.uid === room.hostId);
  const roomIsFull = Boolean(room && room.players.length >= room.maxPlayers);

  // Find the current user's card value from the game state
  const myCard: PlayerState | undefined = useMemo(
    () => currentUser ? players.find((p) => p.id === currentUser.uid) : undefined,
    [players, currentUser],
  );

  const { queueVoice, announceEvent, playCharacterReaction } = useGameVoice({
    enabled: voiceEnabled,
    autoPlay: true,
    character: selectedCharacter,
  });

  useEffect(() => {
    if (!voiceEnabled || !id) return;
    announceEvent('round.start', id);
  }, [announceEvent, id, voiceEnabled]);

  useEffect(() => {
    if (!trades?.length) return;
    const latestTrade = trades[trades.length - 1];
    if (latestTrade.value > 10) {
      playCharacterReaction('big_win');
    } else if (latestTrade.value < -5) {
      playCharacterReaction('big_loss');
    }
  }, [trades, playCharacterReaction]);

  useEffect(() => {
    if (!room?.roundEndsAt) {
      setTimeLeft(0);
      return;
    }
    const update = () => {
      setTimeLeft(Math.max(0, Math.ceil((room.roundEndsAt! - Date.now()) / 1000)));
    };
    update();
    const interval = setInterval(update, 1_000);
    return () => clearInterval(interval);
  }, [room?.roundEndsAt]);

  const roundPhaseLabel = useMemo(() => {
    switch (gamePhase) {
      case 'waiting':
        return 'Waiting for players';
      case 'starting':
        return 'Shuffling deck';
      case 'playing':
        return 'Trading in progress';
      case 'revealing':
        return 'Revealing hands';
      case 'finished':
        return 'Round complete';
      default:
        return 'Idle';
    }
  }, [gamePhase]);

  if (!id) {
    return (
      <main className="page">
        <div className="inline-notice inline-notice--error" role="alert">
          Missing table identifier.
        </div>
      </main>
    );
  }

  const noticeMessage = roomError || (roomStatus === 'loading' && !room ? 'Connecting to table…' : null);
  const isTradingActive = room?.status === 'playing';
  const canAddBot = isHost && !isTradingActive && !roomIsFull;

  const BOT_CHARACTER_OPTIONS = ['BULL', 'BEAR', 'WHALE', 'ROOKIE'] as const;
  const BOT_CHARACTER_LABELS: Record<string, string> = {
    BULL: 'Bull Runner',
    BEAR: 'Bear Necessities',
    WHALE: 'The Whale',
    ROOKIE: 'Fresh Trader',
  };

  const handleAddBot = async () => {
    if (!id || !currentUser) return;
    setAddingBot(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_BASE}/api/room/${id}/add-bot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ character: botCharacter }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to add bot');
      }
      setActionMessage(`${BOT_CHARACTER_LABELS[botCharacter]} joined the table`);
      // Cycle to next character for convenience
      const currentIndex = BOT_CHARACTER_OPTIONS.indexOf(botCharacter);
      setBotCharacter(BOT_CHARACTER_OPTIONS[(currentIndex + 1) % BOT_CHARACTER_OPTIONS.length]);
    } catch (err) {
      console.error('Failed to add bot', err);
      setActionError(err instanceof Error ? err.message : 'Unable to add bot');
    } finally {
      setAddingBot(false);
    }
  };

  const handleStartRound = async () => {
    if (!id || !currentUser) return;
    setStartingRound(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_BASE}/api/room/${id}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to start round');
      }
      setActionMessage('Launching new round…');
    } catch (err) {
      console.error('Failed to start round', err);
      setActionError(err instanceof Error ? err.message : 'Unable to start round');
    } finally {
      setStartingRound(false);
    }
  };

  return (
    <main className="page" aria-labelledby="table-title">
      <header className="page__header">
        <div>
          <h1 id="table-title" className="page__title">🎲 {room?.name ?? `Table ${id}`}</h1>
          <p className="page__subtitle">Round {roundNumber || 1} · {roundPhaseLabel}</p>
        </div>
        <div className="page__actions">
          <Link to="/" className="button button--ghost">
            ← Back to Lobby
          </Link>
          <ConnectWalletButton />
        </div>
      </header>

      {(noticeMessage || actionMessage || actionError) && (
        <div className="stack" style={{ marginBottom: 16 }}>
          {noticeMessage && (
            <div className={`inline-notice ${roomError ? 'inline-notice--error' : 'inline-notice--info'}`} role="status">
              {noticeMessage}
            </div>
          )}
          {actionMessage && (
            <div className="inline-notice inline-notice--info" role="status">
              {actionMessage}
            </div>
          )}
          {actionError && (
            <div className="inline-notice inline-notice--error" role="alert">
              {actionError}
            </div>
          )}
        </div>
      )}

      <div className="grid grid--sidebar" style={{ alignItems: 'start', opacity: roomStatus === 'loading' ? 0.7 : 1 }}>
        <div className="grid" style={{ gap: 20 }}>
          <section className="card card--gradient" aria-live="polite">
            <div className="section-heading">
              <h2>🃏 Round status</h2>
              <span>{gamePhase}</span>
            </div>
            <p className="card__subtitle">
              House updates: {roundPhaseLabel}. Keep an eye on the clock and your opponents.
            </p>
            {typeof myCard?.cardValue === 'number' && isTradingActive && (
              <div
                style={{
                  margin: '16px 0',
                  padding: '20px 24px',
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(129,140,248,0.25))',
                  border: '2px solid rgba(59,130,246,0.7)',
                  borderRadius: 12,
                  fontSize: '2rem',
                  fontWeight: 800,
                  textAlign: 'center',
                  letterSpacing: '0.02em',
                  boxShadow: '0 0 20px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
                  animation: 'card-pulse 2s ease-in-out infinite',
                }}
                role="status"
                aria-label={`Your card value is ${myCard.cardValue}`}
              >
                🃏 Your card: <span style={{ fontSize: '2.5rem', color: '#60a5fa' }}>{myCard.cardValue}</span>
                <style>{`@keyframes card-pulse { 0%, 100% { box-shadow: 0 0 20px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.1); } 50% { box-shadow: 0 0 30px rgba(59,130,246,0.4), inset 0 1px 0 rgba(255,255,255,0.15); } }`}</style>
              </div>
            )}
            {gamePhase === 'finished' && players.length > 0 && (
              <div
                style={{
                  margin: '16px 0',
                  padding: '16px 20px',
                  background: 'rgba(129,140,248,0.12)',
                  border: '1px solid rgba(129,140,248,0.3)',
                  borderRadius: 10,
                }}
              >
                <h3 style={{ margin: '0 0 12px', fontSize: '1.1rem' }}>Round Results</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                  {players.map((p) => (
                    <li
                      key={p.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: p.isWinner ? 'rgba(52,211,153,0.15)' : 'transparent',
                        fontWeight: p.isWinner ? 700 : 400,
                      }}
                    >
                      <span>
                        {p.isWinner ? '👑 ' : ''}{p.name}
                        {typeof p.cardValue === 'number' && (
                          <span style={{ marginLeft: 8, opacity: 0.7 }}>Card: {p.cardValue}</span>
                        )}
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        Balance: ${p.balance.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <TimerBar seconds={timeLeft} label={isTradingActive ? 'Trading window' : 'Waiting for host'} />
          </section>

          <SeatAvatars />

          <section className="card" aria-label="Trading controls">
            <div className="section-heading">
              <h3>🎯 Trading controls</h3>
              <span>Manage your flow</span>
            </div>
            <p className="card__subtitle">
              Submit a quote or trigger commentary to keep the floor engaged.
            </p>
            <div className="page__actions" style={{ flexWrap: 'wrap' }}>
              <QuoteModal roomId={id} disabled={!isTradingActive} />
              <button
                type="button"
                className="button button--neutral"
                onClick={() => queueVoice('Place your bets, traders!')}
              >
                📢 Call for bets
              </button>
              <button
                type="button"
                className="button button--neutral"
                onClick={() => playCharacterReaction('close_call')}
              >
                😅 Close call
              </button>
              <button
                type="button"
                className="button button--neutral"
                onClick={() => announceEvent('round.reveal')}
              >
                🎴 Reveal cards
              </button>
              {isHost && !isTradingActive && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={handleStartRound}
                  disabled={startingRound}
                >
                  {startingRound ? 'Launching…' : 'Start round'}
                </button>
              )}
              {canAddBot && (
                <>
                  <select
                    value={botCharacter}
                    onChange={(e) => setBotCharacter(e.target.value as typeof botCharacter)}
                    className="button button--neutral"
                    aria-label="Bot character"
                    style={{ cursor: 'pointer' }}
                  >
                    {BOT_CHARACTER_OPTIONS.map((char) => (
                      <option key={char} value={char}>
                        {BOT_CHARACTER_LABELS[char]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button button--neutral"
                    onClick={handleAddBot}
                    disabled={addingBot}
                  >
                    {addingBot ? 'Adding…' : 'Add Bot'}
                  </button>
                </>
              )}
            </div>
          </section>

          <TradeTape />
        </div>

        <aside className="grid" style={{ gap: 20 }} aria-label="Table controls">
          <VoiceControls className="table-voice-controls" />
        </aside>
      </div>
    </main>
  );
}
