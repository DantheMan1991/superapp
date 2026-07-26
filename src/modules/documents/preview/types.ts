/**
 * Shapes shared between the spreadsheet reader and the viewer that draws it.
 *
 * Separate from `spreadsheet.ts` because that module is `server-only` and this
 * one is imported by a client component. `import type` is erased at compile
 * time so it would probably survive — but "probably" is how the templates
 * build broke, and a file with no marker costs nothing.
 */

export interface SheetPreview {
  name: string;
  rows: string[][];
  /** True when the sheet has more rows or columns than were returned. */
  truncated: boolean;
  totalRows: number;
}

export interface SpreadsheetPreview {
  sheets: SheetPreview[];
  /** Sheets beyond the cap that were not read at all. */
  omittedSheets: number;
}
