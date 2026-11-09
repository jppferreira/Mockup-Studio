import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Reveal } from '../components/Reveal';
import { SiteChrome } from '../components/SiteChrome';

function fulfillBase(): string {
  const fromEnv = import.meta.env.VITE_FULFILL_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    return 'http://127.0.0.1:8787';
  }
  return '';
}

type Step = 'request' | 'confirm' | 'done';

export function RecoverPage() {
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [orderId, setOrderId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [devKey, setDevKey] = useState<string | null>(null);

  const api = fulfillBase();

  const onRequest = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setDevCode(null);
    if (!api) {
      setError('Recovery API is not configured (set VITE_FULFILL_API_URL).');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${api}/recover/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          orderId: orderId.trim() || undefined,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        devCode?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.error || 'Could not start recovery.');
        return;
      }
      setInfo(body.message || 'Check your email for a code.');
      if (body.devCode) setDevCode(body.devCode);
      setStep('confirm');
    } catch {
      setError('Could not reach the recovery server. Is fulfill:dev running?');
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setDevKey(null);
    if (!api) {
      setError('Recovery API is not configured (set VITE_FULFILL_API_URL).');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${api}/recover/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        key?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.error || 'Could not verify that code.');
        return;
      }
      setInfo(body.message || 'A new key is on its way by email.');
      if (body.key) setDevKey(body.key);
      setStep('done');
    } catch {
      setError('Could not reach the recovery server. Is fulfill:dev running?');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SiteChrome>
      <main className="page">
        <header className="page-hero">
          <p className="section-kicker">License</p>
          <h1>Recover your key</h1>
          <p className="page-lede">
            Lost the email, new Mac, or need a fresh key? We verify the purchase email with a one-time code, then
            send a newly signed license key.
          </p>
        </header>

        {step === 'request' && (
          <Reveal>
            <form className="recover-form" onSubmit={(e) => void onRequest(e)}>
              <label htmlFor="recover-email">Purchase email</label>
              <input
                id="recover-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
              />
              <label htmlFor="recover-order">Order ID (optional)</label>
              <input
                id="recover-order"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="If you have several purchases"
              />
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a code'}
              </button>
            </form>
          </Reveal>
        )}

        {step === 'confirm' && (
          <Reveal>
            <form className="recover-form" onSubmit={(e) => void onConfirm(e)}>
              <p className="recover-email-line">
                Code sent to <strong>{email}</strong>
              </p>
              <label htmlFor="recover-code">6-digit code</label>
              <input
                id="recover-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
              {devCode && (
                <p className="page-note recover-dev">
                  Dry-run code (no Resend): <code>{devCode}</code>
                </p>
              )}
              <div className="recover-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Checking…' : 'Verify & email new key'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    setStep('request');
                    setCode('');
                    setDevCode(null);
                    setError(null);
                  }}
                >
                  Back
                </button>
              </div>
            </form>
          </Reveal>
        )}

        {step === 'done' && (
          <Reveal as="section" className="page-note">
            <p>{info}</p>
            {devKey && (
              <p className="recover-dev">
                Dry-run key: <code>{devKey}</code>
              </p>
            )}
            <p>Open mokstudio → License → paste the new key. Remove any old license first if needed.</p>
          </Reveal>
        )}

        {error && <p className="recover-error">{error}</p>}
        {info && step !== 'done' && <p className="recover-info">{info}</p>}

        <Reveal as="section" className="page-cta">
          <Link className="btn btn-ghost" to="/pricing">
            Pricing
          </Link>
          <Link className="btn btn-ghost" to="/terms">
            Terms
          </Link>
        </Reveal>
      </main>
    </SiteChrome>
  );
}
