import * as XLSX from 'xlsx';

/** Builds an in-memory .xlsx or .xls File from an array of row objects (header: value). */
export function buildXlsxFile(
  fileName: string,
  rows: Record<string, string | number | Date>[],
  bookType: 'xlsx' | 'biff8' = 'xlsx',
): File {
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');

  const buffer = XLSX.write(workbook, { type: 'array', bookType });
  const mime =
    bookType === 'biff8'
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return new File([buffer], fileName, { type: mime });
}
