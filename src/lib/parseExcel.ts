import * as XLSX from 'xlsx';
import { detectColumns } from './columnMapping';
import type { CanonicalField } from './types';

export interface ParsedRow {
  rowNumber: number; // 1-based, matches the spreadsheet row (including header) for user-facing messages
  values: Record<string, string>; // raw header -> cell text
}

export interface ParsedWorkbook {
  headers: string[];
  rows: ParsedRow[];
  mapping: Partial<Record<CanonicalField, string>>;
  unmappedColumns: string[];
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

/**
 * Parses the first worksheet that looks like a LockerFox auction-results export
 * (i.e. contains a header row with at least Facility/Unit/Status-like columns).
 * Handles both legacy .xls (BIFF) and modern .xlsx (OOXML) exports transparently.
 */
export async function parseExcelFile(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  let best: { headers: string[]; rows: ParsedRow[]; score: number } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet['!ref']) continue;

    // header:1 => array-of-arrays; raw:true (default) + cellDates:true keeps Date objects
    // and numbers intact so we control text conversion ourselves.
    const grid: unknown[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (grid.length === 0) continue;

    const headerRowIndex = findHeaderRowIndex(grid);
    if (headerRowIndex === null) continue;

    const headerRowRaw = grid[headerRowIndex];
    const headers: string[] = [];
    headerRowRaw.forEach((cell) => {
      const text = cellToString(cell);
      if (text) headers.push(text);
    });
    if (headers.length === 0) continue;

    const { mapping } = detectColumns(headers);
    const score = Object.keys(mapping).length;

    const rows: ParsedRow[] = [];
    for (let r = headerRowIndex + 1; r < grid.length; r++) {
      const rowRaw = grid[r] ?? [];
      const values: Record<string, string> = {};
      let hasAny = false;
      headers.forEach((header, idx) => {
        const text = cellToString(rowRaw[idx]);
        values[header] = text;
        if (text) hasAny = true;
      });
      if (hasAny) rows.push({ rowNumber: r + 1, values }); // +1: 1-based, matches spreadsheet row incl. header
    }

    if (!best || score > best.score) {
      best = { headers, rows, score };
    }
  }

  if (!best) {
    throw new Error(
      'Could not find a readable data table in this file. Make sure it is a LockerFox auction-results export with a header row.',
    );
  }

  const { mapping, unmapped } = detectColumns(best.headers);

  return {
    headers: best.headers,
    rows: best.rows,
    mapping,
    unmappedColumns: unmapped,
  };
}

/** Scans the first 10 rows for the one most likely to be a header row. */
function findHeaderRowIndex(grid: unknown[][]): number | null {
  const maxScan = Math.min(10, grid.length);
  let bestRow: number | null = null;
  let bestScore = 0;

  for (let r = 0; r < maxScan; r++) {
    const headers: string[] = [];
    (grid[r] ?? []).forEach((cell) => {
      const text = cellToString(cell);
      if (text) headers.push(text);
    });
    if (headers.length < 2) continue;
    const { mapping } = detectColumns(headers);
    const score = Object.keys(mapping).length;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  return bestRow;
}
