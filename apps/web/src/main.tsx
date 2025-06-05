import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WagmiConfig, createConfig, http } from 'wagmi';
import { createPublicClient } from 'viem';
import { hardhat } from 'viem/chains';
import LobbyPage from './pages/LobbyPage';
import TablePage from './pages/TablePage';
import './index.css';

const config = createConfig({
  publicClient: createPublicClient({ chain: hardhat, transport: http() })
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WagmiConfig config={config}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/table/:id" element={<TablePage />} />
        </Routes>
      </BrowserRouter>
    </WagmiConfig>
  </React.StrictMode>
);
