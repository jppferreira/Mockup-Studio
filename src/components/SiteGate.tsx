import { FormEvent, useEffect, useState } from 'react';
import {
  getAuthSnapshot,
  getSupabase,
  isSupabaseConfigured,
  onAuthChange,
  requestEmailOtp,
  signInWithOAuthProvider,
  verifyEmailOtp,
  type OAuthProvider,
} from '../lib/supabaseClient';

const STORAGE_KEY = 'mockup-studio.site-gate';

type GateMode = 'signup' | 'signin' | 'password';

export function webGateEnabled(): boolean {
  return typeof window !== 'undefined'
    && !window.mockupDesktop
    && Boolean(__SITE_GATE_SHA256__);
}

export function isSiteUnlocked(): boolean {
  if (!webGateEnabled()) return true;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markUnlocked() {
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Private mode can block storage. The gate still opens for this load.
  }
}

function oauthCallbackPending(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.hash.includes('access_token')) return true;
  const params = new URLSearchParams(window.location.search);
  return params.has('code') || params.has('error') || params.has('error_description');
}

function clearOAuthParamsFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.hash = '';
  ['code', 'error', 'error_description', 'state'].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function SiteGate({ onUnlock }: { onUnlock: () => void }) {
  const accountEnabled = isSupabaseConfigured();
  const [mode, setMode] = useState<GateMode>(accountEnabled ? 'signup' : 'password');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [finishingOAuth, setFinishingOAuth] = useState(() => accountEnabled && oauthCallbackPending());

  const unlock = () => {
    markUnlocked();
    clearOAuthParamsFromUrl();
    onUnlock();
  };

  useEffect(() => {
    if (!accountEnabled) return undefined;
    let cancelled = false;
    const finishIfSignedIn = async () => {
      const snap = await getAuthSnapshot();
      if (cancelled || !snap.user) return false;
      unlock();
      return true;
    };

    void finishIfSignedIn().then((done) => {
      if (!done && oauthCallbackPending()) setFinishingOAuth(true);
    });

    // Supabase parses ?code= / #access_token= asynchronously after createClient.
    const unsub = onAuthChange((snap) => {
      if (cancelled || !snap.user) return;
      unlock();
    });

    const sb = getSupabase();
    const pending = oauthCallbackPending();
    if (pending && sb) {
      setFinishingOAuth(true);
      const params = new URLSearchParams(window.location.search);
      const oauthError = params.get('error_description') || params.get('error');
      if (oauthError) {
        setFinishingOAuth(false);
        setError(oauthError);
        clearOAuthParamsFromUrl();
      } else {
        // Give PKCE / hash detection a moment, then surface a clear failure.
        window.setTimeout(() => {
          if (cancelled) return;
          void finishIfSignedIn().then((done) => {
            if (done || cancelled) return;
            setFinishingOAuth(false);
            setError('Google sign-in did not finish. Try again, or use email.');
            clearOAuthParamsFromUrl();
          });
        }, 4000);
      }
    }

    return () => {
      cancelled = true;
      unsub();
    };
  }, [accountEnabled, onUnlock]);

  useEffect(() => {
    setError('');
    setPhase('email');
    setCode('');
  }, [mode]);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const entered = new FormData(event.currentTarget).get('studio-gate');
    const attempt = String(entered ?? password).trim();
    setBusy(true);
    setError('');
    try {
      if (!attempt) {
        setError('Enter the password');
        return;
      }
      const hash = await sha256(attempt);
      if (!hashesMatch(hash, __SITE_GATE_SHA256__)) {
        setError('Wrong password');
        return;
      }
      unlock();
    } catch {
      setError('Could not check that. Click Enter again.');
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await requestEmailOtp(email, { createUser: mode === 'signup' });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPhase('code');
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
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
    unlock();
  }

  async function startOAuth(provider: OAuthProvider) {
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await signInWithOAuthProvider(provider);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
    }
    // On success the browser navigates away to the provider.
  }

  const modeCopy =
    mode === 'signup'
      ? 'Create a free account with Google, Apple, or email. No studio password needed.'
      : mode === 'signin'
        ? 'Sign in with Google, Apple, or a one-time email code.'
        : 'Enter the beta password to open the studio.';

  if (finishingOAuth) {
    return (
      <div className="site-gate">
        <div className="site-gate-card">
          <div className="site-gate-brand">
            <img className="site-gate-logo" src="./splash/logo.png" alt="" width={72} height={72} />
            <div className="site-gate-title">
              <h1>mokstudio</h1>
              <span className="dash-beta-badge" aria-label="Beta">Beta</span>
            </div>
          </div>
          <p>Finishing Google sign-in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="site-gate">
      <div className="site-gate-card">
        <div className="site-gate-brand">
          <img className="site-gate-logo" src="./splash/logo.png" alt="" width={72} height={72} />
          <div className="site-gate-title">
            <h1>mokstudio</h1>
            <span className="dash-beta-badge" aria-label="Beta">Beta</span>
          </div>
        </div>

        {accountEnabled && (
          <div className="site-gate-modes" role="tablist" aria-label="How to open the studio">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'is-active' : undefined}
              onClick={() => setMode('signup')}
            >
              Sign up
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              className={mode === 'signin' ? 'is-active' : undefined}
              onClick={() => setMode('signin')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'password'}
              className={mode === 'password' ? 'is-active' : undefined}
              onClick={() => setMode('password')}
            >
              Password
            </button>
          </div>
        )}

        <p>{modeCopy}</p>

        {mode === 'password' ? (
          <form onSubmit={submitPassword}>
            <input
              type="password"
              name="studio-gate"
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="site-gate-error" role="alert">{error}</p>
            <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Enter'}</button>
          </form>
        ) : (
          <>
            {phase === 'email' && (
              <div className="site-gate-oauth">
                <button
                  type="button"
                  className="site-gate-oauth-btn is-google"
                  disabled={busy}
                  onClick={() => void startOAuth('google')}
                >
                  <GoogleMark />
                  Continue with Google
                </button>
                <button
                  type="button"
                  className="site-gate-oauth-btn is-apple"
                  disabled={busy}
                  onClick={() => void startOAuth('apple')}
                >
                  <AppleMark />
                  Continue with Apple
                </button>
                <p className="site-gate-divider" aria-hidden="true">or email</p>
              </div>
            )}
            {phase === 'email' ? (
              <form onSubmit={sendCode}>
                <input
                  type="email"
                  name="studio-email"
                  autoComplete="email"
                  placeholder="you@studio.com"
                  value={email}
                  disabled={busy}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <p className="site-gate-error" role="alert">{error}</p>
                <button type="submit" disabled={busy || !email.trim()}>
                  {busy ? 'Sending…' : 'Email me a code'}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyCode}>
                <input
                  type="email"
                  name="studio-email"
                  autoComplete="email"
                  value={email}
                  disabled
                  readOnly
                />
                <input
                  type="text"
                  name="studio-code"
                  inputMode="numeric"
                  autoFocus
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  disabled={busy}
                  onChange={(event) => setCode(event.target.value)}
                />
                <p className="site-gate-error" role="alert">{error}</p>
                <button type="submit" disabled={busy || !code.trim()}>
                  {busy ? 'Checking…' : mode === 'signup' ? 'Verify and create account' : 'Verify and sign in'}
                </button>
                <button
                  type="button"
                  className="site-gate-secondary"
                  disabled={busy}
                  onClick={() => {
                    setPhase('email');
                    setCode('');
                    setError('');
                  }}
                >
                  Use a different email
                </button>
              </form>
            )}
          </>
        )}
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
