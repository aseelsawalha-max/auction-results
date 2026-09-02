import { describe, it, expect } from 'vitest';
import { recordToRow, rowToRecord, uploadToRow, rowToUpload } from '../remoteStore';
import type { AuctionRecord, UploadResult } from '../types';

describe('remoteStore row <-> domain mapping', () => {
  it('round-trips a fully populated AuctionRecord through the DB row shape', () => {
    const record: AuctionRecord = {
      dedupeKey: 'composite:logo storage burnet|h19|7/31/2026',
      dedupeKeyIsNativeId: false,
      auctionId: undefined,
      auctionClose: '2026-07-31',
      auctionCloseRaw: '7/31/2026',
      facility: 'LOGO Storage Burnet',
      unit: 'H19',
      status: 'SOLD',
      attendees: 4,
      views: 22,
      bid: 10,
      winner: 'Jennifer Lopez',
      voidReasonCode: undefined,
      cancelReasonCode: undefined,
      extra: { 'Some New Column': 'value' },
      firstSeenAt: '2026-07-31T20:00:00.000Z',
      lastUpdatedAt: '2026-07-31T20:00:00.000Z',
      lastSeenAt: '2026-07-31T20:00:00.000Z',
      sourceFiles: ['export1.xlsx'],
      history: [
        {
          timestamp: '2026-07-31T20:00:00.000Z',
          sourceFile: 'export1.xlsx',
          changedFields: [{ field: 'status', from: undefined, to: 'SOLD' }],
        },
      ],
    };

    const row = recordToRow(record);
    expect(row.dedupe_key).toBe(record.dedupeKey);
    expect(row.auction_id).toBeNull();
    expect(row.facility).toBe('LOGO Storage Burnet');

    const roundTripped = rowToRecord(row);
    expect(roundTripped).toEqual(record);
  });

  it('round-trips a native-ID record with void/cancel codes and no extra fields', () => {
    const record: AuctionRecord = {
      dedupeKey: 'id:9981',
      dedupeKeyIsNativeId: true,
      auctionId: '9981',
      auctionClose: '2026-08-17',
      auctionCloseRaw: '8/17/2026',
      facility: 'LOGO Storage Anderson',
      unit: 'B4',
      status: 'VOID',
      attendees: undefined,
      views: undefined,
      bid: undefined,
      winner: undefined,
      voidReasonCode: 'PAID',
      cancelReasonCode: undefined,
      extra: {},
      firstSeenAt: '2026-08-17T18:00:00.000Z',
      lastUpdatedAt: '2026-08-17T18:00:00.000Z',
      lastSeenAt: '2026-08-17T18:00:00.000Z',
      sourceFiles: ['export2.xlsx'],
      history: [],
    };

    const row = recordToRow(record);
    expect(row.void_reason_code).toBe('PAID');
    expect(row.cancel_reason_code).toBeNull();

    expect(rowToRecord(row)).toEqual(record);
  });

  it('round-trips an UploadResult through the DB row shape', () => {
    const upload: UploadResult = {
      id: 'upload_2026-08-17T18:00:00.000Z_ab12cd',
      timestamp: '2026-08-17T18:00:00.000Z',
      fileName: 'LF_Report_2026-08-17_updated_9981.xlsx',
      totalRowsInFile: 134,
      recordsAdded: 12,
      recordsUpdated: 5,
      recordsUnchanged: 117,
      rowsSkipped: 0,
      warnings: [{ severity: 'warning', message: 'Example warning', rowNumbers: [3, 4] }],
      detectedColumns: { facility: 'Facility', unit: 'Unit', status: 'Status' },
      unmappedColumns: ['Extra Column'],
    };

    const row = uploadToRow(upload);
    expect(row.file_name).toBe(upload.fileName);
    expect(row.total_rows_in_file).toBe(134);

    expect(rowToUpload(row)).toEqual(upload);
  });

  it('defaults missing jsonb/array columns to empty values when reading a row', () => {
    const row = {
      dedupe_key: 'composite:x|y|z',
      dedupe_key_is_native_id: false,
      auction_id: null,
      auction_close: null,
      auction_close_raw: null,
      facility: 'X',
      unit: 'Y',
      status: 'UNSOLD',
      attendees: null,
      views: null,
      bid: null,
      winner: null,
      void_reason_code: null,
      cancel_reason_code: null,
      extra: null as unknown as Record<string, string>,
      first_seen_at: '2026-01-01T00:00:00.000Z',
      last_updated_at: '2026-01-01T00:00:00.000Z',
      last_seen_at: '2026-01-01T00:00:00.000Z',
      source_files: null as unknown as string[],
      history: null as unknown as AuctionRecord['history'],
    };

    const record = rowToRecord(row);
    expect(record.extra).toEqual({});
    expect(record.sourceFiles).toEqual([]);
    expect(record.history).toEqual([]);
  });
});
