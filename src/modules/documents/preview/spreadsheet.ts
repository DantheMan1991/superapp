import "server-only";
import ExcelJS from "exceljs";
import { cellText, trimGrid, type SheetCellValue } from "./cell";
import { parseDelimited, sniffDelimiter } from "./csv";
import type { SheetPreview, SpreadsheetPreview } from "./types";

/**
 * Reading a spreadsheet for the preview.
 *
 * Parsed on the SERVER, deliberately. The obvious alternative is SheetJS in the
 * browser, but the `xlsx` package published to npm is pinned at 0.18.5 — newer
 * community builds moved to the vendor's own CDN — and that version carries
 * known prototype-pollution and ReDoS advisories. Pointing it at files
 * strangers email into a folder address is not a trade worth making for a
 * preview. exceljs is MIT, current on npm, and Node is where it is best
 * supported.
 *
 * Parsing here also keeps roughly a megabyte of parser out of the browser
 * bundle, and matches how every other blob in this module is handled.
 */

/** Bounds. A preview is a look, not an export. */
export const PREVIEW_MAX_ROWS = 200;
export const PREVIEW_MAX_COLS = 40;
export const PREVIEW_MAX_SHEETS = 12;
/** Refuse to parse anything larger — a 200MB workbook is a denial of service. */
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

// Shapes live in ./types, which carries no `server-only` marker — the viewer
// is a client component and imports them from there.
export type { SheetPreview, SpreadsheetPreview } from "./types";

export function isPreviewableSpreadsheet(mimeType: string): boolean {
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "text/csv"
  );
}

/**
 * The legacy binary .xls format.
 *
 * exceljs cannot read it and the only library that can is the one rejected
 * above, so this is an honest "no" rather than a broken table. Callers use it
 * to explain rather than to fail silently.
 */
export function isLegacyExcel(mimeType: string): boolean {
  return mimeType === "application/vnd.ms-excel";
}

function boundRows(rows: string[][]): {
  rows: string[][];
  truncated: boolean;
  totalRows: number;
} {
  const totalRows = rows.length;
  const clippedRows = rows.slice(0, PREVIEW_MAX_ROWS);
  let clippedCols = false;
  const bounded = clippedRows.map((row) => {
    if (row.length > PREVIEW_MAX_COLS) clippedCols = true;
    return row.slice(0, PREVIEW_MAX_COLS);
  });
  return {
    rows: trimGrid(bounded),
    truncated: totalRows > PREVIEW_MAX_ROWS || clippedCols,
    totalRows,
  };
}

export async function readCsvPreview(
  bytes: Uint8Array,
): Promise<SpreadsheetPreview> {
  const text = new TextDecoder("utf-8").decode(bytes);
  const grid = parseDelimited(text, sniffDelimiter(text));
  const bounded = boundRows(grid);
  return {
    sheets: [{ name: "Sheet 1", ...bounded }],
    omittedSheets: 0,
  };
}

export async function readXlsxPreview(
  bytes: Uint8Array,
): Promise<SpreadsheetPreview> {
  const workbook = new ExcelJS.Workbook();
  // Copied into a fresh ArrayBuffer: exceljs expects one, and a Uint8Array
  // view over a larger buffer would hand it the wrong bytes.
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(buffer);

  const sheets: SheetPreview[] = [];
  let omittedSheets = 0;

  workbook.eachSheet((worksheet) => {
    if (sheets.length >= PREVIEW_MAX_SHEETS) {
      omittedSheets += 1;
      return;
    }

    /*
     * Traversed with eachRow/eachCell rather than indexed by rowCount and
     * columnCount.
     *
     * Those two counters are derived from metadata the writing application
     * chooses to emit. A workbook exceljs itself wrote reports them correctly —
     * which is exactly why the first version of this passed its tests and then
     * showed "This sheet is empty" on a real file out of Excel. eachRow walks
     * the row objects that actually exist, so a sheet with no dimension record,
     * a sparse grid, or rows starting below row 1 still reads.
     *
     * Rows are keyed by their real number so a gap does not shift everything
     * up a line.
     */
    const byRowNumber = new Map<number, string[]>();
    let widestColumn = 0;
    let highestRow = 0;
    let clippedCols = false;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      highestRow = Math.max(highestRow, rowNumber);
      if (rowNumber > PREVIEW_MAX_ROWS) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber > PREVIEW_MAX_COLS) {
          clippedCols = true;
          return;
        }
        // eachCell skips leading gaps, so pad to the cell's real column.
        while (cells.length < colNumber - 1) cells.push("");
        cells[colNumber - 1] = cellText(cell.value as SheetCellValue);
        widestColumn = Math.max(widestColumn, colNumber);
      });
      byRowNumber.set(rowNumber, cells);
    });

    const width = Math.min(widestColumn, PREVIEW_MAX_COLS);
    const lastRow = Math.min(highestRow, PREVIEW_MAX_ROWS);
    const grid: string[][] = [];
    for (let r = 1; r <= lastRow; r += 1) {
      const cells = byRowNumber.get(r) ?? [];
      while (cells.length < width) cells.push("");
      grid.push(cells);
    }

    sheets.push({
      name: worksheet.name || `Sheet ${sheets.length + 1}`,
      rows: trimGrid(grid),
      truncated: highestRow > PREVIEW_MAX_ROWS || clippedCols,
      totalRows: highestRow,
    });
  });

  return { sheets, omittedSheets };
}
