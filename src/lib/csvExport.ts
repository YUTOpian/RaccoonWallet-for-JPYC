import type { SaleRecord } from './storage';

// Turns 販売履歴 into a CSV file the person can open in Excel/Numbers/Sheets, or hand off
// to a bookkeeper. Prepended with a UTF-8 BOM so Excel on Windows (which otherwise assumes
// Shift-JIS/CP932 for unmarked files) doesn't mangle the Japanese column headers/product
// names into mojibake.
const CSV_HEADER = ['Date', 'Product name', 'Amount', 'Unit price (JPYC)', 'Amount (JPYC)', 'Note'];

export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(',');
}

/** Builds the raw CSV text for a list of sales, oldest first (natural bookkeeping order). */
export function buildSalesCsv(sales: SaleRecord[]): string {
  const rows = sales
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((sale) =>
      toCsvRow([
        new Date(sale.timestamp).toLocaleString(),
        sale.productName,
        String(sale.quantity),
        String(sale.unitPrice),
        String(sale.amount),
        sale.note,
      ]),
    );
  return [toCsvRow(CSV_HEADER), ...rows].join('\r\n');
}

function timestampForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Builds the CSV and triggers a browser download for it. No-ops if `sales` is empty. */
export function downloadSalesCsv(sales: SaleRecord[], filenamePrefix: string = 'sales_history') {
  if (sales.length === 0) {
    return;
  }
  const csv = buildSalesCsv(sales);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filenamePrefix}_${timestampForFilename(new Date())}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
