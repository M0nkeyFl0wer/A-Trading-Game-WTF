import { useMemo, useState } from 'react';
import type { Order } from '@trading-game/shared';
import { useGameStore } from '../store';
import { useAuth } from '../contexts/AuthContext';

interface AggregatedLevel {
  price: number;
  totalQty: number;
  orderIds: string[];
  hasMine: boolean;
}

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function aggregateOrders(orders: Order[], side: 'bid' | 'ask'): AggregatedLevel[] {
  const open = orders.filter((o) => o.side === side && (o.status === 'open' || o.status === 'partial'));
  const byPrice = new Map<number, AggregatedLevel>();

  for (const order of open) {
    const remaining = order.quantity - order.filledQuantity;
    const isMine = Boolean((order as any).isMine);
    const existing = byPrice.get(order.price);
    if (existing) {
      existing.totalQty += remaining;
      existing.orderIds.push(order.id);
      if (isMine) existing.hasMine = true;
    } else {
      byPrice.set(order.price, {
        price: order.price,
        totalQty: remaining,
        orderIds: [order.id],
        hasMine: isMine,
      });
    }
  }

  const levels = Array.from(byPrice.values());
  if (side === 'bid') {
    levels.sort((a, b) => b.price - a.price);
  } else {
    levels.sort((a, b) => a.price - b.price);
  }
  return levels;
}

interface OrderBookDisplayProps {
  roomId: string;
}

export default function OrderBookDisplay({ roomId }: OrderBookDisplayProps) {
  const orders = useGameStore((state) => state.orders);
  const matchedTrades = useGameStore((state) => state.matchedTrades);
  const { currentUser } = useAuth();
  const [cancelling, setCancelling] = useState<string | null>(null);

  const bids = useMemo(() => aggregateOrders(orders, 'bid'), [orders]);
  const asks = useMemo(() => aggregateOrders(orders, 'ask'), [orders]);

  const bestBid = bids.length > 0 ? bids[0].price : null;
  const bestAsk = asks.length > 0 ? asks[0].price : null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const lastTrade = matchedTrades.length > 0 ? matchedTrades[matchedTrades.length - 1] : null;

  const maxQty = useMemo(() => {
    const allQtys = [...bids, ...asks].map((l) => l.totalQty);
    return Math.max(1, ...allQtys);
  }, [bids, asks]);

  const handleCancel = async (orderId: string) => {
    if (!currentUser) return;
    setCancelling(orderId);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_BASE}/api/room/${roomId}/order/${orderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.error('Cancel failed:', payload?.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Cancel order failed', err);
    } finally {
      setCancelling(null);
    }
  };

  // Find own open orders for cancel buttons
  const myOpenOrders = useMemo(
    () => orders.filter((o) => (o as any).isMine && (o.status === 'open' || o.status === 'partial')),
    [orders],
  );

  const renderLevel = (level: AggregatedLevel, side: 'bid' | 'ask') => {
    const barWidth = Math.max(5, (level.totalQty / maxQty) * 100);
    const color = side === 'bid' ? '#22c55e' : '#ef4444';
    const bgColor = side === 'bid' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)';

    return (
      <div
        key={`${side}-${level.price}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          borderRadius: 4,
          background: level.hasMine ? (side === 'bid' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)') : 'transparent',
          borderLeft: level.hasMine ? `3px solid ${color}` : '3px solid transparent',
          fontSize: '0.85rem',
          fontFamily: 'monospace',
        }}
      >
        <span style={{ color, fontWeight: 600, minWidth: 52, textAlign: 'right' }}>
          {level.price.toFixed(1)}
        </span>
        <span style={{ color: 'var(--text-secondary)', minWidth: 28, textAlign: 'right' }}>
          x{level.totalQty}
        </span>
        <div style={{ flex: 1, height: 12, borderRadius: 2, overflow: 'hidden', background: 'rgba(148,163,184,0.1)' }}>
          <div
            style={{
              width: `${barWidth}%`,
              height: '100%',
              background: bgColor,
              borderRadius: 2,
              float: side === 'bid' ? 'right' : 'left',
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <section className="card" aria-label="Order book">
      <div className="section-heading">
        <h3>Order Book</h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {orders.filter((o) => o.status === 'open' || o.status === 'partial').length} open
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
        {/* Bids */}
        <div>
          <div style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#22c55e',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 6,
            paddingBottom: 4,
            borderBottom: '1px solid rgba(34,197,94,0.2)',
          }}>
            Bids
          </div>
          {bids.length === 0 ? (
            <div className="empty-state" style={{ padding: '12px 0' }}>
              <div className="empty-state__icon">--</div>
              <div style={{ fontSize: '0.78rem' }}>No bids yet -- be the first!</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {bids.slice(0, 8).map((level) => renderLevel(level, 'bid'))}
            </div>
          )}
        </div>

        {/* Asks */}
        <div>
          <div style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#ef4444',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 6,
            paddingBottom: 4,
            borderBottom: '1px solid rgba(239,68,68,0.2)',
          }}>
            Asks
          </div>
          {asks.length === 0 ? (
            <div className="empty-state" style={{ padding: '12px 0' }}>
              <div className="empty-state__icon">--</div>
              <div style={{ fontSize: '0.78rem' }}>No asks yet -- place one!</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {asks.slice(0, 8).map((level) => renderLevel(level, 'ask'))}
            </div>
          )}
        </div>
      </div>

      {/* Summary row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'rgba(15, 23, 42, 0.55)',
          borderRadius: 8,
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          fontFamily: 'monospace',
        }}
      >
        <span>
          Spread: {spread != null ? spread.toFixed(1) : '--'}
        </span>
        <span>
          Last: {lastTrade ? lastTrade.price.toFixed(1) : '--'}
        </span>
      </div>

      {/* Own open orders */}
      {myOpenOrders.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 6,
          }}>
            Your Open Orders
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {myOpenOrders.map((order) => (
              <div
                key={order.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: 'rgba(15, 23, 42, 0.4)',
                  borderRadius: 6,
                  fontSize: '0.82rem',
                }}
              >
                <span style={{
                  color: order.side === 'bid' ? '#22c55e' : '#ef4444',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}>
                  {order.side}
                </span>
                <span style={{ fontFamily: 'monospace' }}>
                  {order.quantity - order.filledQuantity}x @ {order.price.toFixed(1)}
                </span>
                <button
                  type="button"
                  onClick={() => handleCancel(order.id)}
                  disabled={cancelling === order.id}
                  style={{
                    padding: '2px 8px',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: 4,
                    background: 'transparent',
                    color: '#ef4444',
                    fontSize: '0.75rem',
                    cursor: cancelling === order.id ? 'not-allowed' : 'pointer',
                    opacity: cancelling === order.id ? 0.5 : 1,
                  }}
                >
                  {cancelling === order.id ? '...' : 'Cancel'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
