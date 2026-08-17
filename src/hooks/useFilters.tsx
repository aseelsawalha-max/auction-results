import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Filters } from '../lib/filters';
import { EMPTY_FILTERS, latestAuctionDate } from '../lib/filters';
import { useDataset } from './useDataset';

interface FiltersContextValue {
  filters: Filters;
  setFilters: (f: Filters) => void;
  updateFilter: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
}

const FiltersContext = createContext<FiltersContextValue | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const { dataset } = useDataset();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const defaultedOnce = useRef(false);

  // Default the view to the most recent available auction month/year, once,
  // the first time data becomes available. Never overrides a user's own choice afterward.
  useEffect(() => {
    if (defaultedOnce.current) return;
    if (dataset.records.length === 0) return;
    defaultedOnce.current = true;
    const latest = latestAuctionDate(dataset.records);
    if (latest) {
      setFilters((prev) => ({
        ...prev,
        year: String(latest.getFullYear()),
        month: String(latest.getMonth() + 1).padStart(2, '0'),
      }));
    }
  }, [dataset.records]);

  const value: FiltersContextValue = {
    filters,
    setFilters,
    updateFilter: (patch) => setFilters((prev) => ({ ...prev, ...patch })),
    clearFilters: () => setFilters(EMPTY_FILTERS),
  };

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters(): FiltersContextValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used within a FiltersProvider');
  return ctx;
}
