import { useMemo, useState } from 'react';
import { sanitizeInput } from '../lib/security';
import ConnectWalletButton from '../ui/ConnectWalletButton';

interface PaymentMethod {
  id: 'wallet' | 'card' | 'bank';
  title: string;
  icon: string;
  description: string;
  status: 'available' | 'coming-soon';
  eta?: string;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'wallet',
    title: 'Crypto wallet',
    icon: '🪙',
    description: 'Deposit USDC or ETH using your connected wallet.',
    status: 'available',
  },
  {
    id: 'card',
    title: 'Credit / debit card',
    icon: '💳',
    description: 'Charge cards through Stripe or Circle for instant settlement.',
    status: 'coming-soon',
    eta: 'Targeting Q4 beta',
  },
  {
    id: 'bank',
    title: 'Bank transfer (ACH)',
    icon: '🏦',
    description: 'Link a verified bank account for larger deposits.',
    status: 'coming-soon',
    eta: 'Pending SOC2 + KYC vendor sign-off',
  },
];

export default function PaymentsPage() {
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod['id']>('wallet');
  const [depositAmount, setDepositAmount] = useState('100');
  const [withdrawAmount, setWithdrawAmount] = useState('50');
  const [selectedNetwork, setSelectedNetwork] = useState('Base');
  const [asset, setAsset] = useState('USDC');

  const method = useMemo(
    () => PAYMENT_METHODS.find(item => item.id === selectedMethod) ?? PAYMENT_METHODS[0],
    [selectedMethod]
  );

  const handleAmountChange = (value: string, setValue: (next: string) => void) => {
    const cleaned = sanitizeInput(value).replace(/[^0-9.]/g, '');
    setValue(cleaned);
  };

  const renderMethodDetails = () => {
    switch (method.id) {
      case 'wallet':
        return (
          <>
            <p className="card__subtitle">
              Connect a wallet, select the asset you want to deposit, and confirm the transaction in your wallet
              provider. Funds settle into the house escrow contract instantly.
            </p>
            <div className="form-grid">
              <label htmlFor="deposit-asset">
                Asset
                <select
                  id="deposit-asset"
                  value={asset}
                  onChange={(event) => setAsset(event.target.value)}
                >
                  <option value="USDC">USDC</option>
                  <option value="ETH">ETH</option>
                  <option value="DAI">DAI</option>
                </select>
              </label>

              <label htmlFor="deposit-network">
                Network
                <select
                  id="deposit-network"
                  value={selectedNetwork}
                  onChange={(event) => setSelectedNetwork(event.target.value)}
                >
                  <option value="Base">Base</option>
                  <option value="Arbitrum">Arbitrum</option>
                  <option value="Polygon">Polygon</option>
                </select>
              </label>

              <label htmlFor="deposit-amount">
                Deposit amount
                <input
                  id="deposit-amount"
                  type="text"
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(event) => handleAmountChange(event.target.value, setDepositAmount)}
                />
              </label>

              <label htmlFor="withdraw-amount">
                Withdraw amount
                <input
                  id="withdraw-amount"
                  type="text"
                  inputMode="decimal"
                  value={withdrawAmount}
                  onChange={(event) => handleAmountChange(event.target.value, setWithdrawAmount)}
                />
              </label>
            </div>

            <div className="inline-notice" role="status">
              Smart contract escrow uses the pull-payment pattern. Withdrawals queue until the on-chain settlement
              job confirms balances. Estimated finality: &lt; 90 seconds on {selectedNetwork}.
            </div>

            <div className="page__actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button button--ghost" disabled>
                Preview withdrawal
              </button>
              <button type="button" className="button button--primary" disabled>
                Initiate deposit
              </button>
            </div>
          </>
        );

      case 'card':
        return (
          <>
            <p className="card__subtitle">
              Card processing will integrate with Stripe Treasury for PCI compliance. We collect the billing intent
              here and hand off to Stripe Elements for the secure form.
            </p>
            <div className="inline-notice">
              This flow is scaffold-only. Replace with Stripe Elements + Payment Intents API when credentials are
              available.
            </div>
            <div className="form-grid">
              <label>
                Cardholder name
                <input type="text" placeholder="Ada Lovelace" disabled />
              </label>
              <label>
                Email for receipt
                <input type="email" placeholder="ada@example.com" disabled />
              </label>
              <label>
                Amount (USD)
                <input type="number" min={25} placeholder="250" disabled />
              </label>
            </div>
            <div className="page__actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button button--primary" disabled>
                Launch Stripe checkout
              </button>
            </div>
          </>
        );

      case 'bank':
        return (
          <>
            <p className="card__subtitle">
              Bank transfers require KYC verification and Plaid (or similar) account linking. ACH deposits clear in
              3-5 business days; instant limits unlock after trust score checks.
            </p>
            <div className="form-grid">
              <label>
                Business name
                <input type="text" placeholder="Trading Game LLC" disabled />
              </label>
              <label>
                Tax / EIN
                <input type="text" placeholder="12-3456789" disabled />
              </label>
              <label>
                Requested limit
                <input type="number" min={1000} placeholder="25000" disabled />
              </label>
            </div>
            <div className="page__actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="button button--primary" disabled>
                Schedule onboarding call
              </button>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <main className="page" aria-labelledby="payments-title">
      <header className="page__header">
        <div>
          <h1 id="payments-title" className="page__title">💰 Payment portal</h1>
          <p className="page__subtitle">
            Configure funding flows, preview compliance requirements, and connect external payment providers.
          </p>
        </div>
        <div className="page__actions">
          <ConnectWalletButton />
        </div>
      </header>

      <div className="grid grid--sidebar" style={{ alignItems: 'flex-start' }}>
        <div className="grid" style={{ gap: 20 }}>
          <section className="card" aria-label="Select a payment method">
            <div className="section-heading">
              <h2>Payment rails</h2>
              <span>Choose a funding option</span>
            </div>

            <div className="grid" style={{ gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {PAYMENT_METHODS.map(item => {
                const isActive = item.id === method.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`card ${isActive ? 'card--gradient' : ''}`}
                    style={{
                      textAlign: 'left',
                      borderColor: isActive ? 'rgba(129,140,248,0.45)' : 'rgba(148,163,184,0.2)',
                    }}
                    onClick={() => setSelectedMethod(item.id)}
                    aria-pressed={isActive}
                  >
                    <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>{item.icon}</div>
                    <strong style={{ display: 'block', marginBottom: 4 }}>{item.title}</strong>
                    <small style={{ display: 'block', color: 'var(--text-secondary)' }}>{item.description}</small>
                    {item.status === 'coming-soon' && (
                      <span className="tag" style={{ marginTop: 10 }}>
                        Coming soon{item.eta ? ` · ${item.eta}` : ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card" aria-live="polite">
            <div className="section-heading">
              <h2>Setup: {method.icon} {method.title}</h2>
              <span>{method.status === 'available' ? 'Sandbox prototype' : 'Pending integration'}</span>
            </div>
            {renderMethodDetails()}
          </section>

          <section className="card">
            <div className="section-heading">
              <h2>Integration checklist</h2>
              <span>Engineering + compliance</span>
            </div>
            <ul className="list-reset" style={{ display: 'grid', gap: 12 }}>
              <li className="inline-notice">
                ✅ Implement pull-payment escrow pattern in smart contract (in progress).
              </li>
              <li className="inline-notice">
                ⚙️ Configure webhook listener for provider settlement events.
              </li>
              <li className="inline-notice">
                🔐 Store provider secrets in managed vault (e.g., Doppler, AWS SM).
              </li>
              <li className="inline-notice">
                🧾 Capture KYC documents and risk scores before enabling fiat ramps.
              </li>
            </ul>
          </section>
        </div>

        <aside className="grid" style={{ gap: 20 }} aria-label="Compliance & audit">
          <section className="card">
            <div className="section-heading">
              <h3>Risk & compliance</h3>
              <span>High level</span>
            </div>
            <ul className="list-reset" style={{ display: 'grid', gap: 10 }}>
              <li className="tag">
                ✅ Travel Rule: enforce originator / beneficiary data for transfers &gt; $3k USD.
              </li>
              <li className="tag">
                ✅ AML: integrate with Chainalysis or TRM for wallet screening.
              </li>
              <li className="tag">
                ⚠️ Card: requires PCI-DSS SAQ A and PAN tokenization.
              </li>
              <li className="tag">
                ⚠️ Bank: SOC2 + NACHA compliance before production go-live.
              </li>
            </ul>
          </section>

          <section className="card">
            <div className="section-heading">
              <h3>Audit log</h3>
              <span>Recent actions</span>
            </div>
            <p className="card__subtitle">
              Logging stitches into the security middleware. Persist these events to the analytics warehouse so the risk
              team can reconcile payouts.
            </p>
            <ul className="list-reset" style={{ display: 'grid', gap: 8 }}>
              <li className="tag">[09:12] Wallet connect request (MetaMask, 0xA1…91)</li>
              <li className="tag">[09:09] Compliance bot flagged payout &gt; $10k for manual review</li>
              <li className="tag">[08:57] Sandbox deposit simulated (USDC, $1,000)</li>
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
