import type { ExportClock } from './exportClock';

/** The offset (ms) a named timezone applies at the given UTC instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asIfUTC - utcMs;
}

/**
 * Interprets wall-clock components according to `clock` and returns the
 * corresponding UTC instant. A fixed offset is applied verbatim; a named zone
 * is resolved DST-aware (two passes handle the hour around a transition).
 * Independent of the environment's own timezone either way.
 */
export function wallClockToUTC(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  clock: ExportClock,
): Date {
  const naive = Date.UTC(year, monthIndex, day, hour, minute, second, ms);
  if (clock.kind === 'offset') return new Date(naive - clock.minutes * 60_000);
  let guess = naive - zoneOffsetMs(naive, clock.name);
  guess = naive - zoneOffsetMs(guess, clock.name);
  return new Date(guess);
}

/**
 * Converts a JS Date produced by SheetJS for an Excel date cell into the ISO
 * string of the real UTC instant, given how the export's wall-clock values
 * are to be read. The result is identical no matter which timezone the
 * uploader's browser runs in.
 *
 * Why this exists: SheetJS (`cellDates: true`) turns an Excel date serial into
 * a Date by treating the cell's wall-clock value as *local* time. Calling
 * `toISOString()` on that Date then converts to UTC, baking the uploader's
 * own UTC offset into the result. The same cell (wall-clock 2026-09-23 07:02,
 * which LockerFox confirms is 10:02 AM EDT = 14:02 UTC) therefore came out as
 * "2026-09-23T07:02:00.000Z" from a UTC browser — wrong — and
 * "2026-09-23T14:02:00.000Z" from an Arizona/Pacific browser — right only
 * because that browser happened to share the export's offset. Because that
 * string fed the dedupe key, the same auction was stored twice (merge.ts).
 *
 * The wall-clock *components* read back through the local getters are the
 * same in every environment, so re-interpreting them with the export's own
 * clock yields one correct answer everywhere.
 */
export function excelCellDateToISO(d: Date, clock: ExportClock): string {
  return wallClockToUTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
    clock,
  ).toISOString();
}

const US_DATE_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i;

/**
 * Extracts the calendar day ("YYYY-MM-DD") of an auction-close value using
 * pure string parsing — no Date object, so no timezone can influence it. This
 * is the day component of an auction's identity (see merge.ts). For an ISO
 * value that is the UTC day of the stored instant; for US-style text it is the
 * day as written.
 *
 * Returns undefined for anything that isn't an ISO or US-style date, so the
 * caller can fall back to the raw text.
 */
export function auctionCloseDayKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = trimmed.match(US_DATE_RE);
  if (us) {
    let year = parseInt(us[3], 10);
    if (year < 100) year += 2000;
    return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return undefined;
}

/**
 * Attempts to parse a wide variety of date representations LockerFox/Excel
 * might produce into an ISO string. Naive (timezone-less) text is anchored as
 * UTC so the result does not depend on the parsing environment's timezone.
 */
export function parseDateFlexible(raw: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // ISO-like: a full timestamp is unambiguous; a bare "YYYY-MM-DD" is parsed
  // by JS as UTC midnight, which is what we want.
  const isoLike = /^\d{4}-\d{2}-\d{2}/.test(trimmed);
  if (isoLike) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const usMatch = trimmed.match(US_DATE_RE);
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
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const generic = new Date(trimmed);
  if (!isNaN(generic.getTime())) return generic.toISOString();

  return undefined;
}

export function parseNumberFlexible(raw: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return isNaN(n) ? undefined : n;
}

export function normalizeKeyPart(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
