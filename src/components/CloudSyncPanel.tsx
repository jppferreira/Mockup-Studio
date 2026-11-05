import type { CloudLibraryStatus } from '../lib/cloudLibrary';

export type CloudTarget = 'icloud' | 'google-drive' | 'pick';

export default function CloudSyncPanel({
  cloud,
  busy,
  variant,
  onUse,
  onStop,
}: {
  cloud: CloudLibraryStatus | null;
  busy: boolean;
  variant: 'menu' | 'banner' | 'settings';
  onUse: (target: CloudTarget) => void;
  onStop: () => void;
}) {
  const desktop = typeof window !== 'undefined' && Boolean(window.mockupDesktop?.cloudStatus);
  const configured = Boolean(cloud?.configured);
  const label = cloud?.label || 'your drive';

  return (
    <section
      className={`sync-panel ${variant === 'menu' ? 'sync-popover' : ''} ${variant === 'banner' ? 'sync-banner' : ''} ${variant === 'settings' ? 'sync-settings' : ''}`}
      aria-label="Project sync"
    >
      {!desktop ? (
        <>
          <strong>Sync from the Mac app</strong>
          <p>The desktop app can keep projects in iCloud Drive or Google Drive and update them automatically.</p>
        </>
      ) : configured && cloud?.missing ? (
        <>
          <strong>Sync folder unavailable</strong>
          <p>
            {label} is not available right now. Turn it back on and Mockup Studio will keep saving to {cloud.folderLabel}.
          </p>
          <div className="sync-actions">
            <button type="button" disabled={busy} onClick={() => onUse('pick')}>Choose a folder</button>
            <button type="button" className="sync-stop" disabled={busy} onClick={onStop}>Stop syncing</button>
          </div>
        </>
      ) : configured && cloud ? (
        <>
          <strong>Syncing to {label}</strong>
          <p>
            Saved in {cloud.folderLabel}. Edits save automatically, and {label} syncs that folder to your other devices.
          </p>
          <div className="sync-actions">
            <button type="button" disabled={busy} onClick={() => onUse('pick')}>Choose a different folder</button>
            <button type="button" className="sync-stop" disabled={busy} onClick={onStop}>Stop syncing</button>
          </div>
        </>
      ) : !cloud ? (
        <>
          <strong>Save to iCloud or Google Drive</strong>
          <p>
            Pick a folder those apps already sync. Mockup Studio saves your projects there automatically. Nothing is uploaded to Mockup Studio.
          </p>
          <div className="sync-actions">
            <button type="button" disabled={busy} onClick={() => onUse('icloud')}>iCloud Drive</button>
            <button type="button" disabled={busy} onClick={() => onUse('google-drive')}>Google Drive</button>
            <button type="button" disabled={busy} onClick={() => onUse('pick')}>Choose folder</button>
          </div>
        </>
      ) : (
        <>
          <strong>Save to iCloud or Google Drive</strong>
          <p>
            Pick a folder those apps already sync. Mockup Studio saves your projects there automatically. Nothing is uploaded to Mockup Studio.
          </p>
          <div className="sync-actions">
            <button
              type="button"
              disabled={busy || !cloud?.icloud.available}
              title={cloud?.icloud.detail}
              onClick={() => onUse('icloud')}
            >
              iCloud Drive
            </button>
            <button
              type="button"
              disabled={busy || !cloud?.googleDrive.available}
              title={cloud?.googleDrive.detail}
              onClick={() => onUse('google-drive')}
            >
              Google Drive
            </button>
            <button type="button" disabled={busy} onClick={() => onUse('pick')}>
              Choose folder
            </button>
          </div>
          {cloud && !cloud.icloud.available && <p>{cloud.icloud.detail}</p>}
          {cloud && !cloud.googleDrive.available && <p>{cloud.googleDrive.detail}</p>}
          {cloud?.googleDrive.available && cloud.googleDrive.readable === false && (
            <p>{cloud.googleDrive.detail}</p>
          )}
        </>
      )}
    </section>
  );
}
