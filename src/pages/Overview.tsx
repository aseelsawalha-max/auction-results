import { useDataset } from '../hooks/useDataset';
import { useFilters } from '../hooks/useFilters';
import { applyFilters } from '../lib/filters';
import { FiltersBar } from '../components/FiltersBar';
import { KpiCards } from '../components/KpiCards';
import { StatusChart } from '../components/StatusChart';

export function Overview() {
  const { dataset, loading, error } = useDataset();
  const { filters } = useFilters();
  const hasData = dataset.records.length > 0;
  const filtered = applyFilters(dataset.records, filters);

  return (
    <div className="page">
      <h1>Overview</h1>
      {error && <div className="banner banner--error">{error}</div>}
      {loading && <p className="text-muted">Loading auction data…</p>}
      {!loading && !hasData && !error && (
        <p className="text-muted">
          No auction data yet. Ask an administrator to upload the latest LockerFox export.
        </p>
      )}
      {!loading && hasData && (
        <>
          <FiltersBar />
          <KpiCards records={filtered} />
          <StatusChart records={filtered} />
        </>
      )}
    </div>
  );
}
