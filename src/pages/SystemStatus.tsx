import { useDataset } from '../hooks/useDataset';
import { UploadPanel } from '../components/UploadPanel';

function formatDateTime(iso: string | undefined): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Never';
  return d.toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function SystemStatus() {
  const { dataset, resetDataset } = useDataset();
  const lastUpload = dataset.uploads[0];

  return (
    <div className="page">
      <h1>Data Refresh / System Status</h1>

      <div className="status-summary">
        <div className="status-summary__item">
          <div className="status-summary__label">Last Updated</div>
          <div className="status-summary__value">{formatDateTime(lastUpload?.timestamp)}</div>
        </div>
        <div className="status-summary__item">
          <div className="status-summary__label">Records Added (last upload)</div>
          <div className="status-summary__value">{lastUpload?.recordsAdded ?? 0}</div>
        </div>
        <div className="status-summary__item">
          <div className="status-summary__label">Records Updated (last upload)</div>
          <div className="status-summary__value">{lastUpload?.recordsUpdated ?? 0}</div>
        </div>
        <div className="status-summary__item">
          <div className="status-summary__label">Total Historical Records</div>
          <div className="status-summary__value">{dataset.records.length}</div>
        </div>
      </div>

      <h2>Upload the Latest LockerFox Export</h2>
      <UploadPanel />

      <h2>Upload History</h2>
      {dataset.uploads.length === 0 ? (
        <p className="text-muted">No uploads yet.</p>
      ) : (
        <div className="upload-history">
          {dataset.uploads.map((u) => (
            <div key={u.id} className="upload-history__item">
              <div className="upload-history__header">
                <strong>{u.fileName}</strong>
                <span className="text-muted">{formatDateTime(u.timestamp)}</span>
              </div>
              <div className="upload-history__stats">
                <span>{u.totalRowsInFile} rows in file</span>
                <span>{u.recordsAdded} added</span>
                <span>{u.recordsUpdated} updated</span>
                <span>{u.recordsUnchanged} unchanged</span>
                {u.rowsSkipped > 0 && <span className="text-warn">{u.rowsSkipped} skipped</span>}
              </div>
              {u.warnings.length > 0 && (
                <ul className="upload-history__warnings">
                  {u.warnings.map((w, i) => (
                    <li key={i} className={w.severity === 'error' ? 'text-warn' : 'text-muted'}>
                      {w.severity === 'error' ? '⚠️ ' : 'ℹ️ '}
                      {w.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <details className="danger-zone">
        <summary>Advanced</summary>
        <p className="text-muted">This clears all locally stored auction history from this browser. Use only if you need to start over.</p>
        <button
          type="button"
          className="button button--danger"
          onClick={() => {
            if (confirm('This will permanently delete all locally stored auction history. Continue?')) {
              resetDataset();
            }
          }}
        >
          Reset all data
        </button>
      </details>
    </div>
  );
}
