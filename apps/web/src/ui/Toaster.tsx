import { useEffect, useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

let nextId = 1;
let externalPush: ((t: Toast) => void) | null = null;

/**
 * Show a toast from anywhere in the app.
 * Call this imperatively — no hook needed at the call site.
 */
export function showToast(message: string, type: ToastType = 'info') {
  if (externalPush) {
    externalPush({ id: nextId++, message, type });
  }
}

const TOAST_DURATION_MS = 4000;

const typeStyles: Record<ToastType, React.CSSProperties> = {
  success: { borderLeft: '4px solid #22c55e', background: 'rgba(34,197,94,0.12)' },
  error: { borderLeft: '4px solid #ef4444', background: 'rgba(239,68,68,0.12)' },
  info: { borderLeft: '4px solid #6366f1', background: 'rgba(99,102,241,0.12)' },
};

/**
 * Render this once at the root of your app (e.g. in main.tsx or TablePage).
 */
export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, NodeJS.Timeout>>(new Map());

  const push = useCallback((t: Toast) => {
    setToasts((prev) => [...prev.slice(-4), t]); // keep max 5
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== t.id));
      timers.current.delete(t.id);
    }, TOAST_DURATION_MS);
    timers.current.set(t.id, timer);
  }, []);

  // Register the global push function
  useEffect(() => {
    externalPush = push;
    return () => {
      externalPush = null;
    };
  }, [push]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 9999,
        maxWidth: 360,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            color: 'var(--text-primary, #e2e8f0)',
            fontSize: '0.9rem',
            backdropFilter: 'blur(8px)',
            ...typeStyles[t.type],
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
