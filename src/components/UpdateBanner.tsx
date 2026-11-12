import { useEffect, useRef, useState } from 'react';
import { Check, Download, RefreshCw, X } from 'lucide-react';
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
  onNotify?: (message: string) => void;
};

/**
 * Desktop auto-update UI.
 * Available → changelog modal → download in background (app stays usable) →
 * confirmation when ready → restart installs from the downloaded zip.
 */
export default function UpdateBanner({ home = false, onNotify }: Props) {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const readyAnnounced = useRef<string | null>(null);
  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  useEffect(() => {
    if (!isDirectDesktopBuild()) return undefined;

    let cancelled = false;
    const api = window.mockupDesktop;

    void api?.takeUpdateConfirmation?.().then((confirmation) => {
      if (cancelled || !confirmation?.version) return;
      onNotifyRef.current?.(
        `mokstudio is updated to ${confirmation.version}. You’re on the latest version.`,
      );
    });

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

  useEffect(() => {
    if (status?.state !== 'ready' || !status.version) return;
    if (readyAnnounced.current === status.version) return;
    readyAnnounced.current = status.version;
    onNotifyRef.current?.(
      `Update ${status.version} finished downloading. Restart when you’re ready to install it.`,
    );
  }, [status?.state, status?.version]);

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
    const version = status?.version ?? null;
    setBusy(true);
    setInstallError(null);
    // Close the blocking modal so the user can keep working.
    setDismissedKey(`downloading:${version ?? ''}`);
    setStatus((prev) => ({
      state: 'downloading',
      version: prev?.version ?? null,
      percent: 0,
      notes: prev?.notes,
      title: prev?.title,
    }));
    onNotifyRef.current?.(
      version
        ? `Downloading update ${version} in the background…`
        : 'Downloading update in the background…',
    );
    try {
      const result = await window.mockupDesktop?.downloadUpdate?.();
      if (!result?.ok) {
        setDismissedKey(null);
        setStatus({
          state: 'error',
          message: result?.error || 'Could not download the update.',
          version,
          notes: status?.notes,
          title: status?.title,
        });
      }
    } catch (err) {
      setDismissedKey(null);
      setStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Could not download the update.',
        version,
        notes: status?.notes,
        title: status?.title,
      });
    } finally {
      setBusy(false);
    }
  };

  const installUpdate = async () => {
    setBusy(true);
    setInstallError(null);
    try {
      const result = await window.mockupDesktop?.installUpdate?.();
      if (!result?.ok) {
        setInstallError(result?.error || 'Could not restart to install the update.');
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Could not restart to install the update.');
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
  const versionLabel = status.version ? ` ${status.version}` : '';
  const percent = typeof status.percent === 'number' ? Math.max(0, Math.min(100, status.percent)) : null;
  const notes = status.notes?.length ? status.notes : null;

  // While downloading, never block the UI — only a compact banner.
  if (status.state === 'downloading') {
    return (
      <div className="update-banner" role="status">
        <span>
          Downloading update{versionLabel}
          {percent != null ? ` · ${percent}%` : '…'}
        </span>
      </div>
    );
  }

  // Ready confirmation — show on home as modal; elsewhere as banner.
  if (status.state === 'ready') {
    if (!home || dismissedKey === dismissKey) {
      return (
        <div className="update-banner" role="status">
          <span>Update{versionLabel} is ready.</span>
          <button type="button" disabled={busy} onClick={() => void installUpdate()}>
            Restart
          </button>
        </div>
      );
    }

    return (
      <div
        className="modal-backdrop update-prompt-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDismissedKey(dismissKey);
        }}
      >
        <div
          className="export-modal update-prompt-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-ready-title"
        >
          <div className="modal-head">
            <div className="modal-icon" aria-hidden>
              <Check size={21} />
            </div>
            <button
              type="button"
              className="modal-close"
              aria-label="Dismiss"
              onClick={() => setDismissedKey(dismissKey)}
            >
              <X size={19} />
            </button>
          </div>
          <h2 id="update-ready-title">Update{versionLabel} is ready</h2>
          <p>
            The download finished. You can keep working — restart mokstudio when you want to install it.
            Your projects are saved.
          </p>
          {installError && (
            <p className="update-prompt-error" role="alert">{installError}</p>
          )}
          <div className="export-modal-actions">
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
              onClick={() => void installUpdate()}
            >
              <RefreshCw size={15} aria-hidden />
              Restart and update
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (home && dismissedKey === dismissKey) return null;

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
    return null;
  }

  const title = status.state === 'error'
    ? 'Could not download update'
    : `Update${versionLabel} available`;

  const body = status.state === 'error'
    ? `${status.message || 'The update could not be downloaded.'} Try again — you can keep using mokstudio while it downloads.`
    : `You’re on ${currentAppVersion()}. Download in the background, keep working, then restart when it’s ready.`;

  return (
    <div
      className="modal-backdrop update-prompt-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
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
            <Download size={21} />
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="Dismiss update prompt"
            onClick={() => setDismissedKey(dismissKey)}
          >
            <X size={19} />
          </button>
        </div>
        <h2 id="update-prompt-title">{title}</h2>
        <p>{body}</p>
        {notes && status.state === 'available' && (
          <div className="update-prompt-notes">
            <strong>{status.title || `What’s new in ${status.version ?? 'this update'}`}</strong>
            <ul>
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="export-modal-actions">
          {status.state === 'error' ? (
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
