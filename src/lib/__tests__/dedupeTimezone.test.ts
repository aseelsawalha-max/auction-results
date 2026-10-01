import { describe, it, expect } from 'vitest';
import { parseExcelFile } from '../parseExcel';
import { mergeUpload } from '../merge';
import { auctionCloseDayKey, excelCellDateToISO, parseDateFlexible, wallClockToUTC } from '../normalize';
import { EXPORT_CLOCK, parseExportClock, type ExportClock } from '../exportClock';
import type { AuctionRecord, Dataset } from '../types';
import { buildXlsxFile } from './testHelpers';

/**
 * Regression tests for a production data-duplication incident.
 *
 * LockerFox showed 104 September PICKED-UP auctions; the dashboard showed 203.
 * Supabase held 99 duplicate pairs such as:
 *
 *   Facility "Affordable Self Storage USA Inc - 2553 Atlantic", Unit 238,
 *   auction_close_raw "2026-09-23T14:02:00.000Z"  (dedupe_key ...|...t14:02:00.000z)
 *   auction_close_raw "2026-09-23T07:02:00.000Z"  (dedupe_key ...|...t07:02:00.000z)
 *
 * LockerFox's own Auction Report shows this auction ending "Wed 9/23/26
 * 10:02 AM EDT" = 14:02 UTC, so the 14:02Z record is correct and 07:02Z is
 * the timezone-shifted duplicate.
 *
 * Root cause: the export's date cell holds the wall-clock value 07:02 (the
 * export is UTC-07:00). SheetJS turns that cell into a Date using the
 * uploader's *local* timezone, and parseExcel called toISOString() on it: a
 * UTC browser produced "07:02Z" (wrong), an Arizona/Pacific browser "14:02Z"
 * (right only by coincidence). That text was embedded in the composite dedupe
 * key, so one auction got two keys.
 */

const FACILITY = 'Affordable Self Storage USA Inc - 2553 Atlantic';
const UNIT = '238';
// The sheet's wall-clock close time from the incident. Constructed with the
// local-time constructor because that is exactly how SheetJS hands a date
// cell to us: wall-clock components in the browser's local timezone.
const SHEET_WALL_CLOCK = new Date(2026, 8, 23, 7, 2, 0);
const CORRECT_RAW = '2026-09-23T14:02:00.000Z'; // 10:02 AM EDT per LockerFox
const WRONG_RAW_FROM_UTC_BROWSER = '2026-09-23T07:02:00.000Z';

const OFFSET_MINUS_7 = parseExportClock('-07:00')!;
const OFFSET_MINUS_8 = parseExportClock('-08:00')!;
const ZONE_LA = parseExportClock('America/Los_Angeles')!;
const ZONE_PHOENIX = parseExportClock('America/Phoenix')!;

/** A record exactly as it sits in production under the old full-timestamp key. */
function legacyRecord(raw: string, overrides: Partial<AuctionRecord> = {}): AuctionRecord {
  const seen = overrides.lastSeenAt ?? '2026-09-24T10:00:00.000Z';
  return {
    dedupeKey: `composite:${FACILITY.toLowerCase()}|${UNIT}|${raw.toLowerCase()}`,
    dedupeKeyIsNativeId: false,
    auctionClose: '2026-09-23', // DATE column: time-of-day already lost
    auctionCloseRaw: raw,
    facility: FACILITY,
    unit: UNIT,
    status: 'PICKED-UP',
    attendees: 12,
    views: 40,
    bid: 85,
    extra: {},
    firstSeenAt: seen,
    lastUpdatedAt: seen,
    lastSeenAt: seen,
    sourceFiles: ['LockerfoxEndedAsOf_20260924_100000UTC.xls'],
    history: [],
    ...overrides,
  };
}

async function uploadSheet(
  dataset: Dataset,
  fileName: string,
  rows: Record<string, string | number | Date>[],
  now: string,
  clock: ExportClock = EXPORT_CLOCK,
) {
  const file = buildXlsxFile(fileName, rows, 'biff8');
  const parsed = await parseExcelFile(file, clock);
  return mergeUpload(dataset, fileName, parsed.rows, parsed.mapping, parsed.unmappedColumns, now);
}

const LOCKERFOX_ROW = {
  'Auction Close': SHEET_WALL_CLOCK,
  Facility: FACILITY,
  Unit: UNIT,
  Status: 'PICKED-UP',
  Attendees: 12,
  Views: 40,
  Bid: 85,
};

const EMPTY: Dataset = { records: [], uploads: [] };

describe('export clock configuration', () => {
  it('defaults to the observed fixed -07:00 offset, assuming no DST rule', () => {
    expect(EXPORT_CLOCK).toEqual({ kind: 'offset', minutes: -420, label: 'UTC−07:00 (fixed offset)' });
  });

  it('accepts a fixed offset or an IANA zone, and rejects anything else', () => {
    expect(parseExportClock('+05:30')).toMatchObject({ kind: 'offset', minutes: 330 });
    expect(parseExportClock('America/Phoenix')).toMatchObject({ kind: 'zone', name: 'America/Phoenix' });
    expect(parseExportClock('Mars/Olympus_Mons')).toBeUndefined();
    expect(parseExportClock('-7')).toBeUndefined();
    expect(parseExportClock('-15:00')).toBeUndefined();
  });
});

describe('Excel date cells are converted with the export clock, identically in every browser timezone', () => {
  it('a fixed -07:00 offset converts the spot-checked value to the LockerFox-confirmed instant', () => {
    expect(wallClockToUTC(2026, 8, 23, 7, 2, 0, 0, OFFSET_MINUS_7).toISOString()).toBe(CORRECT_RAW);
  });

  it('a fixed offset applies no DST rule: January converts with the same 7 hours', () => {
    expect(wallClockToUTC(2026, 0, 15, 7, 2, 0, 0, OFFSET_MINUS_7).toISOString()).toBe('2026-01-15T14:02:00.000Z');
  });

  it('an IANA zone (if the export turns out to follow DST) is resolved DST-aware', () => {
    expect(wallClockToUTC(2026, 8, 23, 7, 2, 0, 0, ZONE_LA).toISOString()).toBe(CORRECT_RAW);
    expect(wallClockToUTC(2026, 0, 15, 7, 2, 0, 0, ZONE_LA).toISOString()).toBe('2026-01-15T15:02:00.000Z');
    expect(wallClockToUTC(2026, 0, 15, 7, 2, 0, 0, ZONE_PHOENIX).toISOString()).toBe('2026-01-15T14:02:00.000Z');
    // The hour right after the spring-forward gap resolves sensibly (no NaN, no double shift).
    expect(wallClockToUTC(2026, 2, 8, 3, 30, 0, 0, ZONE_LA).toISOString()).toBe('2026-03-08T10:30:00.000Z');
  });

  it('excelCellDateToISO holds in whatever timezone this test process runs in', () => {
    // CI runs the suite under several TZ values; a plain toISOString() would
    // only produce the correct instant under a UTC-7 process timezone.
    expect(excelCellDateToISO(SHEET_WALL_CLOCK, OFFSET_MINUS_7)).toBe(CORRECT_RAW);
  });

  it('a genuine .xls date cell parses to the correct UTC instant with the default clock', async () => {
    const file = buildXlsxFile('LockerfoxEndedAsOf_20260923_120000UTC.xls', [LOCKERFOX_ROW], 'biff8');
    const parsed = await parseExcelFile(file);
    expect(parsed.rows[0].values['Auction Close']).toBe(CORRECT_RAW);
  });

  it('parseDateFlexible anchors naive US-style text as UTC (text cells carry no zone)', () => {
    expect(parseDateFlexible('9/23/2026')).toBe('2026-09-23T00:00:00.000Z');
    expect(parseDateFlexible('9/23/2026 7:02 AM')).toBe('2026-09-23T07:02:00.000Z');
  });
});

describe('auctionCloseDayKey (identity day, pure string parsing)', () => {
  it('extracts the same day from every representation of the same close', () => {
    expect(auctionCloseDayKey(CORRECT_RAW)).toBe('2026-09-23');
    expect(auctionCloseDayKey(WRONG_RAW_FROM_UTC_BROWSER)).toBe('2026-09-23');
    expect(auctionCloseDayKey('2026-09-23')).toBe('2026-09-23');
    expect(auctionCloseDayKey('9/23/2026')).toBe('2026-09-23');
    expect(auctionCloseDayKey('9/23/26 7:02 AM')).toBe('2026-09-23');
  });

  it('returns undefined for unparseable text so the caller falls back to the raw value', () => {
    expect(auctionCloseDayKey('TBD')).toBeUndefined();
    expect(auctionCloseDayKey('')).toBeUndefined();
    expect(auctionCloseDayKey(undefined)).toBeUndefined();
  });
});

describe('the same auction never becomes two records', () => {
  it('the exact production pair (14:02Z and 07:02Z raws) now resolves to one record', () => {
    // Feed the merge the two raw strings two differently-zoned browsers used
    // to produce, without going through the (now fixed) parser: even if a
    // shifted value sneaks in, identity is the close *day*, so they merge.
    const mapping = { auctionClose: 'Auction Close', facility: 'Facility', unit: 'Unit', status: 'Status' };
    const row = (raw: string) => [{ rowNumber: 2, values: { 'Auction Close': raw, Facility: FACILITY, Unit: UNIT, Status: 'PICKED-UP' } }];

    const first = mergeUpload(EMPTY, 'from_arizona_browser.xls', row(CORRECT_RAW), mapping, [], '2026-09-24T10:00:00.000Z');
    const second = mergeUpload(first.dataset, 'from_utc_browser.xls', row(WRONG_RAW_FROM_UTC_BROWSER), mapping, [], '2026-09-24T12:00:00.000Z');

    expect(second.dataset.records).toHaveLength(1);
    expect(second.result.recordsAdded).toBe(0);
    expect(second.dataset.records[0].dedupeKey).toBe(`composite:${FACILITY.toLowerCase()}|${UNIT}|2026-09-23`);
  });

  it('matches a record stored under the OLD full-timestamp key with the WRONG raw, keeps that key, and corrects the raw', async () => {
    const dataset: Dataset = { records: [legacyRecord(WRONG_RAW_FROM_UTC_BROWSER)], uploads: [] };
    const legacyKey = dataset.records[0].dedupeKey;

    const { dataset: after, result } = await uploadSheet(dataset, 'LockerfoxEndedAsOf_20260925_100000UTC.xls', [LOCKERFOX_ROW], '2026-09-25T10:00:00.000Z');

    expect(after.records).toHaveLength(1);
    expect(result.recordsAdded).toBe(0);
    // Same database row: the key is unchanged so the upsert updates in place
    // (no migration needed for the fix to stop creating duplicates).
    expect(after.records[0].dedupeKey).toBe(legacyKey);
    // The stored raw was the timezone-shifted one; it is corrected once, and
    // that correction is recorded in history rather than hidden.
    expect(result.recordsUpdated).toBe(1);
    expect(after.records[0].auctionCloseRaw).toBe(CORRECT_RAW);
    expect(after.records[0].history.at(-1)?.changedFields).toEqual([
      { field: 'auctionCloseRaw', from: WRONG_RAW_FROM_UTC_BROWSER, to: CORRECT_RAW },
    ]);
  });

  it('after that one-time correction, re-uploading the same file reports nothing updated', async () => {
    const dataset: Dataset = { records: [legacyRecord(WRONG_RAW_FROM_UTC_BROWSER)], uploads: [] };
    const first = await uploadSheet(dataset, 'LockerfoxEndedAsOf_20260925_100000UTC.xls', [LOCKERFOX_ROW], '2026-09-25T10:00:00.000Z');
    const second = await uploadSheet(first.dataset, 'LockerfoxEndedAsOf_20260925_120000UTC.xls', [LOCKERFOX_ROW], '2026-09-25T12:00:00.000Z');

    expect(second.dataset.records).toHaveLength(1);
    expect(second.result.recordsAdded).toBe(0);
    expect(second.result.recordsUpdated).toBe(0);
    expect(second.result.recordsUnchanged).toBe(1);
  });

  it('a record already stored with the correct raw is simply unchanged on re-upload', async () => {
    const dataset: Dataset = { records: [legacyRecord(CORRECT_RAW)], uploads: [] };
    const { dataset: after, result } = await uploadSheet(dataset, 'again.xls', [LOCKERFOX_ROW], '2026-09-25T10:00:00.000Z');
    expect(after.records).toHaveLength(1);
    expect(result.recordsUpdated).toBe(0);
    expect(result.recordsUnchanged).toBe(1);
  });

  it('with a pre-existing duplicate pair, the copy with the LockerFox-confirmed (later) instant is the survivor that gets updated', async () => {
    // The correct twin is deliberately the *older* one by last_seen_at, to
    // prove the close instant is the primary survivor criterion.
    const dataset: Dataset = {
      records: [
        legacyRecord(CORRECT_RAW, { lastSeenAt: '2026-09-24T10:00:00.000Z', lastUpdatedAt: '2026-09-24T10:00:00.000Z' }),
        legacyRecord(WRONG_RAW_FROM_UTC_BROWSER, { lastSeenAt: '2026-09-24T12:00:00.000Z', lastUpdatedAt: '2026-09-24T12:00:00.000Z' }),
      ],
      uploads: [],
    };

    const { dataset: after, result } = await uploadSheet(
      dataset,
      'LockerfoxEndedAsOf_20260925_100000UTC.xls',
      [{ ...LOCKERFOX_ROW, Status: 'SOLD' }],
      '2026-09-25T10:00:00.000Z',
    );

    expect(after.records).toHaveLength(2); // the stale twin is left for the cleanup, not deleted here
    expect(result.recordsAdded).toBe(0);
    expect(result.recordsUpdated).toBe(1);
    const survivor = after.records.find((r) => r.auctionCloseRaw === CORRECT_RAW);
    const twin = after.records.find((r) => r.auctionCloseRaw === WRONG_RAW_FROM_UTC_BROWSER);
    expect(survivor?.status).toBe('SOLD');
    expect(twin?.status).toBe('PICKED-UP');
    const dupWarnings = result.warnings.filter((w) => w.message.includes('more than one stored record'));
    expect(dupWarnings).toHaveLength(1);
    expect(dupWarnings[0].message).toMatch(/^1 auction\(s\)/);
  });

  it('survivor choice is deterministic regardless of record order', async () => {
    const a = legacyRecord(WRONG_RAW_FROM_UTC_BROWSER, { lastSeenAt: '2026-09-24T12:00:00.000Z', lastUpdatedAt: '2026-09-24T12:00:00.000Z' });
    const b = legacyRecord(CORRECT_RAW, { lastSeenAt: '2026-09-24T10:00:00.000Z', lastUpdatedAt: '2026-09-24T10:00:00.000Z' });
    const row = [{ ...LOCKERFOX_ROW, Status: 'SOLD' }];
    const r1 = await uploadSheet({ records: [a, b], uploads: [] }, 'x.xls', row, '2026-09-25T10:00:00.000Z');
    const r2 = await uploadSheet({ records: [structuredClone(b), structuredClone(a)], uploads: [] }, 'x.xls', row, '2026-09-25T10:00:00.000Z');
    const updatedKey = (ds: Dataset) => ds.records.find((r) => r.status === 'SOLD')?.dedupeKey;
    expect(updatedKey(r1.dataset)).toBe(updatedKey(r2.dataset));
    expect(updatedKey(r1.dataset)).toBe(b.dedupeKey);
  });

  it('matches a legacy record whose timezone shift crossed midnight (different calendar day)', async () => {
    // A browser east of UTC (e.g. UTC+9) stored wall-clock 07:02 on the 23rd
    // as 22:02 on the 22nd, so even the identity *day* differs.
    const dataset: Dataset = { records: [legacyRecord('2026-09-22T22:02:00.000Z', { auctionClose: '2026-09-22' })], uploads: [] };
    const legacyKey = dataset.records[0].dedupeKey;

    const { dataset: after, result } = await uploadSheet(dataset, 'next.xls', [LOCKERFOX_ROW], '2026-09-25T10:00:00.000Z');

    expect(after.records).toHaveLength(1);
    expect(result.recordsAdded).toBe(0);
    expect(after.records[0].dedupeKey).toBe(legacyKey);
    expect(after.records[0].auctionCloseRaw).toBe(CORRECT_RAW);
    expect(result.warnings.some((w) => w.message.includes('less than 24 hours'))).toBe(true);
  });

  it('changing the export clock later cannot duplicate a record, even when the UTC day flips — it corrects once', async () => {
    // Wall-clock 16:30 is 23:30Z under -07:00 but 00:30Z the next day under
    // -08:00, so the identity day differs. The proximity fallback (1h apart,
    // same facility and unit) must find it.
    const eveningClose = { ...LOCKERFOX_ROW, 'Auction Close': new Date(2026, 8, 23, 16, 30, 0) };
    const stored = await uploadSheet(EMPTY, 'a.xls', [eveningClose], '2026-09-24T10:00:00.000Z', OFFSET_MINUS_7);
    expect(stored.dataset.records[0].auctionCloseRaw).toBe('2026-09-23T23:30:00.000Z');
    expect(stored.dataset.records[0].dedupeKey).toMatch(/\|2026-09-23$/);

    const reconfigured = await uploadSheet(stored.dataset, 'b.xls', [eveningClose], '2026-09-25T10:00:00.000Z', OFFSET_MINUS_8);
    expect(reconfigured.dataset.records).toHaveLength(1);
    expect(reconfigured.result.recordsAdded).toBe(0);
    expect(reconfigured.result.recordsUpdated).toBe(1);
    expect(reconfigured.dataset.records[0].auctionCloseRaw).toBe('2026-09-24T00:30:00.000Z');
    expect(reconfigured.dataset.records[0].dedupeKey).toMatch(/\|2026-09-23$/); // key kept: same DB row

    const again = await uploadSheet(reconfigured.dataset, 'c.xls', [eveningClose], '2026-09-25T12:00:00.000Z', OFFSET_MINUS_8);
    expect(again.dataset.records).toHaveLength(1);
    expect(again.result.recordsUpdated).toBe(0);
    expect(again.result.recordsUnchanged).toBe(1);
  });
});

describe('the proximity fallback cannot merge two legitimate auctions', () => {
  it('the same unit relisted and closing a week later is a separate auction', async () => {
    const unsoldRow = { ...LOCKERFOX_ROW, Status: 'UNSOLD', Bid: 0 };
    const first = await uploadSheet(EMPTY, 'a.xls', [unsoldRow], '2026-09-24T10:00:00.000Z');
    // The later export still lists the earlier (unsold) auction alongside the relist.
    const relisted = { ...LOCKERFOX_ROW, 'Auction Close': new Date(2026, 8, 30, 7, 2, 0), Status: 'SOLD' };
    const second = await uploadSheet(first.dataset, 'b.xls', [unsoldRow, relisted], '2026-10-01T10:00:00.000Z');

    expect(second.dataset.records).toHaveLength(2);
    expect(second.result.recordsAdded).toBe(1);
    expect(second.result.recordsUpdated).toBe(0);
    expect(second.result.recordsUnchanged).toBe(1);
    expect(second.dataset.records.map((r) => r.dedupeKey).sort()).toEqual([
      `composite:${FACILITY.toLowerCase()}|${UNIT}|2026-09-23`,
      `composite:${FACILITY.toLowerCase()}|${UNIT}|2026-09-30`,
    ]);
    const unsold = second.dataset.records.find((r) => r.dedupeKey.endsWith('2026-09-23'));
    expect(unsold?.status).toBe('UNSOLD'); // the earlier auction's outcome is untouched
  });

  it('closes on adjacent calendar days exactly 24 hours apart stay separate (the window is strictly less than 24h)', async () => {
    const first = await uploadSheet(EMPTY, 'a.xls', [LOCKERFOX_ROW], '2026-09-24T10:00:00.000Z');
    const nextDay = { ...LOCKERFOX_ROW, 'Auction Close': new Date(2026, 8, 24, 7, 2, 0), Status: 'SOLD' };
    const second = await uploadSheet(first.dataset, 'b.xls', [nextDay], '2026-09-25T10:00:00.000Z');
    expect(second.dataset.records).toHaveLength(2);
    expect(second.result.recordsAdded).toBe(1);
    expect(second.result.warnings.some((w) => w.message.includes('less than 24 hours'))).toBe(false);
  });

  it('sharing a facility and unit is never enough on its own: a close more than a day away is not matched', async () => {
    const first = await uploadSheet(EMPTY, 'a.xls', [LOCKERFOX_ROW], '2026-09-24T10:00:00.000Z');
    const later = { ...LOCKERFOX_ROW, 'Auction Close': new Date(2026, 8, 25, 7, 2, 0) };
    const second = await uploadSheet(first.dataset, 'b.xls', [later], '2026-09-26T10:00:00.000Z');
    expect(second.dataset.records).toHaveLength(2);
    expect(second.result.recordsAdded).toBe(1);
  });

  it('a different unit at the same facility closing at the same instant is a separate auction', async () => {
    const { dataset } = await uploadSheet(EMPTY, 'a.xls', [LOCKERFOX_ROW, { ...LOCKERFOX_ROW, Unit: '239' }], '2026-09-24T10:00:00.000Z');
    expect(dataset.records).toHaveLength(2);
  });

  it('the same unit at a different facility closing at the same instant is a separate auction', async () => {
    const { dataset } = await uploadSheet(EMPTY, 'a.xls', [LOCKERFOX_ROW, { ...LOCKERFOX_ROW, Facility: 'Affordable Self Storage USA Inc - 100 Main' }], '2026-09-24T10:00:00.000Z');
    expect(dataset.records).toHaveLength(2);
  });

  it('a row with a blank unit is never proximity-matched to another blank-unit row', async () => {
    const mapping = { auctionClose: 'Auction Close', facility: 'Facility', unit: 'Unit', status: 'Status' };
    const row = (raw: string, status: string) => [{ rowNumber: 2, values: { 'Auction Close': raw, Facility: FACILITY, Unit: '', Status: status } }];
    const first = mergeUpload(EMPTY, 'a.xls', row('2026-09-23T14:02:00.000Z', 'SOLD'), mapping, [], '2026-09-24T10:00:00.000Z');
    const second = mergeUpload(first.dataset, 'b.xls', row('2026-09-24T02:00:00.000Z', 'UNSOLD'), mapping, [], '2026-09-25T10:00:00.000Z');
    expect(second.dataset.records).toHaveLength(2);
  });

  it('a row with a native auction ID is never proximity-matched', async () => {
    const mapping = { auctionId: 'Auction ID', auctionClose: 'Auction Close', facility: 'Facility', unit: 'Unit', status: 'Status' };
    const row = (id: string, raw: string) => [{ rowNumber: 2, values: { 'Auction ID': id, 'Auction Close': raw, Facility: FACILITY, Unit: UNIT, Status: 'SOLD' } }];
    const first = mergeUpload(EMPTY, 'a.xls', row('LF-1', '2026-09-23T14:02:00.000Z'), mapping, [], '2026-09-24T10:00:00.000Z');
    const second = mergeUpload(first.dataset, 'b.xls', row('LF-2', '2026-09-23T15:02:00.000Z'), mapping, [], '2026-09-25T10:00:00.000Z');
    expect(second.dataset.records).toHaveLength(2);
  });

  it('a row whose close time is unparseable is never proximity-matched', async () => {
    const mapping = { auctionClose: 'Auction Close', facility: 'Facility', unit: 'Unit', status: 'Status' };
    const first = await uploadSheet(EMPTY, 'a.xls', [LOCKERFOX_ROW], '2026-09-24T10:00:00.000Z');
    const second = mergeUpload(first.dataset, 'b.xls', [{ rowNumber: 2, values: { 'Auction Close': 'TBD', Facility: FACILITY, Unit: UNIT, Status: 'SOLD' } }], mapping, [], '2026-09-25T10:00:00.000Z');
    expect(second.dataset.records).toHaveLength(2);
  });
});

describe('legitimate changes are still detected', () => {
  it('a status change on the same auction is an update, not a new record', async () => {
    const first = await uploadSheet(EMPTY, 'a.xls', [{ ...LOCKERFOX_ROW, Status: 'UNSOLD', Bid: 0 }], '2026-09-24T10:00:00.000Z');
    const second = await uploadSheet(first.dataset, 'b.xls', [{ ...LOCKERFOX_ROW, Status: 'PICKED-UP', Bid: 85 }], '2026-09-25T10:00:00.000Z');

    expect(second.dataset.records).toHaveLength(1);
    expect(second.result.recordsUpdated).toBe(1);
    expect(second.dataset.records[0].status).toBe('PICKED-UP');
    expect(second.dataset.records[0].history.at(-1)?.changedFields.some((c) => c.field === 'status' && c.from === 'UNSOLD' && c.to === 'PICKED-UP')).toBe(true);
  });

  it('bid, attendee and view changes on the same auction are recorded as an update', async () => {
    const first = await uploadSheet(EMPTY, 'a.xls', [LOCKERFOX_ROW], '2026-09-24T10:00:00.000Z');
    const second = await uploadSheet(first.dataset, 'b.xls', [{ ...LOCKERFOX_ROW, Bid: 120, Attendees: 15, Views: 61 }], '2026-09-25T10:00:00.000Z');
    expect(second.dataset.records).toHaveLength(1);
    expect(second.result.recordsUpdated).toBe(1);
    const changed = second.dataset.records[0].history.at(-1)?.changedFields.map((c) => c.field).sort();
    expect(changed).toEqual(['attendees', 'bid', 'views']);
  });
});
