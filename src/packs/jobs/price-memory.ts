import { normaliseUnit } from "./takeoff-math";

/**
 * WHAT THIS BUSINESS CHARGED FOR THIS LINE LAST TIME (E4a).
 *
 * Pure — no database, no clock of its own. Every `job_estimate_line` a
 * business has ever written is already a price history; nothing read it until
 * now, so an estimator retyping `tile labour` for the ninth time had to
 * remember, guess, or go and look at the last job.
 *
 * **THE MATCH IS EXACT ON A NORMALISED KEY, AND THAT IS A DECISION.** Trigram
 * or full-text matching would catch `tile labor` against `tile labour` and
 * also offer the price of `tile backer board` for `tile`. **A wrong price
 * offered confidently is worse than no price at all** — it is money, it is
 * quiet, and it goes out in a proposal. So the key strips case and
 * punctuation and collapses spaces, which catches the way the SAME person
 * types the SAME thing twice, and nothing else. Fuzzier matching can be added
 * when a real price book says it is needed; it cannot be taken back.
 *
 * **AND IT ONLY EVER FILLS A BLANK.** A suggestion never overwrites a price
 * somebody typed, in the entry bar, in a paste or in the table. The estimator
 * is the one pricing the job; this is a memory, not an opinion.
 */

/** A unit cost remembered from the last time this description was priced. */
export interface RememberedPrice {
  /** The normalised key — `priceKey(description)`. */
  key: string;
  /** The description as it was written that time, for the sentence. */
  description: string;
  unitCostCents: number;
  /** As it was typed then: `sf`, `ton`, or blank for a lump. */
  unit: string;
  /** The job it was priced on, for "on 24-108". */
  projectNumber: string;
  /** `YYYY-MM-DD`, the day that line was written. */
  pricedOn: string;
}

/**
 * The key two typings of the same thing share.
 *
 * Case and punctuation go, and runs of anything that is not a letter or a
 * digit become one space: `Tile — mud set, Schluter, mtl only` and
 * `tile  mud set schluter mtl only` are the same line written twice. A key
 * that comes out empty is not a key — a description of `---` matches nothing
 * and must never match everything.
 */
export function priceKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The book as the editor holds it: one entry per key, the newest kept. */
export type PriceBook = ReadonlyMap<string, RememberedPrice>;

/**
 * Build the book from rows already ordered newest first. The first row for a
 * key wins, so "the last time" needs no dates compared here — the database
 * ordered them, and this only takes the first of each.
 */
export function priceBookFrom(rows: readonly RememberedPrice[]): PriceBook {
  const out = new Map<string, RememberedPrice>();
  for (const row of rows) {
    if (row.key === "" || out.has(row.key)) continue;
    out.set(row.key, row);
  }
  return out;
}

/** What this description cost last time, or null. Blank keys never match. */
export function recall(book: PriceBook, description: string): RememberedPrice | null {
  const key = priceKey(description);
  if (key === "") return null;
  return book.get(key) ?? null;
}

/**
 * A REMEMBERED PRICE IS PER ITS UNIT. `Flooring` at 4.20/sf is not a price
 * for 500 sy of flooring, and a lump remembered with no unit is not a rate at
 * all; either, put on a line in another unit, is a wrong number nothing
 * downstream can see. So a line that already knows its unit takes a memory
 * only in that unit, however either is spelled (`sq. ft.` is `sf`); a line
 * with no unit yet takes any memory and adopts its unit, as it always did.
 */
export function fitsUnit(remembered: RememberedPrice, unit: string): boolean {
  const line = normaliseUnit(unit);
  return line === "" || normaliseUnit(remembered.unit) === line;
}

/* ------------------------------------------------------------ the sentence */

/** Whole days between two `YYYY-MM-DD` dates. UTC has no daylight saving. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, (tm ?? 1) - 1, td ?? 1) - Date.UTC(fy, (fm ?? 1) - 1, fd ?? 1)) / 86_400_000);
}

/**
 * "three weeks ago", "yesterday", "last March".
 *
 * Deliberately vague past a month, because the POINT of the phrase is how much
 * to trust the number, and "11 August" makes a reader do that arithmetic
 * themselves. Nothing here is a date anybody acts on.
 */
export function howLongAgo(pricedOn: string, today: string): string {
  const days = daysBetween(pricedOn, today);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 31) return `${Math.round(days / 7)} weeks ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * The whole hint: `4.20/sf · 24-108 · 3 weeks ago`, or `12,000 · 24-109 ·
 * last week` for a lump, which carries no rate because there is no unit to
 * put one over.
 *
 * `money` is passed in already formatted, so this file holds no money rules —
 * the same split every other pure file in the pack keeps.
 */
export function priceHint(remembered: RememberedPrice, money: string, today: string): string {
  const rate = remembered.unit.trim() === "" ? money : `${money}/${remembered.unit.trim()}`;
  return `${rate} · ${remembered.projectNumber} · ${howLongAgo(remembered.pricedOn, today)}`;
}

/**
 * The price a line should take, which is the remembered one ONLY when nothing
 * was typed and — once the line knows its unit — only a memory in that unit
 * (`fitsUnit`). Returns null when the line already has a price, has no memory,
 * or has one per another unit, so a caller can count what it filled and say so.
 */
export function fillFromMemory(
  book: PriceBook,
  line: { description: string; unitCostCents: number; unit?: string },
): RememberedPrice | null {
  if (line.unitCostCents !== 0) return null;
  const remembered = recall(book, line.description);
  if (remembered === null) return null;
  return line.unit === undefined || fitsUnit(remembered, line.unit) ? remembered : null;
}
