import { useEffect, useState } from 'react';
import {
  completeDesktopOAuthCallback,
  getAuthSnapshot,
  isSupabaseConfigured,
  onAuthChange,
  requestEmailOtp,
  signInWithOAuthProvider,
  signOutCloud,
  verifyEmailOtp,
  type OAuthProvider,
} from '../lib/supabaseClient';
import {
  duplicateCloudProject,
  isCloudSyncAvailable,
} from '../lib/cloudProjects';
import { formatSyncedClock, noteLastSynced, syncNow, useLastSyncedAt, type SyncConflict } from '../lib/cloudSync';
import type { RecentProjectEntry } from '../lib/recentProjects';

/**
 * Secure cloud account + sync.
 * Email OTP only (no shared passwords). Sync runs only while a Supabase session exists;
 * RLS ensures the API can never return another user's rows.
 */
export default function CloudAccountPanel({
  recentProjects,
  onMergeCloudProjects,
  onApplyCloudDeletes,
  onConflicts,
  onSignedInChange,
  onAfterSync,
  variant = 'settings',
}: {
  recentProjects: RecentProjectEntry[];
  onMergeCloudProjects: (entries: RecentProjectEntry[]) => void;
  onApplyCloudDeletes?: (localIds: string[]) => void;
  onConflicts?: (conflicts: SyncConflict[]) => void;
  onSignedInChange?: (email: string | null) => void;
  onAfterSync?: () => void;
  variant?: 'settings' | 'menu';
}) {
  const configured = isSupabaseConfigured() && isCloudSyncAvailable();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'idle' | 'code'>('idle');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const lastSyncedAt = useLastSyncedAt();

  useEffect(() => {
    onSignedInChange?.(userEmail);
  }, [userEmail, onSignedInChange]);

  useEffect(() => {
    if (!configured) return undefined;
    let cancelled = false;
    void getAuthSnapshot().then((snap) => {
      if (!cancelled) setUserEmail(snap.user?.email ?? null);
    });
    const unsubAuth = onAuthChange((snap) => {
      setUserEmail(snap.user?.email ?? null);
      if (!snap.user) {
        setPhase('idle');
      }
    });

    const finishDesktopOAuth = async (url: string) => {
      setBusy(true);
      setMessage('Finishing browser sign-in…');
      const result = await completeDesktopOAuthCallback(url);
      if (cancelled) return;
      setBusy(false);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setUserEmail(result.user.email ?? null);
      setMessage('Signed in. Your projects sync only to this account.');
    };

    const unsubCallback = window.mockupDesktop?.onAuthCallback?.((url) => {
      void finishDesktopOAuth(url);
    });
    void window.mockupDesktop?.takePendingAuthCallback?.().then((url) => {
      if (url) void finishDesktopOAuth(url);
    });

    return () => {
      cancelled = true;
      unsubAuth();
      unsubCallback?.();
    };
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
    const result = await requestEmailOtp(email, { createUser: true });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setPhase('code');
    setMessage('Check your email for a one-time sign-in code.');
  };

  const startOAuth = async (provider: OAuthProvider) => {
    setBusy(true);
    setMessage(null);
    const result = await signInWithOAuthProvider(provider);
    if (!result.ok) {
      setBusy(false);
      setMessage(result.error);
      return;
    }
    if (result.desktopBrowser) {
      setBusy(false);
      setMessage('Continue in your browser, then return here.');
    }
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
    setMessage('Signed in. Syncing projects…');
    await runSync();
  };

  const runSync = async () => {
    setBusy(true);
    setMessage(null);
    let flush: Awaited<ReturnType<typeof syncNow>>['flush'];
    let pull: Awaited<ReturnType<typeof syncNow>>['pull'];
    try {
      const result = await Promise.race([
        syncNow(),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('Sync timed out. Try again — large media uploads in the background.')), 45_000);
        }),
      ]);
      flush = result.flush;
      pull = result.pull;
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : 'Sync failed.');
      return;
    }
    setBusy(false);

    const syncFailed = flush.errors.length > 0 || pull.errors.length > 0;
    if (!syncFailed) noteLastSynced();

    if (pull.deleted.length) {
      onApplyCloudDeletes?.(pull.deleted.map((row) => row.local_id));
    }
    if (pull.entries.length) onMergeCloudProjects(pull.entries);
    if (flush.conflicts.length || pull.conflicts.length) {
      const all = [...flush.conflicts, ...pull.conflicts];
      // Dedupe by localId
      const byId = new Map(all.map((item) => [item.localId, item]));
      onConflicts?.([...byId.values()]);
    }

    const parts = [
      flush.pushed ? `${flush.pushed} uploaded` : null,
      flush.deleted ? `${flush.deleted} removed` : null,
      pull.applied ? `${pull.applied} downloaded` : null,
      (flush.conflicts.length + pull.conflicts.length)
        ? `${flush.conflicts.length + pull.conflicts.length} conflict(s)`
        : null,
      flush.errors.length ? `${flush.errors.length} failed` : null,
    ].filter(Boolean);
    if (!parts.length && !flush.errors.length && !pull.errors.length) {
      setMessage('Already up to date.');
      return;
    }
    if (!parts.length) {
      setMessage(flush.errors[0] || pull.errors[0] || 'Sync failed.');
      return;
    }
    const detail = flush.errors[0] || pull.errors[0];
    setMessage(detail ? `Synced · ${parts.join(' · ')} · ${detail}` : `Synced · ${parts.join(' · ')}`);
    onAfterSync?.();
  };

  const signOut = async () => {
    setBusy(true);
    await signOutCloud();
    setBusy(false);
    setUserEmail(null);
    setMessage('Signed out. Local projects stay on this device.');
  };

  const onDuplicate = async (localId: string) => {
    setBusy(true);
    setMessage(null);
    const result = await duplicateCloudProject(localId);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    onMergeCloudProjects([result.entry, ...recentProjects]);
    setMessage(`Duplicated “${result.entry.name}”.`);
  };

  const panelClass = variant === 'menu'
    ? 'sync-panel sync-popover sync-account-menu'
    : 'sync-panel sync-settings';

  return (
    <section className={panelClass} aria-label="Cloud account">
      <strong>{variant === 'menu' ? 'Cloud sync' : 'Cloud save (private)'}</strong>
      {userEmail ? (
        <>
          <p>
            {variant === 'menu'
              ? <>Signed in as <strong>{userEmail}</strong>. Projects sync to this account on web and Mac.</>
              : <>Signed in as <strong>{userEmail}</strong>. Row-level security keeps every project visible only to this account — other users cannot list or open them.</>}
          </p>
          <p className="sync-last">
            {lastSyncedAt ? `Last synced ${formatSyncedClock(lastSyncedAt)}.` : 'Not synced yet.'}
          </p>
          <div className="sync-actions">
            <button type="button" disabled={busy} onClick={() => void runSync()}>
              Sync now
            </button>
            <button type="button" className="sync-stop" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
          {variant === 'settings' && recentProjects[0] && (
            <div className="sync-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => void onDuplicate(recentProjects[0].id)}
              >
                Duplicate latest to cloud
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p>
            {variant === 'menu'
              ? 'Sign in so web and the Mac app share the same projects. One account — not iCloud or Drive folders.'
              : 'Sign up or sign in with Google, Apple, or a one-time email code. Cloud sync uses your session token; the database rejects any request that is not yours.'}
          </p>
          {phase === 'idle' && (
            <div className="sync-actions cloud-oauth-actions">
              <button type="button" disabled={busy} onClick={() => void startOAuth('google')}>
                Continue with Google
              </button>
              <button type="button" disabled={busy} onClick={() => void startOAuth('apple')}>
                Continue with Apple
              </button>
            </div>
          )}
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
