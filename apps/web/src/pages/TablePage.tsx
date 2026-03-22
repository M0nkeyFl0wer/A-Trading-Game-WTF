import { useParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import OrderForm from '../ui/OrderForm';
import OrderBookDisplay from '../ui/OrderBookDisplay';
import PhaseIndicator from '../ui/PhaseIndicator';
import CommunityCards from '../ui/CommunityCards';
import TradeTape from '../ui/TradeTape';
import SeatAvatars from '../ui/SeatAvatars';
import SettlementScreen from '../ui/SettlementScreen';
import ConnectWalletButton from '../ui/ConnectWalletButton';
import VoiceControls from '../ui/VoiceControls';
import { useGameVoice } from '../hooks/useGameVoice';
import { useGameStore } from '../store';
import type { Commentary } from '../store';
import { useRoomState } from '../hooks/useRoomState';
import { useAuth } from '../contexts/AuthContext';
import { voiceService } from '../lib/elevenlabs';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export default function TablePage() {
  const { id } = useParams<{ id: string }>();
  const { room, status: roomStatus, error: roomError } = useRoomState(id);
  const voiceEnabled = useGameStore((state) => state.isVoiceEnabled);
  const selectedCharacter = useGameStore((state) => state.character);
  const roundNumber = useGameStore((state) => state.roundNumber);
  const gamePhase = useGameStore((state) => state.gamePhase);
  const tradingPhase = useGameStore((state) => state.tradingPhase);
  const myCard = useGameStore((state) => state.myCard);
  const matchedTrades = useGameStore((state) => state.matchedTrades);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [startingRound, setStartingRound] = useState(false);
  const { currentUser } = useAuth();
  const isHost = Boolean(currentUser && room?.hostId && currentUser.uid === room.hostId);

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
    if (!matchedTrades?.length) return;
    const latestTrade = matchedTrades[matchedTrades.length - 1];
    if (latestTrade.price * latestTrade.quantity > 100) {
      playCharacterReaction('big_win');
    }
  }, [matchedTrades, playCharacterReaction]);

  // Speak the highest-priority commentary line from the Dealer
  const commentary = useGameStore((state) => state.commentary);
  const lastSpokenRef = useRef('');
  useEffect(() => {
    if (!voiceEnabled || !commentary?.length) return;
    // Pick the highest priority comment
    const priorityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const sorted = [...commentary].sort(
      (a, b) => (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0),
    );
    const best = sorted[0];
    if (!best || best.text === lastSpokenRef.current) return;
    lastSpokenRef.current = best.text;
    voiceService.playSpeech(best.text).catch((err) => {
      console.error('Commentary voice error:', err);
    });
  }, [commentary, voiceEnabled]);

  const isTradingActive = useMemo(
    () => ['blind', 'flop', 'turn'].includes(room?.status ?? ''),
    [room?.status],
  );

  const roundPhaseLabel = useMemo(() => {
    if (tradingPhase === 'blind') return 'Blind trading';
    if (tradingPhase === 'flop') return 'Flop trading';
    if (tradingPhase === 'turn') return 'Turn trading';
    if (tradingPhase === 'finished') return 'Round complete';
    if (tradingPhase === 'waiting') return 'Waiting for players';
    switch (gamePhase) {
      case 'waiting': return 'Waiting for players';
      case 'starting': return 'Shuffling deck';
      case 'playing': return 'Trading in progress';
      case 'finished': return 'Round complete';
      default: return 'Idle';
    }
  }, [tradingPhase, gamePhase]);

  if (!id) {
    return (
      <main className="page">
        <div className="inline-notice inline-notice--error" role="alert">
          Missing table identifier.
        </div>
      </main>
    );
  }

  const noticeMessage = roomError || (roomStatus === 'loading' && !room ? 'Connecting to table...' : null);

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
      setActionMessage('Launching new round...');
    } catch (err) {
      console.error('Failed to start round', err);
      setActionError(err instanceof Error ? err.message : 'Unable to start round');
    } finally {
      setStartingRound(false);
    }
  };

  return (
    <main className="page" aria-labelledby="table-title">
      {/* Settlement overlay */}
      <SettlementScreen />

      <header className="page__header">
        <div>
          <h1 id="table-title" className="page__title">
            {room?.name ?? `Table ${id}`}
          </h1>
          <p className="page__subtitle">Round {roundNumber || 1} &middot; {roundPhaseLabel}</p>
        </div>
        <div className="page__actions">
          <Link to="/" className="button button--ghost">
            &larr; Back
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

      <div style={{ opacity: roomStatus === 'loading' ? 0.7 : 1 }}>
        {/* Phase indicator */}
        <PhaseIndicator />

        {/* Community cards */}
        <div style={{ marginTop: 16 }}>
          <CommunityCards />
        </div>

        {/* Main content grid */}
        <div
          className="grid grid--sidebar"
          style={{ alignItems: 'start', marginTop: 16 }}
        >
          {/* Left column: order book + order form */}
          <div className="grid" style={{ gap: 16 }}>
            <OrderBookDisplay roomId={id} />
            <OrderForm
              roomId={id}
              disabled={!isTradingActive}
              myCardValue={myCard}
            />

            {/* Host controls */}
            {isHost && !isTradingActive && tradingPhase !== 'finished' && (
              <section className="card" aria-label="Host controls">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={handleStartRound}
                  disabled={startingRound}
                  style={{ width: '100%' }}
                >
                  {startingRound ? 'Launching...' : 'Start Round'}
                </button>
              </section>
            )}

            {/* Voice action buttons */}
            <section className="card" aria-label="Voice actions">
              <div className="section-heading">
                <h3>Table Actions</h3>
              </div>
              <div className="page__actions" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="button button--neutral"
                  onClick={() => queueVoice('Place your bets, traders!')}
                >
                  Call for bets
                </button>
                <button
                  type="button"
                  className="button button--neutral"
                  onClick={() => playCharacterReaction('close_call')}
                >
                  Close call
                </button>
                <button
                  type="button"
                  className="button button--neutral"
                  onClick={() => announceEvent('round.reveal')}
                >
                  Reveal cards
                </button>
              </div>
            </section>
          </div>

          {/* Right column: seats, trade tape, voice */}
          <aside className="grid" style={{ gap: 16 }} aria-label="Table info">
            <SeatAvatars />
            <TradeTape />
            <VoiceControls className="table-voice-controls" />
          </aside>
        </div>
      </div>
    </main>
  );
}
