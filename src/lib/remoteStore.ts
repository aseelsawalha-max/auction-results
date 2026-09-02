import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuctionRecord, Dataset, UploadResult, UploadWarning, CanonicalField } from './types';

/** Row shape of the `auction_records` table (see supabase/migrations/0001_init.sql). */
export interface AuctionRecordRow {
  dedupe_key: string;
  dedupe_key_is_native_id: boolean;
  auction_id: string | null;
  auction_close: string | null;
  auction_close_raw: string | null;
  facility: string | null;
  unit: string | null;
  status: string | null;
  attendees: number | null;
  views: number | null;
  bid: number | null;
  winner: string | null;
  void_reason_code: string | null;
  cancel_reason_code: string | null;
  extra: Record<string, string>;
  first_seen_at: string;
  last_updated_at: string;
  last_seen_at: string;
  source_files: string[];
  history: AuctionRecord['history'];
}

/** Row shape of the `uploads` table. */
export interface UploadRow {
  id: string;
  timestamp: string;
  file_name: string;
  total_rows_in_file: number;
  records_added: number;
  records_updated: number;
  records_unchanged: number;
  rows_skipped: number;
  warnings: UploadWarning[];
  detected_columns: Partial<Record<CanonicalField, string>>;
  unmapped_columns: string[];
}

function undefToNull<T>(v: T | undefined): T | null {
  return v === undefined ? null : v;
}
function nullToUndef<T>(v: T | null): T | undefined {
  return v === null ? undefined : v;
}

export function recordToRow(r: AuctionRecord): AuctionRecordRow {
  return {
    dedupe_key: r.dedupeKey,
    dedupe_key_is_native_id: r.dedupeKeyIsNativeId,
    auction_id: undefToNull(r.auctionId),
    auction_close: undefToNull(r.auctionClose),
    auction_close_raw: undefToNull(r.auctionCloseRaw),
    facility: undefToNull(r.facility),
    unit: undefToNull(r.unit),
    status: undefToNull(r.status),
    attendees: undefToNull(r.attendees),
    views: undefToNull(r.views),
    bid: undefToNull(r.bid),
    winner: undefToNull(r.winner),
    void_reason_code: undefToNull(r.voidReasonCode),
    cancel_reason_code: undefToNull(r.cancelReasonCode),
    extra: r.extra,
    first_seen_at: r.firstSeenAt,
    last_updated_at: r.lastUpdatedAt,
    last_seen_at: r.lastSeenAt,
    source_files: r.sourceFiles,
    history: r.history,
  };
}

export function rowToRecord(row: AuctionRecordRow): AuctionRecord {
  return {
    dedupeKey: row.dedupe_key,
    dedupeKeyIsNativeId: row.dedupe_key_is_native_id,
    auctionId: nullToUndef(row.auction_id),
    auctionClose: nullToUndef(row.auction_close),
    auctionCloseRaw: nullToUndef(row.auction_close_raw),
    facility: nullToUndef(row.facility),
    unit: nullToUndef(row.unit),
    status: nullToUndef(row.status),
    attendees: nullToUndef(row.attendees),
    views: nullToUndef(row.views),
    bid: nullToUndef(row.bid),
    winner: nullToUndef(row.winner),
    voidReasonCode: nullToUndef(row.void_reason_code),
    cancelReasonCode: nullToUndef(row.cancel_reason_code),
    extra: row.extra ?? {},
    firstSeenAt: row.first_seen_at,
    lastUpdatedAt: row.last_updated_at,
    lastSeenAt: row.last_seen_at,
    sourceFiles: row.source_files ?? [],
    history: row.history ?? [],
  };
}

export function uploadToRow(u: UploadResult): UploadRow {
  return {
    id: u.id,
    timestamp: u.timestamp,
    file_name: u.fileName,
    total_rows_in_file: u.totalRowsInFile,
    records_added: u.recordsAdded,
    records_updated: u.recordsUpdated,
    records_unchanged: u.recordsUnchanged,
    rows_skipped: u.rowsSkipped,
    warnings: u.warnings,
    detected_columns: u.detectedColumns,
    unmapped_columns: u.unmappedColumns,
  };
}

export function rowToUpload(row: UploadRow): UploadResult {
  return {
    id: row.id,
    timestamp: row.timestamp,
    fileName: row.file_name,
    totalRowsInFile: row.total_rows_in_file,
    recordsAdded: row.records_added,
    recordsUpdated: row.records_updated,
    recordsUnchanged: row.records_unchanged,
    rowsSkipped: row.rows_skipped,
    warnings: row.warnings ?? [],
    detectedColumns: row.detected_columns ?? {},
    unmappedColumns: row.unmapped_columns ?? [],
  };
}

const UPSERT_BATCH_SIZE = 500;

/** Pulls the full current dataset from the shared database. This is the single source of truth. */
export async function fetchDataset(client: SupabaseClient): Promise<Dataset> {
  const [recordsRes, uploadsRes] = await Promise.all([
    client.from('auction_records').select('*'),
    client.from('uploads').select('*').order('timestamp', { ascending: false }),
  ]);

  if (recordsRes.error) throw new Error(`Failed to load auction records: ${recordsRes.error.message}`);
  if (uploadsRes.error) throw new Error(`Failed to load upload history: ${uploadsRes.error.message}`);

  return {
    records: (recordsRes.data as AuctionRecordRow[]).map(rowToRecord),
    uploads: (uploadsRes.data as UploadRow[]).map(rowToUpload),
  };
}

/**
 * Persists the result of a merge to the shared database: upserts every
 * current record (keyed by dedupe_key, so re-processing the same auction
 * never creates a duplicate row) and appends one upload log entry.
 *
 * Requires an authenticated admin session — enforced independently by the
 * database's Row Level Security policies (see supabase/migrations), so this
 * throws if the caller isn't an authorized admin even if the request is
 * somehow sent without going through the Admin UI.
 */
export async function persistMergeResult(
  client: SupabaseClient,
  dataset: Dataset,
  uploadResult: UploadResult,
  adminUserId: string,
): Promise<void> {
  const rows = dataset.records.map((r) => ({ ...recordToRow(r), updated_by: adminUserId }));

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await client.from('auction_records').upsert(chunk, { onConflict: 'dedupe_key' });
    if (error) throw new Error(`Failed to save auction records: ${error.message}`);
  }

  const { error: uploadError } = await client
    .from('uploads')
    .insert({ ...uploadToRow(uploadResult), uploaded_by: adminUserId });
  if (uploadError) throw new Error(`Failed to record upload history: ${uploadError.message}`);
}
