/**
 * CSV export — one implementation, used by every screen that offers a download.
 *
 * WHY THIS FILE EXISTS
 *
 * The first CSV export lived inline in `Appointments.tsx`: escaping, BOM and
 * download plumbing written straight into a click handler. Copying that block
 * into Reports and Finance would have produced three copies that drift — and
 * the escaping rule is the part that must not drift, because a treatment name
 * containing a comma or a quote silently corrupts every row after it.
 *
 * `toCsv` is pure so it can be asserted on directly; only `downloadCsv` touches
 * the browser. Same split as `consent-pdf.ts`.
 *
 * EVERY CELL IS QUOTED, and that is deliberate — not a shortcut.
 *
 * The Appointments export shipped quoted cells first, and Excel accepts it. A
 * mixed scheme (quote only when needed) would change that file's bytes for no
 * gain, and the risk here is one-directional: an over-quoted cell is still
 * valid CSV, an under-escaped one is a broken file. Kept as-is so the
 * extraction below is provably behaviour-preserving.
 */

/**
 * One cell, escaped per RFC 4180: wrap in quotes, double any internal quote.
 *
 * `String(value)` is intentional — the Appointments export relied on it, so
 * `null`/`undefined` render as the literal text rather than an empty cell.
 * Callers that want a blank cell should pass `""`.
 */
export function csvCell(value: unknown): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * A header row plus data rows as a CSV document.
 *
 * Rows joined with `\n` (not `\r\n`) to match the export that already shipped;
 * Excel and LibreOffice both read it. The UTF-8 BOM that makes Excel detect the
 * encoding is added by `downloadCsv`, not here, so this function stays pure and
 * comparable in a test.
 */
export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

/**
 * Trigger a browser download of `rows` as `filename`.
 *
 * The BOM (`\ufeff`) is load-bearing: without it Excel on Windows opens a UTF-8
 * CSV as the local codepage and Malay text arrives as mojibake. It is prepended
 * here rather than in `toCsv` because a BOM is a transport concern — it must not
 * appear in the string a test asserts on.
 */
export function downloadCsv(filename: string, rows: unknown[][]): void {
  const blob = new Blob([`\ufeff${toCsv(rows)}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * A filename stamped with today's date, e.g. `reports-kewangan-2026-10-05.csv`.
 *
 * Local date parts, not `toISOString()`: that converts to UTC, so an export
 * made at 08:00 in Kuala Lumpur (UTC+8) would be labelled with yesterday's date.
 */
export function datedCsvName(prefix: string, at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${prefix}-${stamp}.csv`;
}
