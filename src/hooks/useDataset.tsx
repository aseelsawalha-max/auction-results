import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Dataset, UploadResult } from '../lib/types';
import { fetchDataset, persistMergeResult } from '../lib/remoteStore';
import { mergeUpload } from '../lib/merge';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { useAuth } from './useAuth';

const EMPTY_DATASET: Dataset = { records: [], uploads: [] };

interface DatasetContextValue {
  dataset: Dataset;
  loading: boolean;
  error: string | null;
  /** Requires an authenticated admin session; the database enforces this independently. */
  processFile: (file: File) => Promise<UploadResult>;
  refresh: () => Promise<void>;
}

const DatasetContext = createContext<DatasetContextValue | null>(null);

export function DatasetProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [dataset, setDataset] = useState<Dataset>(EMPTY_DATASET);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const datasetRef = useRef(dataset);
  datasetRef.current = dataset;

  async function load() {
    if (!supabase) return;
    try {
      const next = await fetchDataset(supabase);
      setDataset(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load auction data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }
    load();

    // Auto-refresh every viewer's dashboard the moment an admin upload changes
    // the shared database — no manual reload needed.
    const channel = client
      .channel('auction-data-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_records' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'uploads' }, () => load())
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<DatasetContextValue>(
    () => ({
      dataset,
      loading,
      error,
      refresh: load,
      async processFile(file: File) {
        if (!supabase) throw new Error('Supabase is not configured.');
        const userId = session?.user.id;
        if (!userId) throw new Error('You must be signed in as an admin to upload files.');

        const { parseExcelFile } = await import('../lib/parseExcel');
        const parsed = await parseExcelFile(file);
        const now = new Date().toISOString();

        // Re-fetch immediately before merging so two admins uploading close
        // together both merge against the latest shared state, not a stale
        // local copy.
        const current = await fetchDataset(supabase);
        const { dataset: next, result } = mergeUpload(
          current,
          file.name,
          parsed.rows,
          parsed.mapping,
          parsed.unmappedColumns,
          now,
        );

        // Row Level Security re-checks admin status on the database itself;
        // this throws (rather than silently no-oping) if that check fails.
        await persistMergeResult(supabase, next, result, userId);

        setDataset(next);
        return result;
      },
    }),
    [dataset, loading, error, session],
  );

  return <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>;
}

export function useDataset(): DatasetContextValue {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error('useDataset must be used within a DatasetProvider');
  return ctx;
}
