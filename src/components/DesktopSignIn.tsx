import { FormEvent, useEffect, useState } from 'react';
import { APP_LOGO_SRC } from '../lib/appBrand';
import {
  completeDesktopOAuthCallback,
  getAuthSnapshot,
  isSupabaseConfigured,
  onAuthChange,
  requestEmailOtp,
  signInWithOAuthProvider,
  verifyEmailOtp,
  type OAuthProvider,
} from '../lib/supabaseClient';

const SKIP_KEY = 'mockup-studio.desktop-signin-skip';

export function shouldShowDesktopSignIn(): boolean {
  if (typeof window === 'undefined' || !window.mockupDesktop) return false;
  if (!isSupabaseConfigured()) return false;
  try {
    if (sessionStorage.getItem(SKIP_KEY) === '1') return false;
  } catch {
    // continue
  }
  return true;
}

export function DesktopSignIn({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [mode, setMode] = useState<'welcome' | 'code'>('welcome');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = () => {
    onComplete();
  };

  const skipOffline = () => {
    try {
      sessionStorage.setItem(SKIP_KEY, '1');
    } catch {
      // Private mode — still continue for this load.
    }
    finish();
  };

  useEffect(() => {
    let cancelled = false;

    const handleCallback = async (url: string) => {
      if (cancelled || !url) return;
      setBusy(true);
      setError('');
      setStatus('Finishing browser sign-in…');
      const result = await completeDesktopOAuthCallback(url);
      if (cancelled) return;
      setBusy(false);
      if (!result.ok) {
        setStatus('');
        setError(result.error);
        return;
      }
      finish();
    };

    void getAuthSnapshot().then((snap) => {
      if (!cancelled && snap.user) finish();
    });

    const unsubAuth = onAuthChange((snap) => {
      if (!cancelled && snap.user) finish();
    });

    const unsubCallback = window.mockupDesktop?.onAuthCallback?.((url) => {
      void handleCallback(url);
    });

    void window.mockupDesktop?.takePendingAuthCallback?.().then((url) => {
      if (url) void handleCallback(url);
    });

    return () => {
      cancelled = true;
      unsubAuth();
      unsubCallback?.();
    };
  }, []);

  async function startOAuth(provider: OAuthProvider) {
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    const result = await signInWithOAuthProvider(provider);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    if (result.desktopBrowser) {
      setBusy(false);
      setStatus('Continue in your browser, then return here.');
      return;
    }
    // Web navigates away; keep busy state.
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    const result = await requestEmailOtp(email, { createUser: true });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMode('code');
    setStatus('Check your email for a one-time code.');
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await verifyEmailOtp(email, code);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    finish();
  }

  return (
    <div className="desktop-signin">
      <div className="desktop-signin-card">
        <img className="desktop-signin-logo" src={APP_LOGO_SRC} alt="" width={56} height={56} />
        <h1>Welcome to mokstudio</h1>
        <p className="desktop-signin-sub">
          Sign in so projects and your license sync between the Mac app and the web app.
        </p>

        {mode === 'welcome' ? (
          <>
            <button
              type="button"
              className="desktop-signin-oauth is-google"
              disabled={busy}
              onClick={() => void startOAuth('google')}
            >
              <GoogleMark />
              Continue with Google
            </button>
            <button
              type="button"
              className="desktop-signin-oauth is-apple"
              disabled={busy}
              onClick={() => void startOAuth('apple')}
            >
              <AppleMark />
              Continue with Apple
            </button>

            <p className="desktop-signin-divider" aria-hidden="true">or</p>

            <form className="desktop-signin-form" onSubmit={sendCode}>
              <label className="desktop-signin-field">
                <span>Email</span>
                <input
                  type="email"
                  name="studio-email"
                  autoComplete="email"
                  autoFocus
                  placeholder="Email"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <button type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Continue with email'}
              </button>
            </form>
          </>
        ) : (
          <form className="desktop-signin-form" onSubmit={verifyCode}>
            <label className="desktop-signin-field">
              <span>Email</span>
              <input type="email" value={email} disabled readOnly />
            </label>
            <label className="desktop-signin-field">
              <span>Code</span>
              <input
                type="text"
                name="studio-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456"
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || !code.trim()}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="desktop-signin-text-btn"
              disabled={busy}
              onClick={() => {
                setMode('welcome');
                setCode('');
                setError('');
                setStatus('');
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        {status ? <p className="desktop-signin-status">{status}</p> : null}
        {error ? <p className="desktop-signin-error" role="alert">{error}</p> : null}

        <button type="button" className="desktop-signin-skip" disabled={busy} onClick={skipOffline}>
          Continue offline
        </button>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14.7 9.5c-.02-2.1 1.72-3.11 1.8-3.16-1-.1.4-2.5-.1-3.5-.8-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.9-.8-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.1 1.7 2.4 3 2.3 1.2-.05 1.6-.75 3.1-.75s1.8.75 3.1.7c1.3-.05 2.1-1.1 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.05-.05-2.5-1-2.5-3.8ZM12.1.9c.6-.8 1.1-1.9 1-3C12 .9 10.8 1.5 10.1 2.3c-.6.7-1.2 1.9-1 3 1.1.1 2.3-.5 3-1.4Z"
      />
    </svg>
  );
}
