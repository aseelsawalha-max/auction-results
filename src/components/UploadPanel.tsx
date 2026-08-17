import { useRef, useState } from 'react';
import { useDataset } from '../hooks/useDataset';
import type { UploadResult } from '../lib/types';

export function UploadPanel() {
  const { processFile } = useDataset();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setLastResult(null);
    try {
      const result = await processFile(file);
      setLastResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to process this file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-panel">
      <div
        className={`upload-dropzone${dragOver ? ' upload-dropzone--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        <div className="upload-dropzone__icon">📂</div>
        <div className="upload-dropzone__text">
          <strong>{busy ? 'Processing…' : 'Drop the latest LockerFox export here'}</strong>
          <span>or click to browse — any .xlsx filename works</span>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      {lastResult && (
        <div className="upload-confirmation">
          <div className="upload-confirmation__title">
            ✅ Processed <strong>{lastResult.fileName}</strong>
          </div>
          <div className="upload-confirmation__stats">
            <span><strong>{lastResult.recordsAdded}</strong> added</span>
            <span><strong>{lastResult.recordsUpdated}</strong> updated</span>
            <span><strong>{lastResult.recordsUnchanged}</strong> unchanged</span>
            {lastResult.rowsSkipped > 0 && <span className="text-warn"><strong>{lastResult.rowsSkipped}</strong> skipped</span>}
          </div>
          {lastResult.warnings.length > 0 && (
            <ul className="upload-confirmation__warnings">
              {lastResult.warnings.map((w, i) => (
                <li key={i} className={w.severity === 'error' ? 'text-warn' : 'text-muted'}>
                  {w.severity === 'error' ? '⚠️ ' : 'ℹ️ '}
                  {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
