import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Dataset, UploadResult } from '../lib/types';
import { loadDataset, saveDataset } from '../lib/store';
import { mergeUpload } from '../lib/merge';

interface DatasetContextValue {
  dataset: Dataset;
  processFile: (file: File) => Promise<UploadResult>;
  resetDataset: () => void;
}

const DatasetContext = createContext<DatasetContextValue | null>(null);

export function DatasetProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<Dataset>(() => loadDataset());

  const value = useMemo<DatasetContextValue>(
    () => ({
      dataset,
      async processFile(file: File) {
        const { parseExcelFile } = await import('../lib/parseExcel');
        const parsed = await parseExcelFile(file);
        const now = new Date().toISOString();
        const { dataset: next, result } = mergeUpload(
          dataset,
          file.name,
          parsed.rows,
          parsed.mapping,
          parsed.unmappedColumns,
          now,
        );
        setDataset(next);
        saveDataset(next);
        return result;
      },
      resetDataset() {
        const empty: Dataset = { records: [], uploads: [] };
        setDataset(empty);
        saveDataset(empty);
      },
    }),
    [dataset],
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): DatasetContextValue {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error('useDataset must be used within a DatasetProvider');
  return ctx;
}
