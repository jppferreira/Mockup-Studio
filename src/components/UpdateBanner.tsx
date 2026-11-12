import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { supportsElectronUpdater } from '../lib/distribution';

type UpdateStatus = {
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'up-to-date';
  version?: string | null;
  percent?: number;
  message?: string | null;
};

type Props = {
  /** Home / projects dashboard — use a modal instead of the corner banner. */
  home?: boolean;
};

/**
 * Desktop auto-update UI.
 * On the home page: modal when a download is in progress or ready to install.
 * Inside a project: compact bottom banner so it does not block the canvas.
 */
export default function UpdateBanner({ home = false }: Props) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!supportsElectronUpdater()) return undefined;
    const api = window.mockupDesktop;
    if (!api?.onUpdateStatus) return undefined;

    void api.updateStatus?.().then((current) => {
      if (current) setStatus(current);
    });

    const unsubscribe = api.onUpdateStatus(setStatus);

    // On home, nudge an early check so users are not waiting only on the
    // background 8s timer.
    let timer: number | undefined;
    if (home) {
      timer = window.setTimeout(() => {
        void api.checkForUpdates?.();
      }, 1200);
    }

    return () => {
      if (timer != null) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [home]);

  const active = status && (status.state === 'downloading' || status.state === 'ready');
  if (!active || !status) return null;

  const dismissKey = `${status.state}:${status.version ?? ''}`;
  // Allow dismissing the download prompt; always re-show when install is ready.
  if (home && dismissedKey === dismissKey && status.state === 'downloading') return null;

  if (!home) {
    return (
      <div className="update-banner" role="status">
        {status.state === 'ready' ? (
          <>
            <span>Update{status.version ? ` ${status.version}` : ''} is ready.</span>
            <button type="button" onClick={() => void window.mockupDesktop?.installUpdate?.()}>
              Restart
            </button>
          </>
        ) : (
          <span>
            Downloading update
            {typeof status.percent === 'number' ? ` ${status.percent}%` : '…'}
          </span>
        )}
      </div>
    );
  }

  const versionLabel = status.version ? ` ${status.version}` : '';
  const percent = typeof status.percent === 'number' ? Math.max(0, Math.min(100, status.percent)) : null;

  return (
    <div
      className="modal-backdrop update-prompt-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (status.state === 'ready') return;
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
          {status.state !== 'ready' && (
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
        <h2 id="update-prompt-title">
          {status.state === 'ready' ? `Update${versionLabel} is ready` : `Update${versionLabel} available`}
        </h2>
        <p>
          {status.state === 'ready'
            ? 'Restart mokstudio to install the latest performance and bug fixes. Your projects are saved.'
            : 'A newer version is downloading. You can keep working — we will ask again when it is ready to install.'}
        </p>
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
          ) : (
            <button
              type="button"
              className="button subtle-button"
              onClick={() => setDismissedKey(dismissKey)}
            >
              Later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
