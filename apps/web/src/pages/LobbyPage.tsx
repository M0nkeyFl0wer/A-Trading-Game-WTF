import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameStore } from '../store';
import CreateTableModal from '../ui/CreateTableModal';
import ConnectWalletButton from '../ui/ConnectWalletButton';

export default function LobbyPage() {
  const startRound = useGameStore(s => s.startRound);
  const [tables, setTables] = useState<{id:number}[]>([]);

  useEffect(() => {
    // TODO: fetch tables via websocket
    setTables([]);
  }, []);

  return (
    <div className="lobby">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>Lobby</h1>
        <ConnectWalletButton />
      </header>
      <CreateTableModal onCreate={startRound} />
      <ul>
        {tables.map(t => (
          <li key={t.id}><Link to={`/table/${t.id}`}>Table {t.id}</Link></li>
        ))}
      </ul>
    </div>
  );
}
