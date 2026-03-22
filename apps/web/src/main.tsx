import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import LobbyPage from './pages/LobbyPage';
import TablePage from './pages/TablePage';
import PaymentsPage from './pages/PaymentsPage';
import './index.css';

function NotFoundPage() {
  return (
    <main className="page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
      <h1 className="page__title">404 - Page not found</h1>
      <p className="page__subtitle" style={{ marginBottom: '1.5rem' }}>
        The page you are looking for does not exist or has been moved.
      </p>
      <Link to="/" className="button button--primary">
        Back to Lobby
      </Link>
    </main>
  );
}

// Create wagmi config with mainnet for now (no wallet needed for testing)
const config = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
});

// Create query client for wagmi v2
const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LobbyPage />} />
              <Route path="/table/:id" element={<TablePage />} />
              <Route path="/payments" element={<PaymentsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
