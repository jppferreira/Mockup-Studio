import { FormEvent, useState } from 'react';

const STORAGE_KEY = 'mockup-studio.site-gate';

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
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
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
      try {
        sessionStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // Private mode can block storage. The gate still opens for this load.
      }
      onUnlock();
    } catch {
      setError('Could not check that. Click Enter again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site-gate">
      <form onSubmit={submit}>
        <div className="site-gate-brand">
          <img className="site-gate-logo" src="./splash/logo.png" alt="" width={72} height={72} />
          <h1>Mockup Studio</h1>
        </div>
        <p>Enter the password to open the studio.</p>
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
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="site-gate-error" role="alert">{error}</p>
        <button type="submit">Enter</button>
      </form>
    </div>
  );
}
