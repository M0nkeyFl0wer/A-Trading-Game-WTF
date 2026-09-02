import { authHeaders } from './devIdentity';

/**
 * REST helpers for the two-way quote mechanic (ask a named player for a
 * price, they answer bid/ask 2 apart, you hit or lift). Centralized here so
 * the request/respond/hit/lift fetch boilerplate isn't repeated across the
 * quote-panel components -- mirrors the inline fetch pattern OrderForm.tsx
 * uses for order submission.
 */

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function postQuote(path: string, token: string, body: Record<string, unknown> = {}): Promise<void> {
  const response = await fetch(`${API_BASE}/api/room/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || 'Quote request failed');
  }
}

export function requestQuote(roomId: string, targetId: string, token: string): Promise<void> {
  return postQuote(`${roomId}/quote/request`, token, { targetId });
}

export function respondToQuote(
  roomId: string,
  quoteId: string,
  bidPrice: number,
  askPrice: number,
  token: string,
): Promise<void> {
  return postQuote(`${roomId}/quote/${quoteId}/respond`, token, { bidPrice, askPrice });
}

export function hitQuote(roomId: string, quoteId: string, token: string): Promise<void> {
  return postQuote(`${roomId}/quote/${quoteId}/hit`, token);
}

export function liftQuote(roomId: string, quoteId: string, token: string): Promise<void> {
  return postQuote(`${roomId}/quote/${quoteId}/lift`, token);
}
