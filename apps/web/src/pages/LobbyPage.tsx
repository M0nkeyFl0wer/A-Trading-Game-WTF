import { useCallback, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { voiceService } from '../lib/elevenlabs';
import { useGameStore } from '../store';
import CreateTableModal from '../ui/CreateTableModal';
import { type CreateTableConfig } from '../ui/CreateTableModal';
import ConnectWalletButton from '../ui/ConnectWalletButton';
import VoiceControls from '../ui/VoiceControls';
import CharacterGallery from '../ui/CharacterGallery';
import { useLobbyTables } from '../hooks/useLobbyTables';
import { type LobbyTableSummary } from '../hooks/useLobbyTables';
import { useAuth } from '../contexts/AuthContext';

export default function LobbyPage() {
  const setGamePhase = useGameStore(state => state.setGamePhase);
  const selectedCharacter = useGameStore(state => state.character);
  const setSelectedCharacter = useGameStore(state => state.setCharacter);
  const voiceEnabled = useGameStore(state => state.isVoiceEnabled);
  const { tables, status, error, stats, refresh } = useLobbyTables();
  const { currentUser } = useAuth();
  const isAuthenticated = Boolean(currentUser);
  const [actionError, setActionError] = useState<string | null>(null);
  const combinedError = actionError || error;
  const navigate = useNavigate();

  const requireAuthToken = useCallback(async (reason: string) => {
    if (!currentUser) {
      throw new Error(`Sign in to ${reason}.`);
    }
    return currentUser.getIdToken();
  }, [currentUser]);

  useEffect(() => {
    if (!voiceEnabled) return;

    voiceService.announceGameEvent('game.start').catch(console.error);
  }, [voiceEnabled]);

  const handleCreateTable = useCallback(async (config: CreateTableConfig) => {
    setGamePhase('starting');
    try {
      const token = await requireAuthToken('create a table');
      const response = await fetch('/api/room/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: config.name,
          maxPlayers: Math.max(2, Math.min(8, config.rounds || 5)),
          displayName: currentUser?.displayName || 'Trader',
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to create table');
      }

      await refresh();
      setGamePhase('waiting');

      if (voiceEnabled) {
        voiceService.playSpeech(`Launching ${config.name}. Shuffle up!`).catch(console.error);
      }

      const newRoomId = payload?.room?.id;
      if (newRoomId) {
        navigate(`/table/${newRoomId}`);
      }
    } catch (err) {
      setGamePhase('idle');
      throw err;
    }
  }, [currentUser?.displayName, navigate, refresh, requireAuthToken, setGamePhase, voiceEnabled]);

  const handleTableJoin = useCallback(async (table: LobbyTableSummary, event?: MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    try {
      setActionError(null);
      setGamePhase('starting');
      const token = await requireAuthToken('join a table');
      const response = await fetch(`/api/room/join/${table.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to join table');
      }

      await refresh();
      setGamePhase('waiting');

      if (voiceEnabled) {
        voiceService.playSpeech(`Joining ${table.name}. Good luck, trader!`).catch(console.error);
      }
      navigate(`/table/${table.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to join table';
      setActionError(message);
      console.error('Join table failed', err);
      setGamePhase('idle');
    }
  }, [navigate, refresh, requireAuthToken, setGamePhase, voiceEnabled]);

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

      {!isAuthenticated && (
        <div className="inline-notice inline-notice--info" role="alert" style={{ marginBottom: 16 }}>
          Sign in to create or join live tables. Preview data shown.
        </div>
      )}

      {combinedError && (
        <div className="inline-notice inline-notice--error" role="alert">
          {combinedError}
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
              <CreateTableModal
                onCreate={handleCreateTable}
                disabled={!isAuthenticated}
                disabledMessage="Sign in to create a table"
              />
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

                    <button
                      type="button"
                      className="button button--primary"
                      onClick={(event) => handleTableJoin(table, event)}
                      aria-label={`Join ${table.name}`}
                      disabled={!isAuthenticated}
                      aria-disabled={!isAuthenticated}
                      title={!isAuthenticated ? 'Sign in to join tables' : undefined}
                    >
                      Join table
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="grid" aria-label="Control panel">
          <CreateTableModal
            onCreate={handleCreateTable}
            defaultVoiceEnabled={voiceEnabled}
            disabled={!isAuthenticated}
            disabledMessage="Sign in to create a table"
          />
          <VoiceControls className="lobby-voice-controls" />
        </aside>
      </div>
    </main>
  );
}
