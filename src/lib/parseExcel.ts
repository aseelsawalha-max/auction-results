import ExcelJS from 'exceljs';
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

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Rich text / formula / hyperlink cells
    const v = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (typeof v.text === 'string') return v.text;
    if (v.result !== undefined) return String(v.result);
    return '';
  }
  return String(value).trim();
}

/**
 * Parses the first worksheet that looks like a LockerFox auction-results export
 * (i.e. contains a header row with at least Facility/Unit/Status-like columns).
 * Falls back to the first worksheet with any data.
 */
export async function parseExcelFile(file: File): Promise<ParsedWorkbook> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  let best: { headers: string[]; rows: ParsedRow[]; score: number } | null = null;

  for (const worksheet of workbook.worksheets) {
    if (worksheet.rowCount === 0) continue;

    const headerRowNumber = findHeaderRow(worksheet);
    if (headerRowNumber === null) continue;

    const headerRow = worksheet.getRow(headerRowNumber);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellToString(cell.value);
      if (text) headers.push(text);
    });
    if (headers.length === 0) continue;

    const { mapping } = detectColumns(headers);
    const score = Object.keys(mapping).length;

    const rows: ParsedRow[] = [];
    for (let r = headerRowNumber + 1; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      if (row.cellCount === 0) continue;
      const values: Record<string, string> = {};
      let hasAny = false;
      headers.forEach((header, idx) => {
        const cell = row.getCell(idx + 1);
        const text = cellToString(cell.value);
        values[header] = text;
        if (text) hasAny = true;
      });
      if (hasAny) rows.push({ rowNumber: r, values });
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
function findHeaderRow(worksheet: ExcelJS.Worksheet): number | null {
  const maxScan = Math.min(10, worksheet.rowCount);
  let bestRow: number | null = null;
  let bestScore = 0;

  for (let r = 1; r <= maxScan; r++) {
    const row = worksheet.getRow(r);
    const headers: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellToString(cell.value);
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
