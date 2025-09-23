import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
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
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [currentCharacter, setCurrentCharacter] = useState<'DEALER' | 'BULL' | 'BEAR' | 'WHALE' | 'ROOKIE'>('DEALER');

  useBotAI();

  // Use the game voice hook
  const { queueVoice, announceEvent, playCharacterReaction } = useGameVoice({
    enabled: voiceEnabled,
    autoPlay: true,
    character: currentCharacter,
  });

  // Get game state for voice reactions
  const round = useGameStore((state: any) => state.round);
  const trades = useGameStore((state: any) => state.trades);

  useEffect(() => {
    // Announce when joining table
    announceEvent('round.start', id);
  }, [id]);

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
  }, [trades]);

  const handleVoiceToggle = (enabled: boolean) => {
    setVoiceEnabled(enabled);
  };

  return (
    <div className="table" style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>🎲 Table {id}</h1>
        <ConnectWalletButton />
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '20px' }}>
        <div>
          <SeatAvatars />

          <TimerBar seconds={120} />

          <div className="card-area" style={{
            minHeight: '200px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: '12px',
            padding: '20px',
            marginTop: '20px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
          }}>
            <p style={{ fontSize: '1.2rem', opacity: 0.8 }}>
              {round ? `Round ${round} - Cards will appear here` : 'Waiting for game to start...'}
            </p>
          </div>

          <QuoteModal />

          <TradeTape />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <VoiceControls
            onVoiceToggle={handleVoiceToggle}
            className="table-voice-controls"
          />

          {/* Character Selection for Voice */}
          <div style={{
            background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
            borderRadius: '12px',
            padding: '15px',
            color: 'white',
          }}>
            <h3 style={{ marginBottom: '10px', fontSize: '1.1rem' }}>🎭 Voice Personality</h3>
            <select
              value={currentCharacter}
              onChange={(e) => setCurrentCharacter(e.target.value as any)}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '6px',
                border: 'none',
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                fontSize: '1rem',
              }}
            >
              <option value="DEALER" style={{ color: 'black' }}>🎰 The Dealer (Neutral)</option>
              <option value="BULL" style={{ color: 'black' }}>🐂 Bull Runner (Optimistic)</option>
              <option value="BEAR" style={{ color: 'black' }}>🐻 Bear Necessities (Pessimistic)</option>
              <option value="WHALE" style={{ color: 'black' }}>🐋 The Whale (Strategic)</option>
              <option value="ROOKIE" style={{ color: 'black' }}>👶 Fresh Trader (Enthusiastic)</option>
            </select>
          </div>

          {/* Quick Voice Actions */}
          <div style={{
            background: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
            borderRadius: '12px',
            padding: '15px',
          }}>
            <h3 style={{ marginBottom: '10px', fontSize: '1.1rem', color: '#333' }}>🎯 Quick Actions</h3>
            <div style={{ display: 'grid', gap: '8px' }}>
              <button
                onClick={() => queueVoice("Place your bets, traders!")}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'rgba(255,255,255,0.8)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                📢 Call for Bets
              </button>
              <button
                onClick={() => playCharacterReaction('close_call')}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'rgba(255,255,255,0.8)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                😅 Close Call
              </button>
              <button
                onClick={() => announceEvent('round.reveal')}
                style={{
                  padding: '8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'rgba(255,255,255,0.8)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                🎴 Reveal Cards
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
