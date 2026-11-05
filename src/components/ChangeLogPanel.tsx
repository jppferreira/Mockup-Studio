import { formatChangeTime, type ChangeLogEntry } from '../lib/changeLog';

interface ChangeLogPanelProps {
  entries: ChangeLogEntry[];
  onRestore: (entryId: string) => void;
}

export default function ChangeLogPanel({ entries, onRestore }: ChangeLogPanelProps) {
  return (
    <div className="change-log-panel">
      <p className="change-log-intro">
        Edits in this session. Restore jumps back to before that step and drops anything after it. ⌘Z undoes the latest.
      </p>
      {entries.length === 0 ? (
        <p className="change-log-empty">No edits yet. Move a device, change the light, or drop in a screen, and it will show up here.</p>
      ) : (
        <ol className="change-log">
          {entries.map((entry, index) => (
            <li key={entry.id} className={`change-log-item ${index === 0 ? 'is-latest' : ''}`}>
              <span className="change-log-rail" aria-hidden />
              <div className="change-log-copy">
                <div className="change-log-title-row">
                  <strong>{entry.summary}</strong>
                  <button
                    type="button"
                    className="change-log-restore"
                    title="Put the composition back to before this edit"
                    onClick={() => onRestore(entry.id)}
                  >
                    {index === 0 ? 'Undo' : 'Restore'}
                  </button>
                </div>
                <time dateTime={new Date(entry.at).toISOString()}>{formatChangeTime(entry.at)}</time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
