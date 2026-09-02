import { useState } from 'react';
import { useDataset } from '../hooks/useDataset';
import { useFilters } from '../hooks/useFilters';
import { applyFilters } from '../lib/filters';
import { FiltersBar } from '../components/FiltersBar';
import { ResultsTable } from '../components/ResultsTable';
import { AuctionDetail } from '../components/AuctionDetail';
import type { AuctionRecord } from '../lib/types';

export function FacilityResults() {
  const { dataset, loading, error } = useDataset();
  const { filters } = useFilters();
  const [selected, setSelected] = useState<AuctionRecord | null>(null);
  const [tableSearch, setTableSearch] = useState('');

  const filtered = applyFilters(dataset.records, filters);

  return (
    <div className="page">
      <h1>Facility Results</h1>
      <p className="text-muted">Select a facility and time period to see every unit that went to auction and its final outcome.</p>
      {error && <div className="banner banner--error">{error}</div>}
      <FiltersBar />
      {loading && <p className="text-muted">Loading auction data…</p>}
      {!loading && dataset.records.length === 0 && (
        <p className="text-muted">No auction data yet. Ask an administrator to upload a LockerFox export.</p>
      )}
      {!loading && dataset.records.length > 0 && (
        <ResultsTable
          records={filtered}
          onSelect={setSelected}
          tableSearch={tableSearch}
          onTableSearchChange={setTableSearch}
        />
      )}
      {selected && <AuctionDetail record={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
