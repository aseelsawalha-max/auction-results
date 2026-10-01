/**
 * How to interpret the wall-clock "Auction Close" values in a LockerFox Excel
 * export.
 *
 * The export's date cells are wall-clock values, not UTC (the "UTC" in the
 * export's filename refers to when the export was generated). Established
 * from one verified data point: the cell for Unit 238 at "Affordable Self
 * Storage USA Inc - 2553 Atlantic" reads 2026-09-23 07:02, and LockerFox's
 * own Auction Report shows that auction ending "Wed 9/23/26 10:02 AM EDT"
 * = 14:02 UTC. So in September 2026 the export is UTC-07:00.
 *
 * LockerFox exposes no timezone setting in its account screens, and a single
 * September observation cannot tell a fixed -07:00 offset apart from a
 * DST-following zone (e.g. Pacific, which would be -08:00 in winter). The
 * default therefore records exactly what was observed — a fixed offset — and
 * deliberately assumes no DST rule. Re-verify with the same spot-check in the
 * first week after 1 November 2026 (US DST ends); if the export turns out to
 * follow DST, set VITE_LOCKERFOX_EXPORT_UTC_OFFSET to the IANA zone name
 * instead (also accepted), which needs no code change.
 *
 * Record identity does not depend on this setting (see merge.ts), so changing
 * it later cannot duplicate records — it only corrects stored close times.
 */

export type ExportClock =
  | { kind: 'offset'; minutes: number; label: string }
  | { kind: 'zone'; name: string; label: string };

export const DEFAULT_EXPORT_CLOCK_SETTING = '-07:00';

/** Accepts a fixed offset ("-07:00", "+05:30") or an IANA zone ("America/Los_Angeles"). */
export function parseExportClock(setting: string): ExportClock | undefined {
  const trimmed = setting.trim();
  const offset = trimmed.match(/^([+-])(\d{2}):(\d{2})$/);
  if (offset) {
    const sign = offset[1] === '-' ? -1 : 1;
    const minutes = sign * (parseInt(offset[2], 10) * 60 + parseInt(offset[3], 10));
    if (Math.abs(minutes) > 14 * 60) return undefined;
    const sym = sign < 0 ? '−' : '+';
    return { kind: 'offset', minutes, label: `UTC${sym}${offset[2]}:${offset[3]} (fixed offset)` };
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return { kind: 'zone', name: trimmed, label: `${trimmed} (follows that zone's DST rules)` };
  } catch {
    return undefined;
  }
}

function resolveExportClock(): ExportClock {
  const fallback = parseExportClock(DEFAULT_EXPORT_CLOCK_SETTING)!;
  const configured = (import.meta.env?.VITE_LOCKERFOX_EXPORT_UTC_OFFSET as string | undefined)?.trim();
  if (!configured) return fallback;
  const parsed = parseExportClock(configured);
  if (parsed) return parsed;
  console.error(
    `VITE_LOCKERFOX_EXPORT_UTC_OFFSET="${configured}" is neither a ±HH:MM offset nor a valid IANA timezone; falling back to ${DEFAULT_EXPORT_CLOCK_SETTING}.`,
  );
  return fallback;
}

export const EXPORT_CLOCK: ExportClock = resolveExportClock();
