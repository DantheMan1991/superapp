/**
 * RFC 4180 CSV construction. **PURE — no imports, no database, client-safe.**
 *
 * Layer 0, because quoting a comma is not an accounting idea. It lived in
 * `modules/accounting/lib/csv.ts` until 2026-09-09, when inventory's valuation
 * export needed the same function; that module re-exports this one, so nothing
 * on the accounting side changed. The alternative was a second copy of a pure
 * helper, which is the mistake `hasRecordedCost` and `carriedValue` were both
 * written to end.
 */

/**
 * One field, quoted only when it has to be.
 *
 * A quote inside a quoted field is doubled — the one rule everybody gets wrong
 * and the reason a spreadsheet opens a name like `Bill "Red" Smith` as three
 * columns.
 */
function field(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/**
 * Rows to a CSV document.
 *
 * CRLF between rows and a trailing one, per RFC 4180 — Excel is happy with
 * either and some older importers are not.
 */
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}
