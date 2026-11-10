import type { ConflictResolution, SyncConflict } from '../lib/cloudSync';
import { formatRecentTime } from '../lib/recentProjects';

export default function CloudConflictModal({
  conflicts,
  busy,
  onResolve,
  onDismiss,
}: {
  conflicts: SyncConflict[];
  busy?: boolean;
  onResolve: (conflict: SyncConflict, choice: ConflictResolution) => void;
  onDismiss: () => void;
}) {
  if (!conflicts.length) return null;
  const current = conflicts[0];
  const remoteUpdated = Date.parse(current.remote.updated_at);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onDismiss}>
      <div
        className="export-modal cloud-conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-conflict-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id="cloud-conflict-title">Sync conflict</h2>
            <p>
              “{current.localName}” changed both here and in the cloud.
              Choose which copy to keep — nothing is overwritten silently.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onDismiss} aria-label="Close">
            ×
          </button>
        </div>

        <div className="cloud-conflict-grid">
          <div className="cloud-conflict-card">
            <strong>This device</strong>
            <span>Revision {current.local.revision}</span>
            <span>{formatRecentTime(current.local.updatedAt)}</span>
          </div>
          <div className="cloud-conflict-card">
            <strong>Cloud</strong>
            <span>Revision {current.remote.revision}</span>
            <span>{Number.isFinite(remoteUpdated) ? formatRecentTime(remoteUpdated) : 'Unknown'}</span>
          </div>
        </div>

        {conflicts.length > 1 && (
          <p className="cloud-conflict-more">{conflicts.length - 1} more conflict{conflicts.length > 2 ? 's' : ''} waiting.</p>
        )}

        <div className="export-modal-actions cloud-conflict-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => onResolve(current, 'keep-local')}
          >
            Keep this device
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onResolve(current, 'take-cloud')}
          >
            Take cloud copy
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => onResolve(current, 'duplicate')}
          >
            Keep both
          </button>
        </div>
      </div>
    </div>
  );
}
