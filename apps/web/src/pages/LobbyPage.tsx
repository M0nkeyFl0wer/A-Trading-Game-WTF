import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store';
import CreateTableModal from '../ui/CreateTableModal';
import ConnectWalletButton from '../ui/ConnectWalletButton';
import VoiceControls from '../ui/VoiceControls';
import CharacterGallery from '../ui/CharacterGallery';
import { voiceService } from '../lib/elevenlabs';
import { CharacterType } from '../lib/characterVisuals';

export default function LobbyPage() {
  const startRound = useGameStore(s => s.startRound);
  const [tables, setTables] = useState<{id:number}[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterType>('DEALER');

  useEffect(() => {
    // TODO: fetch tables via websocket
    setTables([]);

    // Welcome voice greeting when entering lobby
    if (voiceEnabled) {
      voiceService.announceGameEvent('game.start').catch(console.error);
    }
  }, []);

  const handleVoiceToggle = (enabled: boolean) => {
    setVoiceEnabled(enabled);
  };

  const handleTableJoin = async (tableId: number) => {
    if (voiceEnabled) {
      await voiceService.playSpeech(`Joining table ${tableId}. Good luck, trader!`);
    }
  };

  return (
    <div className="lobby" style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px' }}>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 'bold' }}>🎰 Trading Game Lobby</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <ConnectWalletButton />
        </div>
      </header>

      {/* Character Selection Gallery */}
      <div style={{ marginBottom: '40px' }}>
        <CharacterGallery
          selectedCharacter={selectedCharacter}
          onCharacterSelect={setSelectedCharacter}
          enableVoice={voiceEnabled}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '30px' }}>
        <div>
          <CreateTableModal onCreate={startRound} />

          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '30px', marginBottom: '20px' }}>
            📊 Available Tables
          </h2>

          {tables.length === 0 ? (
            <div style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              borderRadius: '12px',
              padding: '40px',
              textAlign: 'center',
              color: 'white',
            }}>
              <p style={{ fontSize: '1.2rem', marginBottom: '10px' }}>No active tables</p>
              <p style={{ opacity: 0.8 }}>Create a new table to start playing!</p>
            </div>
          ) : (
            <ul style={{ display: 'grid', gap: '10px' }}>
              {tables.map(t => (
                <li key={t.id} style={{ listStyle: 'none' }}>
                  <Link
                    to={`/table/${t.id}`}
                    onClick={() => handleTableJoin(t.id)}
                    style={{
                      display: 'block',
                      padding: '15px',
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      borderRadius: '8px',
                      color: 'white',
                      textDecoration: 'none',
                      transition: 'transform 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    🎲 Table {t.id}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <VoiceControls
            onVoiceToggle={handleVoiceToggle}
            className="lobby-voice-controls"
          />
        </div>
      </div>
    </div>
  );
}
