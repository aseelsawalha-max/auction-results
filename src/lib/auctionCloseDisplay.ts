/**
 * Timezone-safe formatting for the LockerFox "Auction Close" value, used by
 * the Facility Results table, the Auction Details modal, and month/year
 * filtering.
 *
 * Deliberately independent from normalize.ts's parseDateFlexible(), which
 * merge.ts uses to derive AuctionRecord.auctionClose. Both now anchor naive
 * (timezone-less) date/time components as UTC — parseDateFlexible() so the
 * stored value is the same no matter which browser uploaded the file, and
 * this module so every viewer *sees* the same value — but this module is
 * presentation-only and also *formats* using UTC components, so the
 * LockerFox date/time renders identically regardless of the viewer's own
 * browser timezone.
 *
 * auctionCloseRaw (a plain text column, never reinterpreted by Postgres) is
 * preferred over the derived auctionClose for display: Supabase's
 * auction_close column is a DATE type, which permanently discards
 * time-of-day, and a bare "YYYY-MM-DD" string is only safely interpretable
 * as UTC midnight — formatting it in the viewer's local timezone (as the
 * table/modal used to) can shift the displayed calendar date back by a day.
 */

interface AuctionCloseSource {
  auctionClose?: string;
  auctionCloseRaw?: string;
}

/**
 * Parses a LockerFox auction-close value into a Date, anchoring any naive
 * (timezone-less) date/time components as UTC rather than the caller's local
 * timezone. Mirrors the formats normalize.ts's parseDateFlexible() accepts.
 */
export function parseAuctionCloseUTC(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Full ISO 8601 with a time component (e.g. produced by SheetJS for a
  // genuine Excel date/time cell via Date.toISOString()) is unambiguous.
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  // A bare "YYYY-MM-DD" (e.g. what Supabase's auction_close DATE column
  // returns) is already parsed by JS as UTC midnight, which is correct here.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  // US-style text date, optionally with a time (a text-typed LockerFox
  // Auction Close cell), e.g. "8/31/2026" or "8/31/2026 2:00 PM".
  const usMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (usMatch) {
    const [, mm, dd, yy, hh, min, sec, ampm] = usMatch;
    let year = parseInt(yy, 10);
    if (year < 100) year += 2000;
    let hour = hh ? parseInt(hh, 10) : 0;
    if (ampm) {
      const isPm = ampm.toUpperCase() === 'PM';
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
    }
    const d = new Date(
      Date.UTC(year, parseInt(mm, 10) - 1, parseInt(dd, 10), hour, min ? parseInt(min, 10) : 0, sec ? parseInt(sec, 10) : 0),
    );
    if (!isNaN(d.getTime())) return d;
  }

  const generic = new Date(trimmed);
  if (!isNaN(generic.getTime())) return generic;

  return undefined;
}

/**
 * The Date to use for displaying/sorting/filtering by Auction Close: prefers
 * the untouched auctionCloseRaw, falling back to the derived auctionClose
 * only when raw is missing.
 */
export function auctionCloseDate(record: AuctionCloseSource): Date | undefined {
  return parseAuctionCloseUTC(record.auctionCloseRaw) ?? parseAuctionCloseUTC(record.auctionClose);
}

const UTC_DATE_OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' };
const UTC_DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
};

/** Table/list display: just the date, e.g. "Aug 31, 2026". */
export function formatAuctionCloseDate(record: AuctionCloseSource): string {
  const d = auctionCloseDate(record);
  if (d) return d.toLocaleDateString('en-US', UTC_DATE_OPTS);
  return record.auctionCloseRaw || '—';
}

/** Detail view: date + time, labeled UTC since that's what LockerFox recorded. */
export function formatAuctionCloseDateTime(record: AuctionCloseSource): string {
  const d = auctionCloseDate(record);
  if (d) return `${d.toLocaleString('en-US', UTC_DATETIME_OPTS)} UTC`;
  return record.auctionCloseRaw || '—';
}

/**
 * Formats a single historical auctionCloseRaw/auctionClose string value (as
 * stored verbatim in an audit-trail changedFields entry) for human-readable
 * display, without altering the underlying stored history in any way. Falls
 * back to the original string unchanged if it isn't a recognizable date.
 */
export function formatAuctionCloseHistoryValue(value: string): string {
  const d = parseAuctionCloseUTC(value);
  if (!d) return value;
  const hadTime = /T\d{2}:\d{2}/.test(value) || /\d{1,2}:\d{2}\s*(AM|PM)?/i.test(value);
  return hadTime ? `${d.toLocaleString('en-US', UTC_DATETIME_OPTS)} UTC` : d.toLocaleDateString('en-US', UTC_DATE_OPTS);
}
