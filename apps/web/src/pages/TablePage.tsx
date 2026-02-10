import { useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import QuoteModal from '../ui/QuoteModal';
import TradeTape from '../ui/TradeTape';
import TimerBar from '../ui/TimerBar';
import SeatAvatars from '../ui/SeatAvatars';
import GameRulesPanel from '../ui/GameRulesPanel';
import ConnectWalletButton from '../ui/ConnectWalletButton';
import VoiceControls from '../ui/VoiceControls';
import GameRulesPanel from '../ui/GameRulesPanel';
import { useGameVoice } from '../hooks/useGameVoice';
import { useBotAI } from '../hooks/useBotAI';
import { useGameStore } from '../store';
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
  const [timeLeft, setTimeLeft] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [startingRound, setStartingRound] = useState(false);
  const { currentUser } = useAuth();
  const isHost = Boolean(currentUser && room?.hostId && currentUser.uid === room.hostId);
  useBotAI(id);

  // Auto-fill empty seats with bot opponents
  useBotAI(id);

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
            </div>
          </section>

          <TradeTape />
        </div>

        <aside className="grid" style={{ gap: 20 }} aria-label="Table controls">
          <GameRulesPanel />
          <VoiceControls className="table-voice-controls" />
        </aside>
      </div>
    </main>
  );
}
