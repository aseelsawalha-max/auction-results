// Canonical field names the app understands. Every LockerFox export column
// gets mapped onto one of these (when recognized) plus an `extra` bag for
// anything new/unrecognized so future columns are never dropped.
export type CanonicalField =
  | 'auctionId'
  | 'auctionClose'
  | 'facility'
  | 'unit'
  | 'status'
  | 'attendees'
  | 'views'
  | 'bid'
  | 'winner'
  | 'voidReasonCode'
  | 'cancelReasonCode';

export interface AuctionRecord {
  /** Stable key used for de-duplication/merge across uploads. */
  dedupeKey: string;
  /** True when the key came from a native LockerFox ID rather than a composite guess. */
  dedupeKeyIsNativeId: boolean;

  auctionId?: string;
  auctionClose?: string; // ISO date string, when parseable
  auctionCloseRaw?: string; // original text, always preserved
  facility?: string;
  unit?: string;
  status?: string; // original LockerFox status string, preserved verbatim
  attendees?: number;
  views?: number;
  bid?: number;
  winner?: string;
  voidReasonCode?: string;
  cancelReasonCode?: string;

  /** Any columns LockerFox includes that we don't have a canonical slot for. */
  extra: Record<string, string>;

  /** Bookkeeping. */
  firstSeenAt: string; // ISO timestamp of first upload that introduced this record
  lastUpdatedAt: string; // ISO timestamp of most recent upload that changed this record
  lastSeenAt: string; // ISO timestamp of most recent upload that included this record at all
  sourceFiles: string[]; // filenames this record has appeared in
  history: AuctionRecordChange[];
}

export interface AuctionRecordChange {
  timestamp: string;
  sourceFile: string;
  changedFields: { field: string; from: string | undefined; to: string | undefined }[];
}

export interface UploadWarning {
  severity: 'error' | 'warning';
  message: string;
  rowNumbers?: number[];
}

export interface UploadResult {
  id: string;
  timestamp: string;
  fileName: string;
  totalRowsInFile: number;
  recordsAdded: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  rowsSkipped: number;
  warnings: UploadWarning[];
  detectedColumns: Partial<Record<CanonicalField, string>>;
  unmappedColumns: string[];
}

export interface Dataset {
  records: AuctionRecord[];
  uploads: UploadResult[];
}
