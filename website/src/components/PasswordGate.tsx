import { FormEvent, useState } from 'react';

const STORAGE_KEY = 'mokstudio.website-gate';

declare const __WEBSITE_GATE_SHA256__: string;

export function websiteGateEnabled(): boolean {
  return Boolean(__WEBSITE_GATE_SHA256__);
}

export function isWebsiteUnlocked(): boolean {
  if (!websiteGateEnabled()) return true;
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
    /* private mode — unlock for this render only */
  }
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

/** Site-wide launch password. Separate from CheckoutAuthModal / Supabase sign-in. */
export function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const attempt = password.trim();
    if (!attempt) {
      setError('Enter the password');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const hash = await sha256(attempt);
      if (!hashesMatch(hash, __WEBSITE_GATE_SHA256__)) {
        setError('Wrong password');
        setBusy(false);
        return;
      }
      markUnlocked();
      onUnlock();
    } catch {
      setError('Could not verify password');
      setBusy(false);
    }
  };

  return (
    <div className="password-gate">
      <form className="password-gate-card" onSubmit={(event) => void onSubmit(event)}>
        <p className="password-gate-brand">mokstudio</p>
        <h1>Enter password</h1>
        <p className="password-gate-copy">This site is not public yet.</p>
        <input
          type="password"
          name="site-password"
          autoComplete="current-password"
          autoFocus
          placeholder="Password"
          value={password}
          disabled={busy}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) setError('');
          }}
        />
        {error ? <p className="password-gate-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
