import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { InjectedConnector } from 'wagmi/connectors/injected';

export default function ConnectWalletButton() {
  const { address } = useAccount();
  const { connect } = useConnect({ connector: new InjectedConnector() });
  const { disconnect } = useDisconnect();
  if (address) return <button onClick={() => disconnect()}>Disconnect {address.slice(0,6)}</button>;
  return <button onClick={() => connect()}>Connect Wallet</button>;
}
