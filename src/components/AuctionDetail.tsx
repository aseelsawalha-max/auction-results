import type { AuctionRecord } from '../lib/types';
import { StatusBadge } from './ResultsTable';

function formatDateTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Field({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="detail-field">
      <div className="detail-field__label">{label}</div>
      <div className="detail-field__value">{value === undefined || value === '' ? '—' : value}</div>
    </div>
  );
}

export function AuctionDetail({ record, onClose }: { record: AuctionRecord; onClose: () => void }) {
  const extraEntries = Object.entries(record.extra);

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="detail-panel__header">
          <h2>{record.facility ?? 'Unknown Facility'} — Unit {record.unit ?? '—'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="detail-panel__close">✕</button>
        </div>

        <div className="detail-panel__current">
          Current status: <StatusBadge status={record.status} />
        </div>

        <div className="detail-grid">
          <Field label="Facility" value={record.facility} />
          <Field label="Unit" value={record.unit} />
          <Field label="Auction Close" value={record.auctionClose ? formatDateTime(record.auctionClose) : record.auctionCloseRaw} />
          <Field label="Status" value={record.status} />
          <Field label="Winning Bid" value={record.bid !== undefined ? record.bid.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : undefined} />
          <Field label="Winner" value={record.winner} />
          <Field label="Attendees" value={record.attendees} />
          <Field label="Views" value={record.views} />
          <Field label="Void Reason Code" value={record.voidReasonCode} />
          <Field label="Cancel Reason Code" value={record.cancelReasonCode} />
          <Field label="Auction ID" value={record.auctionId} />
        </div>

        {extraEntries.length > 0 && (
          <>
            <h3>Additional LockerFox Fields</h3>
            <div className="detail-grid">
              {extraEntries.map(([k, v]) => (
                <Field key={k} label={k} value={v} />
              ))}
            </div>
          </>
        )}

        <h3>Upload History</h3>
        <div className="detail-meta">
          <div>First seen: {formatDateTime(record.firstSeenAt)}</div>
          <div>Last updated: {formatDateTime(record.lastUpdatedAt)}</div>
          <div>Last seen in an upload: {formatDateTime(record.lastSeenAt)}</div>
          <div>Source file(s): {record.sourceFiles.join(', ')}</div>
        </div>

        {record.history.length > 0 && (
          <ul className="detail-history">
            {[...record.history].reverse().map((h, i) => (
              <li key={i}>
                <strong>{formatDateTime(h.timestamp)}</strong> — {h.sourceFile}
                <ul>
                  {h.changedFields.map((c, j) => (
                    <li key={j}>
                      {c.field}: {c.from ?? '(none)'} → <strong>{c.to}</strong>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
