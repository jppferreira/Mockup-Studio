import type { CloudLibraryStatus } from '../lib/cloudLibrary';
import { cloudApiAvailable } from '../lib/cloudApi';

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
  const syncReady = cloudApiAvailable();
  const desktop = typeof window !== 'undefined' && Boolean(window.mockupDesktop?.cloudStatus);
  const configured = Boolean(cloud?.configured);
  const label = cloud?.label || 'your drive';

  return (
    <section
      className={`sync-panel ${variant === 'menu' ? 'sync-popover' : ''} ${variant === 'banner' ? 'sync-banner' : ''} ${variant === 'settings' ? 'sync-settings' : ''}`}
      aria-label="Project sync"
    >
      {!syncReady ? (
        <>
          <strong>Sync needs Chrome, Edge, or the Mac app</strong>
          <p>
            Pick a folder in iCloud Drive or Google Drive so the browser and desktop app keep the same projects in place.
          </p>
        </>
      ) : configured && cloud?.missing ? (
        <>
          <strong>Sync folder unavailable</strong>
          <p>
            {label} is not available right now. Turn it back on and mokstudio will keep saving to {cloud.folderLabel}.
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
            Saved in {cloud.folderLabel}. Edits save automatically, and {label} syncs that folder to your other devices
            {desktop ? '' : ' — including the Mac app'}.
          </p>
          <div className="sync-actions">
            <button type="button" disabled={busy} onClick={() => onUse('pick')}>Choose a different folder</button>
            <button type="button" className="sync-stop" disabled={busy} onClick={onStop}>Stop syncing</button>
          </div>
        </>
      ) : (
        <>
          <strong>Save to iCloud or Google Drive</strong>
          <p>
            {desktop
              ? 'Pick a folder those apps already sync. mokstudio saves your projects and templates there automatically. Nothing is uploaded to mokstudio.'
              : 'Choose the same mokstudio folder the Mac app uses in iCloud Drive or Google Drive. Projects stay in that folder — nothing is uploaded to mokstudio.'}
          </p>
          <div className="sync-actions">
            <button
              type="button"
              disabled={busy || cloud?.icloud.available === false}
              title={cloud?.icloud.detail}
              onClick={() => onUse('icloud')}
            >
              iCloud Drive
            </button>
            <button
              type="button"
              disabled={busy || cloud?.googleDrive.available === false}
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
