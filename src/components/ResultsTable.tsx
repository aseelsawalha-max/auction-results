import { useMemo, useState } from 'react';
import type { AuctionRecord } from '../lib/types';

type SortKey = 'auctionClose' | 'facility' | 'unit' | 'status' | 'bid' | 'winner' | 'attendees' | 'views';

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'auctionClose', label: 'Auction Close' },
  { key: 'facility', label: 'Facility' },
  { key: 'unit', label: 'Unit' },
  { key: 'status', label: 'Status' },
  { key: 'bid', label: 'Bid', align: 'right' },
  { key: 'winner', label: 'Winner' },
  { key: 'attendees', label: 'Attendees', align: 'right' },
  { key: 'views', label: 'Views', align: 'right' },
];

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatBid(bid: number | undefined): string {
  if (bid === undefined) return '—';
  return bid.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function ResultsTable({
  records,
  onSelect,
  tableSearch,
  onTableSearchChange,
}: {
  records: AuctionRecord[];
  onSelect: (record: AuctionRecord) => void;
  tableSearch: string;
  onTableSearchChange: (v: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('auctionClose');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const searched = useMemo(() => {
    const needle = tableSearch.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((r) => {
      const haystack = [r.facility, r.unit, r.status, r.winner, r.voidReasonCode, r.cancelReasonCode]
        .map((v) => (v ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(needle);
    });
  }, [records, tableSearch]);

  const sorted = useMemo(() => {
    const copy = [...searched];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'bid' || sortKey === 'attendees' || sortKey === 'views') {
        cmp = (a[sortKey] ?? -Infinity) - (b[sortKey] ?? -Infinity);
      } else if (sortKey === 'auctionClose') {
        cmp = (a.auctionClose ?? '').localeCompare(b.auctionClose ?? '');
      } else {
        cmp = (a[sortKey] ?? '').toString().localeCompare((b[sortKey] ?? '').toString());
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [searched, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="results-table-wrap">
      <div className="results-table-toolbar">
        <input
          type="text"
          placeholder="Search within these results (unit, winner, status...)"
          value={tableSearch}
          onChange={(e) => onTableSearchChange(e.target.value)}
        />
        <span className="text-muted">{sorted.length} of {records.length} unit(s)</span>
      </div>
      <div className="results-table-scroll">
        <table className="results-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={col.align === 'right' ? 'text-right' : undefined}
                >
                  {col.label}
                  {sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th>Void Reason</th>
              <th>Cancel Reason</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.dedupeKey} onClick={() => onSelect(r)} className="results-table__row">
                <td>{formatDate(r.auctionClose) === '—' && r.auctionCloseRaw ? r.auctionCloseRaw : formatDate(r.auctionClose)}</td>
                <td>{r.facility ?? '—'}</td>
                <td>{r.unit ?? '—'}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="text-right">{formatBid(r.bid)}</td>
                <td>{r.winner ?? '—'}</td>
                <td className="text-right">{r.attendees ?? '—'}</td>
                <td className="text-right">{r.views ?? '—'}</td>
                <td>{r.voidReasonCode ?? '—'}</td>
                <td>{r.cancelReasonCode ?? '—'}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="results-empty-state">
                  <div className="results-empty-state__title">No auction results found for these filters.</div>
                  <div className="text-muted">Try a different facility, month, or status — or clear filters to see everything.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string | undefined }) {
  if (!status) return <span className="text-muted">—</span>;
  const s = status.toUpperCase();
  let tone = 'other';
  if (s === 'SOLD') tone = 'sold';
  else if (s === 'PICKED-UP' || s === 'PICKED UP') tone = 'picked-up';
  else if (s === 'UNSOLD') tone = 'unsold';
  else if (s === 'VOID' || s === 'VOIDED') tone = 'voided';
  else if (s === 'CANCELED' || s === 'CANCELLED') tone = 'canceled';
  return <span className={`status-badge status-badge--${tone}`}>{status}</span>;
}
