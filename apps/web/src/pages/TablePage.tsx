import { useParams } from "react-router-dom";
import { useEffect, useMemo } from "react";
import QuoteModal from "../ui/QuoteModal";
import TradeTape from "../ui/TradeTape";
import TimerBar from "../ui/TimerBar";
import SeatAvatars from "../ui/SeatAvatars";
import ConnectWalletButton from "../ui/ConnectWalletButton";
import VoiceControls from "../ui/VoiceControls";
import { useGameVoice } from "../hooks/useGameVoice";
import { useGameStore } from "../store";
import { useRoomState } from "../hooks/useRoomState";

export default function TablePage() {
  const { id } = useParams<{ id: string }>();
  const { room, status: roomStatus, error: roomError } = useRoomState(id);
  const voiceEnabled = useGameStore(state => state.isVoiceEnabled);
  const selectedCharacter = useGameStore(state => state.character);
  const round = useGameStore(state => state.round);
  const roundNumber = useGameStore(state => state.roundNumber);
  const gamePhase = useGameStore(state => state.gamePhase);
  const trades = useGameStore(state => state.trades);

  const { queueVoice, announceEvent, playCharacterReaction } = useGameVoice({
    enabled: voiceEnabled,
    autoPlay: true,
    character: selectedCharacter,
  });

  useEffect(() => {
    if (!voiceEnabled || !id) return;
    announceEvent(round.start, id);
  }, [announceEvent, id, voiceEnabled]);

  useEffect(() => {
    if (!trades?.length) return;
    const latestTrade = trades[trades.length - 1];
    if (latestTrade.value > 10) {
      playCharacterReaction(big_win);
    } else if (latestTrade.value < -5) {
      playCharacterReaction(big_loss);
    }
  }, [trades, playCharacterReaction]);

  const roundPhaseLabel = useMemo(() => {
    switch (gamePhase) {
      case waiting:
        return Waiting for players;
      case starting:
        return Shuffling deck;
      case playing:
        return Trading in progress;
      case revealing:
        return Revealing hands;
      case finished:
        return Round complete;
      default:
        return Idle;
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

  const noticeMessage = roomError || (roomStatus === loading && !room ? Connecting to table… : null);

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

      {noticeMessage && (
        <div className={`inline-notice ${roomError ? inline-notice--error : inline-notice--info}`} role="status">
          {noticeMessage}
        </div>
      )}

      <div className="grid grid--sidebar" style={{ alignItems: start, opacity: roomStatus === loading ? 0.7 : 1 }}>
        <div className="grid" style={{ gap: 20 }}>
          <section className="card card--gradient" aria-live="polite">
            <div className="section-heading">
              <h2>🃏 Round status</h2>
              <span>{round?.state ?? deal}</span>
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
            <div className="page__actions" style={{ flexWrap: wrap }}>
              <QuoteModal />
              <button
                type="button"
                className="button button--neutral"
                onClick={() => queueVoice(Place your bets, traders!)}
              >
                📢 Call for bets
              </button>
              <button
                type="button"
                className="button button--neutral"
                onClick={() => playCharacterReaction(close_call)}
              >
                😅 Close call
              </button>
              <button
                type="button"
                className="button button--neutral"
                onClick={() => announceEvent(round.reveal)}
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
