import { describe, it, expect } from 'vitest';
import {
  parseAuctionCloseUTC,
  formatAuctionCloseDate,
  formatAuctionCloseDateTime,
  formatAuctionCloseHistoryValue,
} from '../auctionCloseDisplay';
import { applyFilters, recordDate, EMPTY_FILTERS } from '../filters';
import type { AuctionRecord } from '../types';

function record(overrides: Partial<AuctionRecord>): AuctionRecord {
  return {
    dedupeKey: 'k',
    dedupeKeyIsNativeId: false,
    extra: {},
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    lastUpdatedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    sourceFiles: [],
    history: [],
    ...overrides,
  };
}

describe('Auction Close display — timezone-safe formatting', () => {
  it('displays a bare Supabase DATE-column value as the correct day, not shifted back a day', () => {
    // This is exactly what auction_close looks like after round-tripping
    // through Supabase's DATE column: a bare "YYYY-MM-DD" string with no
    // time component. Regression: this used to render as "Aug 30, 2026" in
    // any viewer timezone west of UTC because new Date("2026-08-31") is UTC
    // midnight, and the table/modal used to format it in the viewer's local
    // timezone.
    expect(formatAuctionCloseDate({ auctionCloseRaw: undefined, auctionClose: '2026-08-31' })).toBe('Aug 31, 2026');
  });

  it('displays a full ISO LockerFox timestamp using UTC components, consistently for every viewer', () => {
    const source = { auctionCloseRaw: '2026-08-31T14:00:00.000Z', auctionClose: '2026-08-31' };
    expect(formatAuctionCloseDate(source)).toBe('Aug 31, 2026');
    expect(formatAuctionCloseDateTime(source)).toBe('Aug 31, 2026, 2:00 PM UTC');
  });

  it('prefers auctionCloseRaw over a stale/truncated auctionClose when both are present', () => {
    // auctionClose here simulates a value that has round-tripped through the
    // DATE column and lost the time (and, in the buggy old display code,
    // would render as the wrong day); auctionCloseRaw is authoritative.
    const source = { auctionCloseRaw: '2026-08-31T14:00:00.000Z', auctionClose: '2026-08-30' };
    expect(formatAuctionCloseDateTime(source)).toBe('Aug 31, 2026, 2:00 PM UTC');
  });

  it('parses US-style text dates by anchoring naive components as UTC, not the local machine timezone', () => {
    const d = parseAuctionCloseUTC('8/31/2026 2:00 PM');
    expect(d?.toISOString()).toBe('2026-08-31T14:00:00.000Z');
  });

  it('falls back to the raw text unchanged when it cannot be parsed as a date', () => {
    expect(formatAuctionCloseDate({ auctionCloseRaw: 'TBD', auctionClose: undefined })).toBe('TBD');
  });

  it('formats a historical auctionCloseRaw change entry so both sides are human-readable', () => {
    // The exact reported case: a stale pre-fix history entry showing
    // "2026-08-31 -> 2026-08-31T14:00:00.000Z" verbatim.
    expect(formatAuctionCloseHistoryValue('2026-08-31')).toBe('Aug 31, 2026');
    expect(formatAuctionCloseHistoryValue('2026-08-31T14:00:00.000Z')).toBe('Aug 31, 2026, 2:00 PM UTC');
  });

  it('recordDate() reflects auctionCloseRaw as a UTC instant, not the potentially-truncated derived field', () => {
    const r = record({ auctionCloseRaw: '2026-08-31T14:00:00.000Z', auctionClose: '2026-08-30' });
    const d = recordDate(r);
    expect(d?.getUTCFullYear()).toBe(2026);
    expect(d?.getUTCMonth()).toBe(7); // August, 0-indexed
    expect(d?.getUTCDate()).toBe(31);
  });

  it('assigns auctions closing right around a month boundary to the correct LockerFox month, regardless of local timezone', () => {
    const augRecord = record({ auctionCloseRaw: '8/31/2026 11:30 PM' });
    const sepRecord = record({ auctionCloseRaw: '9/1/2026 12:30 AM' });

    const augResult = applyFilters([augRecord, sepRecord], { ...EMPTY_FILTERS, year: '2026', month: '08' });
    expect(augResult).toEqual([augRecord]);

    const sepResult = applyFilters([augRecord, sepRecord], { ...EMPTY_FILTERS, year: '2026', month: '09' });
    expect(sepResult).toEqual([sepRecord]);
  });
});
