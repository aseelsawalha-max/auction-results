import ExcelJS from 'exceljs';

/** Builds an in-memory .xlsx File from an array of row objects (header: value). */
export async function buildXlsxFile(fileName: string, rows: Record<string, string | number>[]): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Auction Results');

  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((k) => set.add(k));
    return set;
  }, new Set<string>()));

  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(headers.map((h) => row[h] ?? ''));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer as unknown as BlobPart], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
