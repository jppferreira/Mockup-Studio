import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { isDirectDesktopBuild, supportsElectronUpdater } from '../lib/distribution';
import {
  currentAppVersion,
  fetchReleaseNotesForVersion,
  probeExternalUpdate,
  type DesktopUpdateStatus,
} from '../lib/desktopUpdate';

type Props = {
  /** Home / projects dashboard — use a modal instead of the corner banner. */
  home?: boolean;
};

/**
 * Desktop auto-update UI (Figma-style).
 * Detect → show what changed → download inside the app → restart to install.
 */
export default function UpdateBanner({ home = false }: Props) {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isDirectDesktopBuild()) return undefined;

    let cancelled = false;
    const api = window.mockupDesktop;

    const mergeNotes = async (next: DesktopUpdateStatus) => {
      if (!next.version) return next;
      if (next.notes && next.notes.length > 0) return next;
      const release = await fetchReleaseNotesForVersion(next.version);
      if (!release) return next;
      return {
        ...next,
        title: next.title || release.title,
        notes: release.notes,
      };
    };

    const apply = (next: DesktopUpdateStatus | null | undefined) => {
      if (cancelled || !next) return;
      setStatus((prev) => {
        if (prev?.state === 'ready' && next.state !== 'ready') return prev;
        if (prev?.state === 'downloading' && (next.state === 'available' || next.state === 'up-to-date')) {
          return prev;
        }
        const merged: DesktopUpdateStatus = {
          ...next,
          notes: next.notes?.length ? next.notes : prev?.notes,
          title: next.title || prev?.title,
        };
        if (
          merged.version
          && (!merged.notes || merged.notes.length === 0)
          && (merged.state === 'available' || merged.state === 'downloading' || merged.state === 'ready')
        ) {
          void mergeNotes(merged).then((withNotes) => {
            if (cancelled) return;
            setStatus((current) => {
              if (!current || current.version !== withNotes.version) return current;
              return { ...current, notes: withNotes.notes, title: withNotes.title || current.title };
            });
          });
        }
        return merged;
      });
    };

    if (api?.onUpdateStatus) {
      void api.updateStatus?.().then((current) => apply(current));
      const unsubscribe = api.onUpdateStatus((current) => apply(current));
      const timer = window.setTimeout(() => {
        void api.checkForUpdates?.().then((result) => {
          if (!result) return;
          if (!result.ok && result.error) {
            apply({ state: 'error', message: result.error });
            return;
          }
          if (result.state) {
            apply({
              state: result.state,
              version: result.version,
              percent: result.percent,
            });
          }
        });
      }, home ? 800 : 2500);

      const probeTimer = window.setTimeout(() => {
        void probeExternalUpdate(currentAppVersion()).then((external) => {
          if (!external || external.state !== 'available') return;
          setStatus((prev) => {
            if (!prev || prev.state === 'idle' || prev.state === 'up-to-date' || prev.state === 'checking') {
              return external;
            }
            if (prev.version === external.version && (!prev.notes || prev.notes.length === 0)) {
              return { ...prev, notes: external.notes, title: external.title || prev.title };
            }
            return prev;
          });
        });
      }, home ? 1600 : 6000);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        window.clearTimeout(probeTimer);
        unsubscribe();
      };
    }

    return () => {
      cancelled = true;
    };
  }, [home]);

  const startInAppDownload = async () => {
    if (!supportsElectronUpdater()) {
      setStatus({
        state: 'error',
        message: 'In-app updates are not available in this build.',
        version: status?.version,
        notes: status?.notes,
        title: status?.title,
      });
      return;
    }
    setBusy(true);
    setStatus((prev) => ({
      state: 'downloading',
      version: prev?.version ?? null,
      percent: 0,
      notes: prev?.notes,
      title: prev?.title,
    }));
    try {
      const result = await window.mockupDesktop?.downloadUpdate?.();
      if (!result?.ok) {
        setStatus({
          state: 'error',
          message: result?.error || 'Could not download the update.',
          version: status?.version,
          notes: status?.notes,
          title: status?.title,
        });
      }
    } catch (err) {
      setStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Could not download the update.',
        version: status?.version,
        notes: status?.notes,
        title: status?.title,
      });
    } finally {
      setBusy(false);
    }
  };

  const active = status && (
    status.state === 'available'
    || status.state === 'downloading'
    || status.state === 'ready'
    || (home && status.state === 'error' && Boolean(status.message))
  );
  if (!active || !status) return null;

  const dismissKey = `${status.state}:${status.version ?? ''}`;
  if (home && dismissedKey === dismissKey && status.state !== 'ready') return null;

  const versionLabel = status.version ? ` ${status.version}` : '';
  const percent = typeof status.percent === 'number' ? Math.max(0, Math.min(100, status.percent)) : null;
  const notes = status.notes?.length ? status.notes : null;

  if (!home) {
    if (status.state === 'available') {
      return (
        <div className="update-banner" role="status">
          <span>Update{versionLabel} available.</span>
          <button type="button" disabled={busy} onClick={() => void startInAppDownload()}>
            Download
          </button>
        </div>
      );
    }
    if (status.state !== 'downloading' && status.state !== 'ready') return null;
    return (
      <div className="update-banner" role="status">
        {status.state === 'ready' ? (
          <>
            <span>Update{versionLabel} is ready.</span>
            <button type="button" onClick={() => void window.mockupDesktop?.installUpdate?.()}>
              Restart
            </button>
          </>
        ) : (
          <span>
            Downloading update
            {percent != null ? ` ${percent}%` : '…'}
          </span>
        )}
      </div>
    );
  }

  const title = status.state === 'ready'
    ? `Update${versionLabel} is ready`
    : status.state === 'error'
      ? 'Could not download update'
      : status.state === 'downloading'
        ? `Downloading update${versionLabel}`
        : `Update${versionLabel} available`;

  const body = status.state === 'ready'
    ? 'Restart mokstudio to install the update. Your projects are saved.'
    : status.state === 'downloading'
      ? 'Downloading in the background. Keep the app open — we will ask you to restart when it is ready.'
      : status.state === 'error'
        ? `${status.message || 'The update could not be downloaded.'} Try again to download inside mokstudio.`
        : `You’re on ${currentAppVersion()}. Here’s what’s new — download inside the app, then restart when ready.`;

  return (
    <div
      className="modal-backdrop update-prompt-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (status.state === 'ready' || status.state === 'downloading') return;
        setDismissedKey(dismissKey);
      }}
    >
      <div
        className="export-modal update-prompt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-prompt-title"
      >
        <div className="modal-head">
          <div className="modal-icon" aria-hidden>
            {status.state === 'ready' ? <RefreshCw size={21} /> : <Download size={21} />}
          </div>
          {status.state !== 'ready' && status.state !== 'downloading' && (
            <button
              type="button"
              className="modal-close"
              aria-label="Dismiss update prompt"
              onClick={() => setDismissedKey(dismissKey)}
            >
              <X size={19} />
            </button>
          )}
        </div>
        <h2 id="update-prompt-title">{title}</h2>
        <p>{body}</p>
        {notes && (
          <div className="update-prompt-notes">
            <strong>{status.title || `What’s new in ${status.version ?? 'this update'}`}</strong>
            <ul>
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        {status.state === 'downloading' && (
          <div className="update-prompt-progress" aria-live="polite">
            <div className="update-prompt-progress-track">
              <div
                className="update-prompt-progress-fill"
                style={{ width: `${percent ?? 8}%` }}
              />
            </div>
            <span>{percent != null ? `${percent}%` : 'Starting…'}</span>
          </div>
        )}
        <div className="export-modal-actions">
          {status.state === 'ready' ? (
            <button
              type="button"
              className="button primary-button"
              onClick={() => void window.mockupDesktop?.installUpdate?.()}
            >
              Restart and update
            </button>
          ) : status.state === 'downloading' ? (
            <button type="button" className="button subtle-button" disabled>
              Downloading…
            </button>
          ) : status.state === 'error' ? (
            <>
              <button
                type="button"
                className="button subtle-button"
                onClick={() => setDismissedKey(dismissKey)}
              >
                Later
              </button>
              <button
                type="button"
                className="button primary-button"
                disabled={busy}
                onClick={() => void startInAppDownload()}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="button subtle-button"
                onClick={() => setDismissedKey(dismissKey)}
              >
                Later
              </button>
              <button
                type="button"
                className="button primary-button"
                disabled={busy}
                onClick={() => void startInAppDownload()}
              >
                Download update
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
