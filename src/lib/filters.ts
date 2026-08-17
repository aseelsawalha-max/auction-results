import type { AuctionRecord } from './types';

export interface Filters {
  facility: string; // '' = all
  year: string; // '' = all
  month: string; // '01'..'12', '' = all
  status: string; // '' = all (matches original status string, case-insensitive)
  unitSearch: string;
}

export const EMPTY_FILTERS: Filters = { facility: '', year: '', month: '', status: '', unitSearch: '' };

export function recordDate(record: AuctionRecord): Date | undefined {
  if (!record.auctionClose) return undefined;
  const d = new Date(record.auctionClose);
  return isNaN(d.getTime()) ? undefined : d;
}

export function applyFilters(records: AuctionRecord[], filters: Filters): AuctionRecord[] {
  return records.filter((r) => {
    if (filters.facility && r.facility !== filters.facility) return false;

    if (filters.year || filters.month) {
      const d = recordDate(r);
      if (!d) return false;
      if (filters.year && String(d.getFullYear()) !== filters.year) return false;
      if (filters.month && String(d.getMonth() + 1).padStart(2, '0') !== filters.month) return false;
    }

    if (filters.status && (r.status ?? '').toLowerCase() !== filters.status.toLowerCase()) return false;

    if (filters.unitSearch) {
      const needle = filters.unitSearch.trim().toLowerCase();
      if (needle && !(r.unit ?? '').toLowerCase().includes(needle)) return false;
    }

    return true;
  });
}

export function distinctFacilities(records: AuctionRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.facility).filter((f): f is string => !!f))).sort();
}

export function distinctStatuses(records: AuctionRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.status).filter((s): s is string => !!s))).sort();
}

export function distinctYears(records: AuctionRecord[]): string[] {
  const years = new Set<string>();
  for (const r of records) {
    const d = recordDate(r);
    if (d) years.add(String(d.getFullYear()));
  }
  return Array.from(years).sort((a, b) => Number(b) - Number(a));
}

export const MONTH_NAMES = [
  '01 - January', '02 - February', '03 - March', '04 - April', '05 - May', '06 - June',
  '07 - July', '08 - August', '09 - September', '10 - October', '11 - November', '12 - December',
];

/** Latest auction-close date across all records, used to pick a sensible default filter. */
export function latestAuctionDate(records: AuctionRecord[]): Date | undefined {
  let latest: Date | undefined;
  for (const r of records) {
    const d = recordDate(r);
    if (d && (!latest || d > latest)) latest = d;
  }
  return latest;
}
