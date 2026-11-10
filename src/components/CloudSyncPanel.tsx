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
            Choose a folder in iCloud Drive or Google Drive once. After that, every edit saves there automatically — web and Mac stay aligned.
          </p>
        </>
      ) : configured && cloud?.missing ? (
        <>
          <strong>Reconnect to keep syncing</strong>
          <p>
            Allow access to {cloud.folderLabel || label} again. Edits will keep saving automatically, like Figma.
          </p>
          <div className="sync-actions">
            <button type="button" disabled={busy} onClick={() => onUse('pick')}>Reconnect folder</button>
            <button type="button" className="sync-stop" disabled={busy} onClick={onStop}>Stop syncing</button>
          </div>
        </>
      ) : configured && cloud ? (
        <>
          <strong>Always syncing to {label}</strong>
          <p>
            Every edit saves to {cloud.folderLabel} automatically. {label} keeps the Mac app and browser on the same files — nothing is uploaded to mokstudio.
          </p>
          <div className="sync-actions">
            <button type="button" disabled={busy} onClick={() => onUse('pick')}>Choose a different folder</button>
            <button type="button" className="sync-stop" disabled={busy} onClick={onStop}>Stop syncing</button>
          </div>
        </>
      ) : (
        <>
          <strong>Turn on always-sync</strong>
          <p>
            {desktop
              ? 'Pick a folder iCloud or Google Drive already syncs. From then on every project file saves there automatically — no manual save or export between devices.'
              : 'Choose the same mokstudio folder the Mac app uses. From then on every edit saves there automatically so web and desktop always share the same files.'}
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
