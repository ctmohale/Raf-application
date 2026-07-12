import fs from 'node:fs';
import XLSX from 'xlsx';

export function parseSpreadsheet(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const columns = rows.length
    ? Object.keys(rows[0])
    : XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })[0] || [];

  fs.rm(filePath, { force: true }, () => {});

  return {
    sheetName,
    columns,
    rows
  };
}
