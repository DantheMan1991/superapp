/**
 * Turning a spreadsheet cell into a string.
 *
 * Pure and dependency-free so it can be tested without a workbook, which
 * matters because `cell.value` is a union of about eight shapes and the ugly
 * ones only appear in real files: a formula cell is an object carrying its
 * cached result, a hyperlink is an object wrapping text, and rich text is an
 * array of runs. Reading `String(value)` on any of those renders
 * "[object Object]" in the middle of someone's takeoff.
 */

/** The shapes exceljs hands back. Structural, not exhaustive. */
export type SheetCellValue =
  | null
  | undefined
  | string
  | number
  | boolean
  | Date
  | { formula?: string; result?: unknown; sharedFormula?: string }
  | { richText?: Array<{ text?: string }> }
  | { text?: string; hyperlink?: string }
  | { error?: string }
  | unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A cell's display text, matching what Excel shows rather than what it stores.
 *
 * Deliberately NOT applying number formats: a preview that says `1234.5` where
 * Excel says `$1,234.50` is imprecise, but one that invents a currency symbol
 * from a guessed locale is wrong. Dates are the exception — an unformatted date
 * renders as an ISO timestamp, which nobody can read.
 */
export function cellText(value: SheetCellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return formatDate(value);

  if (isRecord(value)) {
    // A formula cell shows its RESULT. Showing "=SUM(A1:A9)" would be showing
    // the mechanism instead of the number the person came to read.
    if ("result" in value) return cellText(value.result as SheetCellValue);
    if ("formula" in value || "sharedFormula" in value) return "";
    if ("error" in value && typeof value.error === "string") return value.error;
    if (Array.isArray(value.richText)) {
      return value.richText
        .map((run) => (isRecord(run) && typeof run.text === "string" ? run.text : ""))
        .join("");
    }
    // Hyperlinks keep their TEXT, not their URL — the sheet showed the text.
    if (typeof value.text === "string") return value.text;
  }

  return "";
}

/** Local calendar date; drops a midnight time, which is how Excel dates arrive. */
function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
}

/**
 * Crop a sheet to the rectangle that actually contains data.
 *
 * Trims LEADING as well as trailing blank rows and columns. Spreadsheets are
 * full of formatted-but-empty cells, and exports are worse: a QuickBooks
 * customer list puts its data in column C with two empty indent columns to the
 * left, so without this the table opens with two blank columns before anything
 * readable. Interior blanks are preserved — those are real data.
 */
export function trimGrid(rows: string[][]): string[][] {
  let firstRow = -1;
  let lastRow = -1;
  let firstCol = -1;
  let lastCol = -1;

  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.trim() === "") return;
      if (firstRow === -1) firstRow = r;
      lastRow = Math.max(lastRow, r);
      firstCol = firstCol === -1 ? c : Math.min(firstCol, c);
      lastCol = Math.max(lastCol, c);
    });
  });

  if (lastRow === -1) return [];
  return rows.slice(firstRow, lastRow + 1).map((row) => {
    const cropped = row.slice(firstCol, lastCol + 1);
    while (cropped.length < lastCol - firstCol + 1) cropped.push("");
    return cropped;
  });
}
