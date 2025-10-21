import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';

export default function ConnectWalletButton() {
  const { address, status } = useAccount();
  const { connectAsync, isLoading } = useConnect();
  const { disconnectAsync } = useDisconnect();

  const handleConnect = async () => {
    try {
      await connectAsync({ connector: injected() });
    } catch (error) {
      console.error('Wallet connection failed', error);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectAsync();
    } catch (error) {
      console.error('Wallet disconnect failed', error);
    }
  };

  if (address) {
    return (
      <button
        type="button"
        className="button button--ghost"
        onClick={handleDisconnect}
        aria-label={`Disconnect wallet ${address}`}
      >
        🔌 Disconnect {address.slice(0, 6)}…
      </button>
    );
  }

  const isConnecting = status === 'connecting' || isLoading;

  return (
    <button
      type="button"
      className="button button--primary"
      onClick={handleConnect}
      disabled={isConnecting}
      aria-label="Connect your wallet"
    >
      {isConnecting ? 'Connecting…' : '🔗 Connect wallet'}
    </button>
  );
}
