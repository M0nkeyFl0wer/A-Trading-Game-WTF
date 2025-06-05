import { useParams } from 'react-router-dom';
import QuoteModal from '../ui/QuoteModal';
import TradeTape from '../ui/TradeTape';
import TimerBar from '../ui/TimerBar';
import SeatAvatars from '../ui/SeatAvatars';
import ConnectWalletButton from '../ui/ConnectWalletButton';
import { useBotAI } from '../hooks/useBotAI';

export default function TablePage() {
  const { id } = useParams();
  useBotAI();
  return (
    <div className="table">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>Table {id}</h1>
        <ConnectWalletButton />
      </header>
      <SeatAvatars />
      <TimerBar seconds={120} />
      <div className="card-area">
        {/* private card shows after flip */}
      </div>
      <QuoteModal />
      <TradeTape />
    </div>
  );
}
