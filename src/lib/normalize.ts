/** Attempts to parse a wide variety of date representations LockerFox/Excel might produce. */
export function parseDateFlexible(raw: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  // Excel serial date stored as text (rare, but exceljs may hand back an ISO string already
  // for real Date cells, so this mainly covers plain-text dates like "7/31/2026").
  const isoLike = /^\d{4}-\d{2}-\d{2}/.test(trimmed);
  if (isoLike) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

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
    const d = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10), hour, min ? parseInt(min, 10) : 0, sec ? parseInt(sec, 10) : 0);
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
