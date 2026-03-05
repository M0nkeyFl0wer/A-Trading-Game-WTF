import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

type AuthTab = 'login' | 'signup';

interface SignInModalProps {
  className?: string;
}

export default function SignInModal({ className = '' }: SignInModalProps) {
  const { currentUser, login, signup, loginWithGoogle, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AuthTab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (currentUser) {
    return (
      <div className={`page__actions ${className}`}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {currentUser.displayName || currentUser.email}
        </span>
        <button type="button" className="button button--ghost" onClick={() => logout()}>
          Sign out
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (tab === 'signup') {
        await signup(email, password, displayName || undefined);
      } else {
        await login(email, password);
      }
      setOpen(false);
      setEmail('');
      setPassword('');
      setDisplayName('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      setError(msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim());
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    try {
      await loginWithGoogle();
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed';
      setError(msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim());
    }
  };

  return (
    <div className={className}>
      <button type="button" className="button button--primary" onClick={() => setOpen(true)}>
        Sign in
      </button>

      {open && (
        <div className="modal-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="section-heading" style={{ marginBottom: 16 }}>
              <h2 id="auth-modal-title" style={{ margin: 0 }}>
                {tab === 'login' ? 'Welcome back' : 'Create account'}
              </h2>
              <button type="button" className="button button--ghost" onClick={() => setOpen(false)}>
                ✕
              </button>
            </header>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                type="button"
                className={`button ${tab === 'login' ? 'button--primary' : 'button--ghost'}`}
                onClick={() => { setTab('login'); setError(null); }}
                style={{ flex: 1 }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`button ${tab === 'signup' ? 'button--primary' : 'button--ghost'}`}
                onClick={() => { setTab('signup'); setError(null); }}
                style={{ flex: 1 }}
              >
                Sign up
              </button>
            </div>

            <form className="form-grid" onSubmit={handleSubmit}>
              {tab === 'signup' && (
                <label htmlFor="auth-name">
                  Display name
                  <input
                    id="auth-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Trader nickname"
                    autoComplete="name"
                  />
                </label>
              )}

              <label htmlFor="auth-email">
                Email
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </label>

              <label htmlFor="auth-password">
                Password
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  required
                  minLength={6}
                  autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                />
              </label>

              {error && (
                <div className="inline-notice inline-notice--error" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="button button--primary button--block"
                disabled={submitting}
              >
                {submitting
                  ? 'Loading...'
                  : tab === 'login'
                  ? 'Sign in'
                  : 'Create account'}
              </button>

              <div style={{ position: 'relative', textAlign: 'center', margin: '4px 0' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>or</span>
              </div>

              <button
                type="button"
                className="button button--ghost button--block"
                onClick={handleGoogle}
              >
                Continue with Google
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
