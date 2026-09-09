/**
 * The valuation as a file. **PURE — no imports beyond types, no database.**
 *
 * **THE CAVEAT GOES IN THE FILE, ON THE FIRST LINE, BEFORE THE HEADER.**
 * `core/valuation.ts` opens by saying a total on its own cannot be checked:
 * "$4,200" reads identically whether it covers the whole farm or everything
 * except three pens of birds nobody costed. A screen can put that beside the
 * number. A file cannot — it gets emailed to an accountant and opened months
 * later with no memory of the screen that produced it, and a column of figures
 * carries no warning at all.
 *
 * So this is built the way the general ledger's export already is: the
 * incompleteness is row one, in words, ahead of anything a spreadsheet will
 * total. If a later change moves the figures out of this function without
 * bringing the caveat, that is the defect — the same sentence the page's own
 * header makes.
 *
 * **AND THE FILTERS TRAVEL TOO.** A valuation of one freezer and a valuation of
 * the whole business are two correct and entirely different files, and an
 * accountant holding the first will read it as the second. Same reasoning as
 * accounting's basis and company rows, which exist for exactly this.
 */
import type { StockValuation } from "./valuation";

/** What the reader had narrowed the screen to when they pressed the button. */
export interface ValuationCsvContext {
  /** The day the figures are as of. Always present — a valuation without one is not one. */
  asOf: string;
  /** Resolved LABELS, never ids: a file naming a uuid answers nothing. */
  placeLabel?: string | null;
  kindLabel?: string | null;
  enterpriseLabel?: string | null;
}

/**
 * Plain `-1234.56`, built by integer construction. The same shape accounting's
 * exports use, and deliberately not `formatMoney` — a file with thousands
 * separators and a currency symbol in it is a file a spreadsheet reads as text.
 */
function amount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * The words that describe what is missing, or null when nothing is.
 *
 * Its own function because the screen says the same thing and the two must not
 * drift; the phrasing differs only in that a file has to name itself.
 */
export function valuationCaveat(valuation: StockValuation): string | null {
  const { unvaluedLines, unvaluedQuantity, incomplete } = valuation.total;
  if (!incomplete) return null;
  return (
    `INCOMPLETE — ${
      unvaluedLines === 1 ? "one batch has" : `${unvaluedLines} batches have`
    } no cost recorded, ${unvaluedQuantity} in all, and the total below does ` +
    `NOT include them. It is short by whatever they are worth, which nobody ` +
    `has said. Raised stock has no purchase price, so this is ordinary rather ` +
    `than a mistake.`
  );
}

/** The lines that say what was asked for, so the file cannot be read as another question. */
function contextRows(context: ValuationCsvContext): string[][] {
  const rows: string[][] = [[`As of ${context.asOf}`]];
  if (context.placeLabel) rows.push([`Place: ${context.placeLabel}`]);
  if (context.kindLabel) rows.push([`Kind: ${context.kindLabel}`]);
  if (context.enterpriseLabel) {
    rows.push([`Line of business: ${context.enterpriseLabel}`]);
  }
  return rows;
}

/**
 * **`Worth` IS EMPTY, NEVER `0.00`, FOR A LINE THAT COULD NOT BE VALUED.**
 *
 * The whole file exists to keep unvalued and zero apart, and a spreadsheet
 * SUMs a zero. An empty cell is skipped by `SUM` and shows as blank to a person
 * — which is what "nobody has said" looks like in a column of numbers. The
 * `How it was valued` column beside it says which of the two admissions it is.
 */
export function valuationToCsvRows(
  valuation: StockValuation,
  context: ValuationCsvContext,
  methodLabels: Record<string, string>,
): string[][] {
  const rows: string[][] = [];

  const caveat = valuationCaveat(valuation);
  if (caveat) rows.push([caveat]);
  rows.push(...contextRows(context));
  rows.push([]);

  rows.push([
    "What",
    "Batch",
    "On hand",
    "Unit",
    "How it was valued",
    "Worth",
  ]);
  for (const row of valuation.rows) {
    rows.push([
      row.itemName,
      row.lotCode ?? "",
      String(row.quantity),
      row.unit,
      methodLabels[row.method] ?? row.method,
      row.valueCents === null ? "" : amount(row.valueCents),
    ]);
  }

  rows.push([]);
  rows.push([
    "Total",
    "",
    "",
    "",
    `${valuation.total.valuedLines} ${
      valuation.total.valuedLines === 1 ? "line" : "lines"
    } valued`,
    amount(valuation.total.valueCents),
  ]);
  // Repeated at the bottom, because the first line scrolls off and the total is
  // what somebody copies. **Only when there IS something missing** — a row
  // reading "0 batches" under a complete valuation is noise that trains a
  // reader to skip the line that matters on the day it is not zero.
  if (valuation.total.incomplete) {
    rows.push([
      "Not in the total",
      "",
      String(valuation.total.unvaluedQuantity),
      "",
      `${valuation.total.unvaluedLines} ${
        valuation.total.unvaluedLines === 1 ? "batch" : "batches"
      } with no cost recorded`,
      "",
    ]);
  }
  return rows;
}

/**
 * `stock-value_2026-09-09.csv`, plus what it was narrowed to.
 *
 * The filters are in the NAME as well as the content: two of these land in one
 * downloads folder and only the name is visible.
 */
export function valuationCsvFilename(context: ValuationCsvContext): string {
  const parts = ["stock-value", context.asOf];
  for (const label of [
    context.placeLabel,
    context.kindLabel,
    context.enterpriseLabel,
  ]) {
    if (label) parts.push(filenamePart(label));
  }
  return `${parts.join("_")}.csv`;
}

/** Lowercased, spaces to dashes, anything a filesystem argues about removed. */
function filenamePart(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "filtered"
  );
}
