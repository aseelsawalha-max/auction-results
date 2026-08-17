import type { AuctionRecord } from '../lib/types';
import { groupStatus } from '../lib/statusGroups';

function currency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function KpiCards({ records }: { records: AuctionRecord[] }) {
  const counts = { Sold: 0, 'Picked Up': 0, Unsold: 0, Voided: 0, Canceled: 0, Other: 0 } as Record<string, number>;
  let revenue = 0;

  for (const r of records) {
    const group = groupStatus(r.status);
    counts[group]++;
    if (group === 'Sold' || group === 'Picked Up') revenue += r.bid ?? 0;
  }

  const cards = [
    { label: 'Total Units', value: records.length, tone: 'neutral' },
    { label: 'Sold', value: counts.Sold, tone: 'good' },
    { label: 'Picked Up', value: counts['Picked Up'], tone: 'good' },
    { label: 'Unsold', value: counts.Unsold, tone: 'warn' },
    { label: 'Voided', value: counts.Voided, tone: 'warn' },
    { label: 'Canceled', value: counts.Canceled, tone: 'warn' },
    { label: 'Other', value: counts.Other, tone: 'neutral' },
    { label: 'Total Winning Bids', value: currency(revenue), tone: 'accent' },
  ];

  return (
    <div className="kpi-grid">
      {cards.map((c) => (
        <div key={c.label} className={`kpi-card kpi-card--${c.tone}`}>
          <div className="kpi-card__value">{c.value}</div>
          <div className="kpi-card__label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
