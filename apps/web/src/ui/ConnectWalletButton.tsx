import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';

export default function ConnectWalletButton() {
  const { address } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  if (address) return <button onClick={() => disconnect()}>Disconnect {address.slice(0,6)}</button>;
  return <button onClick={() => connect({ connector: injected() })}>Connect Wallet</button>;
}
