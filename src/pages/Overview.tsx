import { useDataset } from '../hooks/useDataset';
import { useFilters } from '../hooks/useFilters';
import { applyFilters } from '../lib/filters';
import { FiltersBar } from '../components/FiltersBar';
import { KpiCards } from '../components/KpiCards';
import { StatusChart } from '../components/StatusChart';
import { UploadPanel } from '../components/UploadPanel';

export function Overview() {
  const { dataset } = useDataset();
  const { filters } = useFilters();
  const hasData = dataset.records.length > 0;
  const filtered = applyFilters(dataset.records, filters);

  return (
    <div className="page">
      <h1>Overview</h1>
      {!hasData && (
        <p className="text-muted">No auction data yet. Upload the latest LockerFox export to get started.</p>
      )}
      {hasData && (
        <>
          <FiltersBar />
          <KpiCards records={filtered} />
          <StatusChart records={filtered} />
        </>
      )}
      <UploadPanel />
    </div>
  );
}
