import { describe, it, expect } from 'vitest';
import { parseExcelFile } from '../parseExcel';
import { mergeUpload } from '../merge';
import type { Dataset } from '../types';
import { buildXlsxFile } from './testHelpers';

async function upload(
  dataset: Dataset,
  fileName: string,
  rows: Record<string, string | number | Date>[],
  now: string,
  bookType: 'xlsx' | 'biff8' = 'xlsx',
) {
  const file = buildXlsxFile(fileName, rows, bookType);
  const parsed = await parseExcelFile(file);
  return mergeUpload(dataset, fileName, parsed.rows, parsed.mapping, parsed.unmappedColumns, now);
}

describe('LockerFox export merge/dedup', () => {
  it('recognizes columns regardless of filename and adds new records on first upload', async () => {
    const empty: Dataset = { records: [], uploads: [] };
    const { dataset, result } = await upload(
      empty,
      'LockerFox_Export_20260731_143201.xlsx',
      [
        { 'Auction Close': '7/31/2026', Facility: 'LOGO Storage Burnet', Unit: 'H19', Status: 'SOLD', Bid: 10, Winner: 'Jennifer Lopez', Attendees: 4, Views: 22 },
        { 'Auction Close': '7/31/2026', Facility: 'LOGO Storage Burnet', Unit: 'F18', Status: 'PICKED-UP', Bid: 20, Winner: 'Steve Smith', Attendees: 3, Views: 15 },
        { 'Auction Close': '7/31/2026', Facility: 'LOGO Storage Burnet', Unit: 'C2', Status: 'PICKED-UP', Bid: 20, Winner: 'Steve Smith', Attendees: 3, Views: 15 },
        { 'Auction Close': '7/31/2026', Facility: 'LOGO Storage Burnet', Unit: 'A001', Status: 'UNSOLD', Bid: 0, Winner: '', Attendees: 1, Views: 5 },
      ],
      '2026-07-31T20:00:00.000Z',
    );

    expect(result.recordsAdded).toBe(4);
    expect(result.recordsUpdated).toBe(0);
    expect(dataset.records).toHaveLength(4);

    const a001 = dataset.records.find((r) => r.unit === 'A001');
    expect(a001?.status).toBe('UNSOLD');
  });

  it('updates the same auction (UNSOLD -> SOLD) instead of creating a duplicate, on a later upload with a different filename', async () => {
    const empty: Dataset = { records: [], uploads: [] };
    const first = await upload(
      empty,
      'export_A.xlsx',
      [{ 'Auction Close': '7/31/2026', Facility: 'LOGO Storage Burnet', Unit: 'A001', Status: 'UNSOLD', Bid: 0, Winner: '', Attendees: 1, Views: 5 }],
      '2026-07-31T20:00:00.000Z',
    );

    const second = await upload(
      first.dataset,
      'completely_different_filename_9982.xlsx',
      [{ 'Auction Close': '7/31/2026', Facility: 'LOGO Storage Burnet', Unit: 'A001', Status: 'SOLD', Bid: 45, Winner: 'Jennifer Lopez', Attendees: 2, Views: 9 }],
      '2026-07-31T22:00:00.000Z',
    );

    expect(second.dataset.records).toHaveLength(1);
    expect(second.result.recordsAdded).toBe(0);
    expect(second.result.recordsUpdated).toBe(1);

    const record = second.dataset.records[0];
    expect(record.status).toBe('SOLD');
    expect(record.bid).toBe(45);
    expect(record.winner).toBe('Jennifer Lopez');
    expect(record.sourceFiles).toEqual(['export_A.xlsx', 'completely_different_filename_9982.xlsx']);
    expect(record.history).toHaveLength(2);
    expect(record.history[1].changedFields.some((c) => c.field === 'status' && c.from === 'UNSOLD' && c.to === 'SOLD')).toBe(true);
  });

  it('re-uploading an identical file does not create duplicates or spurious updates', async () => {
    const rows = [{ 'Auction Close': '8/1/2026', Facility: 'ABC Storage', Unit: 'Z9', Status: 'VOID', 'Void Reason Code': 'V-12' }];
    const empty: Dataset = { records: [], uploads: [] };
    const first = await upload(empty, 'a.xlsx', rows, '2026-08-01T10:00:00.000Z');
    const second = await upload(first.dataset, 'b_same_data.xlsx', rows, '2026-08-01T12:00:00.000Z');

    expect(second.dataset.records).toHaveLength(1);
    expect(second.result.recordsAdded).toBe(0);
    expect(second.result.recordsUpdated).toBe(0);
    expect(second.result.recordsUnchanged).toBe(1);
  });

  it('prefers a native auction ID for dedup over facility/unit/date when present', async () => {
    const empty: Dataset = { records: [], uploads: [] };
    const first = await upload(
      empty,
      'a.xlsx',
      [{ 'Auction ID': 'LF-99182', 'Auction Close': '8/2/2026', Facility: 'XYZ Storage', Unit: '110', Status: 'UNSOLD' }],
      '2026-08-02T10:00:00.000Z',
    );
    // Same auction ID, but facility name changed slightly (e.g. rename) and unit re-keyed -- should still merge.
    const second = await upload(
      first.dataset,
      'b.xlsx',
      [{ 'Auction ID': 'LF-99182', 'Auction Close': '8/2/2026', Facility: 'XYZ Storage LLC', Unit: '110', Status: 'SOLD', Bid: 5 }],
      '2026-08-02T12:00:00.000Z',
    );

    expect(second.dataset.records).toHaveLength(1);
    expect(second.dataset.records[0].dedupeKeyIsNativeId).toBe(true);
    expect(second.dataset.records[0].status).toBe('SOLD');
    expect(second.dataset.records[0].facility).toBe('XYZ Storage LLC');
  });

  it('reads legacy .xls (BIFF8) exports the same as .xlsx, including real-world column sets with no Winner column', async () => {
    const empty: Dataset = { records: [], uploads: [] };
    const closeDate = new Date(Date.UTC(2026, 6, 31, 10, 0, 0));
    const { dataset, result } = await upload(
      empty,
      'LockerfoxEndedAsOf_20260817_162238UTC.xls',
      [
        { 'Auction Close': closeDate, Facility: 'Ontario Mini Storage', Unit: '29', Status: 'CANCELLED', Attendees: 14, Views: 26, Bid: 20, 'Cancel Reason Code': 'TENANT_PAID' },
        { 'Auction Close': closeDate, Facility: 'Fast & EZ Self Storage - Chandler', Unit: '121', Status: 'SOLD', Attendees: 17, Views: 26, Bid: 20 },
      ],
      '2026-08-17T16:22:38.000Z',
      'biff8',
    );

    expect(result.recordsAdded).toBe(2);
    expect(result.warnings.some((w) => w.severity === 'error')).toBe(false);
    const sold = dataset.records.find((r) => r.unit === '121');
    expect(sold?.status).toBe('SOLD');
    expect(sold?.bid).toBe(20);
    expect(sold?.winner).toBeUndefined(); // this export has no Winner column at all
  });

  it('preserves unrecognized columns as extra fields for future-compatibility', async () => {
    const empty: Dataset = { records: [], uploads: [] };
    const { dataset, result } = await upload(
      empty,
      'a.xlsx',
      [{ Facility: 'ABC Storage', Unit: '5', Status: 'SOLD', 'Buyer Phone': '555-1234', 'New LockerFox Field': 'foo' }],
      '2026-08-03T10:00:00.000Z',
    );
    expect(result.unmappedColumns).toEqual(expect.arrayContaining(['Buyer Phone', 'New LockerFox Field']));
    expect(dataset.records[0].extra['Buyer Phone']).toBe('555-1234');
  });

  it('flags blank facility/unit and unexpected status values without dropping valid rows', async () => {
    const empty: Dataset = { records: [], uploads: [] };
    const { result } = await upload(
      empty,
      'a.xlsx',
      [
        { Facility: '', Unit: '7', Status: 'SOLD' },
        { Facility: 'ABC Storage', Unit: '', Status: 'RELISTED' },
        { Facility: 'ABC Storage', Unit: '8', Status: 'SOLD' },
      ],
      '2026-08-04T10:00:00.000Z',
    );
    expect(result.recordsAdded).toBe(3);
    const messages = result.warnings.map((w) => w.message).join(' | ');
    expect(messages).toMatch(/blank Facility/);
    expect(messages).toMatch(/blank Unit/);
    expect(messages).toMatch(/RELISTED/);
  });

  it('does not duplicate a record when the same auction appears twice within a single file', async () => {
    const empty: Dataset = { records: [], uploads: [] };
    const { dataset, result } = await upload(
      empty,
      'a.xlsx',
      [
        { Facility: 'ABC Storage', Unit: '9', Status: 'UNSOLD', 'Auction Close': '8/5/2026' },
        { Facility: 'ABC Storage', Unit: '9', Status: 'SOLD', 'Auction Close': '8/5/2026', Bid: 12 },
      ],
      '2026-08-05T10:00:00.000Z',
    );
    expect(dataset.records).toHaveLength(1);
    expect(dataset.records[0].status).toBe('SOLD');
    expect(result.warnings.some((w) => w.message.includes('resolved to the same auction'))).toBe(true);
  });
});
