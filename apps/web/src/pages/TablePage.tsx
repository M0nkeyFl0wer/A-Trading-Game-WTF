import { useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import QuoteModal from '../ui/QuoteModal';
import TradeTape from '../ui/TradeTape';
import TimerBar from '../ui/TimerBar';
import SeatAvatars from '../ui/SeatAvatars';
import ConnectWalletButton from '../ui/ConnectWalletButton';
import VoiceControls from '../ui/VoiceControls';
import { useBotAI } from '../hooks/useBotAI';
import { useGameVoice } from '../hooks/useGameVoice';
import { useGameStore } from '../store';

export default function TablePage() {
  const { id } = useParams();
  const voiceEnabled = useGameStore(state => state.isVoiceEnabled);
  const selectedCharacter = useGameStore(state => state.character);
  const round = useGameStore(state => state.round);
  const roundNumber = useGameStore(state => state.roundNumber);
  const gamePhase = useGameStore(state => state.gamePhase);
  const trades = useGameStore(state => state.trades);

  useBotAI();

  // Use the game voice hook
  const { queueVoice, announceEvent, playCharacterReaction } = useGameVoice({
    enabled: voiceEnabled,
    autoPlay: true,
    character: selectedCharacter,
  });

  useEffect(() => {
    // Announce when joining table
    announceEvent('round.start', id);
  }, [announceEvent, id]);

  // React to trades with voice
  useEffect(() => {
    if (trades && trades.length > 0) {
      const latestTrade = trades[trades.length - 1];
      if (latestTrade.value > 10) {
        playCharacterReaction('big_win');
      } else if (latestTrade.value < -5) {
        playCharacterReaction('big_loss');
      }
    }
  }, [trades, playCharacterReaction]);

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

  return (
    <main className="page" aria-labelledby="table-title">
      <header className="page__header">
        <div>
          <h1 id="table-title" className="page__title">🎲 Table {id}</h1>
          <p className="page__subtitle">Round {roundNumber || 1} · {roundPhaseLabel}</p>
        </div>
        <div className="page__actions">
          <ConnectWalletButton />
        </div>
      </header>

      <div className="grid grid--sidebar" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ gap: 20 }}>
          <section className="card card--gradient" aria-live="polite">
            <div className="section-heading">
              <h2>🃏 Round status</h2>
              <span>{round?.state ?? 'deal'}</span>
            </div>
            <p className="card__subtitle">
              House updates: {roundPhaseLabel}. Keep an eye on the clock and your opponents.
            </p>
            <TimerBar seconds={120} label="Time left this round" />
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
              <QuoteModal />
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
