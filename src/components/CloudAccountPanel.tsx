import { useEffect, useState } from 'react';
import {
  getAuthSnapshot,
  isSupabaseConfigured,
  onAuthChange,
  requestEmailOtp,
  signOutCloud,
  verifyEmailOtp,
} from '../lib/supabaseClient';
import {
  isCloudSyncAvailable,
  pullCloudProjects,
  pushAllRecentToCloud,
} from '../lib/cloudProjects';
import type { RecentProjectEntry } from '../lib/recentProjects';

/**
 * Secure cloud account + sync.
 * Email OTP only (no shared passwords). Sync runs only while a Supabase session exists;
 * RLS ensures the API can never return another user's rows.
 */
export default function CloudAccountPanel({
  recentProjects,
  onMergeCloudProjects,
}: {
  recentProjects: RecentProjectEntry[];
  onMergeCloudProjects: (entries: RecentProjectEntry[]) => void;
}) {
  const configured = isSupabaseConfigured() && isCloudSyncAvailable();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'idle' | 'code'>('idle');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return undefined;
    let cancelled = false;
    void getAuthSnapshot().then((snap) => {
      if (!cancelled) setUserEmail(snap.user?.email ?? null);
    });
    return onAuthChange((snap) => {
      setUserEmail(snap.user?.email ?? null);
      if (!snap.user) setPhase('idle');
    });
  }, [configured]);

  if (!configured) {
    return (
      <section className="sync-panel sync-settings" aria-label="Cloud account">
        <strong>Cloud save</strong>
        <p>
          Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable
          private project sync. Projects stay on this Mac until then.
        </p>
      </section>
    );
  }

  const sendCode = async () => {
    setBusy(true);
    setMessage(null);
    const result = await requestEmailOtp(email);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setPhase('code');
    setMessage('Check your email for a one-time sign-in code.');
  };

  const verify = async () => {
    setBusy(true);
    setMessage(null);
    const result = await verifyEmailOtp(email, code);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setUserEmail(result.user.email ?? email);
    setCode('');
    setPhase('idle');
    setMessage('Signed in. Your projects sync only to this account.');
  };

  const syncNow = async () => {
    setBusy(true);
    setMessage(null);
    const push = await pushAllRecentToCloud(recentProjects);
    if (!push.ok) {
      setBusy(false);
      setMessage(push.error);
      return;
    }
    const pull = await pullCloudProjects();
    setBusy(false);
    if (!pull.ok) {
      setMessage(pull.error);
      return;
    }
    onMergeCloudProjects(pull.entries);
    setMessage(`Synced ${push.synced} up · ${pull.entries.length} in your cloud library.`);
  };

  const signOut = async () => {
    setBusy(true);
    await signOutCloud();
    setBusy(false);
    setUserEmail(null);
    setMessage('Signed out. Local projects stay on this Mac.');
  };

  return (
    <section className="sync-panel sync-settings" aria-label="Cloud account">
      <strong>Cloud save (private)</strong>
      {userEmail ? (
        <>
          <p>
            Signed in as <strong>{userEmail}</strong>. Row-level security keeps every project
            visible only to this account — other users cannot list or open them.
          </p>
          <div className="sync-actions">
            <button type="button" disabled={busy} onClick={() => void syncNow()}>
              Sync now
            </button>
            <button type="button" className="sync-stop" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            Sign in with a one-time email code. No password is stored. Cloud sync uses your
            session token; the database rejects any request that is not yours.
          </p>
          <label className="dash-cloud-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@studio.com"
            />
          </label>
          {phase === 'code' && (
            <label className="dash-cloud-field">
              <span>Code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
              />
            </label>
          )}
          <div className="sync-actions">
            {phase === 'idle' ? (
              <button type="button" disabled={busy || !email.trim()} onClick={() => void sendCode()}>
                Email me a code
              </button>
            ) : (
              <>
                <button type="button" disabled={busy || !code.trim()} onClick={() => void verify()}>
                  Verify and sign in
                </button>
                <button type="button" className="sync-stop" disabled={busy} onClick={() => setPhase('idle')}>
                  Back
                </button>
              </>
            )}
          </div>
        </>
      )}
      {message && <p>{message}</p>}
    </section>
  );
}
