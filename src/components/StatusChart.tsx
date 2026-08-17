import type { AuctionRecord } from '../lib/types';
import { groupStatus, STATUS_GROUP_ORDER } from '../lib/statusGroups';

const GROUP_COLORS: Record<string, string> = {
  Sold: '#2f8f4e',
  'Picked Up': '#3b7dd8',
  Unsold: '#c98a1b',
  Voided: '#b23b3b',
  Canceled: '#7a5ac9',
  Other: '#6b7280',
};

export function StatusChart({ records }: { records: AuctionRecord[] }) {
  const counts = new Map<string, number>();
  for (const r of records) {
    const g = groupStatus(r.status);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const total = records.length || 1;

  return (
    <div className="status-chart">
      <h3 className="status-chart__title">Outcomes by Status</h3>
      <div className="status-chart__bars">
        {STATUS_GROUP_ORDER.map((group) => {
          const count = counts.get(group) ?? 0;
          const pct = Math.round((count / total) * 100);
          return (
            <div className="status-chart__row" key={group}>
              <div className="status-chart__label">{group}</div>
              <div className="status-chart__track">
                <div
                  className="status-chart__fill"
                  style={{ width: `${pct}%`, background: GROUP_COLORS[group] }}
                />
              </div>
              <div className="status-chart__value">{count} ({pct}%)</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
