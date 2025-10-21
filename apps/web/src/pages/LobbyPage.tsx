import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { voiceService } from '../lib/elevenlabs';
import { useGameStore } from '../store';
import CreateTableModal, { CreateTableConfig } from '../ui/CreateTableModal';
import ConnectWalletButton from '../ui/ConnectWalletButton';
import VoiceControls from '../ui/VoiceControls';
import CharacterGallery from '../ui/CharacterGallery';
import { useLobbyTables, LobbyTableSummary } from '../hooks/useLobbyTables';

export default function LobbyPage() {
  const startRound = useGameStore(state => state.startRound);
  const setGamePhase = useGameStore(state => state.setGamePhase);
  const selectedCharacter = useGameStore(state => state.character);
  const setSelectedCharacter = useGameStore(state => state.setCharacter);
  const voiceEnabled = useGameStore(state => state.isVoiceEnabled);
  const { tables, status, error, stats, refresh } = useLobbyTables();

  useEffect(() => {
    if (!voiceEnabled) return;

    voiceService.announceGameEvent('game.start').catch(console.error);
  }, [voiceEnabled]);

  const handleCreateTable = (config: CreateTableConfig) => {
    setGamePhase('starting');
    startRound();

    if (voiceEnabled) {
      voiceService.playSpeech(`Launching ${config.name}. Shuffle up!`).catch(console.error);
    }
  };

  const handleTableJoin = (table: LobbyTableSummary) => {
    setGamePhase('starting');

    if (voiceEnabled) {
      voiceService.playSpeech(`Joining ${table.name}. Good luck, trader!`).catch(console.error);
    }
  };

  const isLoading = status === 'loading';

  return (
    <main className="page" aria-labelledby="lobby-title">
      <header className="page__header">
        <div>
          <h1 id="lobby-title" className="page__title">
            🎰 Trading Game Lobby
          </h1>
          <p className="page__subtitle">
            Join an active table, or launch a new room and invite the market to your floor.
          </p>
          {stats && (
            <div className="page__actions" aria-live="polite">
              <span className="pill">Waiting tables: {stats.waiting}</span>
              <span className="pill">In play: {stats.playing}</span>
            </div>
          )}
        </div>
        <div className="page__actions">
          <Link to="/payments" className="button button--neutral">
            💰 Payments
          </Link>
          <button type="button" className="button button--ghost" onClick={refresh} disabled={isLoading}>
            🔄 Refresh
          </button>
          <ConnectWalletButton />
        </div>
      </header>

      <section aria-label="Character selection">
        <CharacterGallery
          selectedCharacter={selectedCharacter}
          onCharacterSelect={setSelectedCharacter}
          enableVoice={voiceEnabled}
        />
      </section>

      {error && (
        <div className="inline-notice inline-notice--error" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid--sidebar">
        <section className="card" aria-labelledby="open-tables-heading">
          <div className="section-heading">
            <h2 id="open-tables-heading">📊 Available tables</h2>
            <span>
              {isLoading ? 'Loading tables…' : `${tables.length} ${tables.length === 1 ? 'table' : 'tables'}`}
            </span>
          </div>

          {isLoading && (
            <div className="grid" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="card skeleton" style={{ height: 128 }} />
              ))}
            </div>
          )}

          {!isLoading && tables.length === 0 && (
            <div className="card card--gradient" role="status" aria-live="polite">
              <h3 className="card__title">No active tables yet</h3>
              <p className="card__subtitle">
                Be the first to launch a game and invite others to trade.
              </p>
              <CreateTableModal onCreate={handleCreateTable} />
            </div>
          )}

          {!isLoading && tables.length > 0 && (
            <ul className="list-reset" aria-live="polite">
              {tables.map((table) => (
                <li key={table.id} className="card card--interactive table-card">
                  <div className="table-card__meta">
                    <div>
                      <h3 className="card__title" style={{ marginBottom: 2 }}>
                        {table.name}
                      </h3>
                      <span>{table.stakes}</span>
                    </div>
                    <span className="tag">
                      Host: {table.host}
                    </span>
                  </div>

                  <div className="table-card__tags">
                    <span className={table.phase === 'playing' ? 'tag tag--accent' : 'tag tag--success'}>
                      {table.phase === 'playing' ? 'In progress' : 'Waiting for players'}
                    </span>
                    <span className="tag">
                      {table.players}/{table.capacity} seats
                    </span>
                    <span className="tag">
                      Avg turn {table.avgTurnSeconds}s
                    </span>
                    {table.tags.map(tag => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="table-card__footer">
                    <div>
                      <div className="progress-track" aria-hidden="true" style={{ width: 140 }}>
                        <div
                          className="progress-track__bar"
                          style={{ width: `${Math.min(100, (table.players / table.capacity) * 100)}%` }}
                        />
                      </div>
                      <small style={{ color: 'var(--text-secondary)' }}>
                        Created {new Date(table.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </small>
                    </div>

                    <Link
                      to={`/table/${table.id}`}
                      className="button button--primary"
                      onClick={() => handleTableJoin(table)}
                      aria-label={`Join ${table.name}`}
                    >
                      Join table
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="grid" aria-label="Control panel">
          <CreateTableModal onCreate={handleCreateTable} defaultVoiceEnabled={voiceEnabled} />
          <VoiceControls className="lobby-voice-controls" />
        </aside>
      </div>
    </main>
  );
}
