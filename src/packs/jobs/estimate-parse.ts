import { parseMoneyToCents } from "@/lib/money";
import { quantityStringToThousandths } from "./billing-math";

/**
 * ONE TYPED SENTENCE INTO ONE ESTIMATE LINE — pure, and the whole of the
 * speed slice's grammar (E3, ADR 0081).
 *
 *     320 sf tile @ 4.20          →  320 sf of "tile" at $4.20
 *     tile labour 320 sf @ 3.50   →  the same, said the other way round
 *     120 cy concrete 185         →  the `@` is optional; a trailing number is the cost
 *     plumbing rough 12000        →  a lump sum of $12,000
 *     Tile→320→sf→4.20            →  a spreadsheet row, tabs and all
 *
 * **One function, three doors.** The entry bar under the table commits one of
 * these on Enter, the paste box runs a block of them through
 * `parseEstimateLines`, and the day a phone hears *"kitchen tile, three
 * hundred and twenty square feet, four twenty a foot"* it will be the same
 * function again — which is why the grammar lives here, tested, and not in a
 * component.
 *
 * ── WHAT IS AND IS NOT A UNIT ───────────────────────────────────────────────
 *
 * The unit column is free text, so nothing can validate it — but `320 sf tile`
 * has a unit and `2 coats paint` does not, and the difference cannot be
 * guessed from the shape of the words. So the caller passes the units it
 * KNOWS: `COMMON_UNITS`, the trade's own abbreviations, plus every unit this
 * business has already typed on an estimate (`unitsInUse`). A business that
 * writes `bdl` learns it the first time, and nothing has to be configured.
 *
 * ── A LINE IT CANNOT READ IS REFUSED, NEVER GUESSED ─────────────────────────
 *
 * `null`, not a line with a zero in it. `tile @ four twenty` is a typo, and a
 * silent $0.00 on a bid is the expensive kind of wrong; the entry bar says it
 * could not read that and the paste preview marks the row. A line with no
 * description is refused for the same reason — `320 sf @ 4.20` is a quantity
 * and a price for nothing.
 */

/** In thousandths, the grain estimating works to (ADR 0064). */
const ONE = 1_000;

/**
 * The units a takeoff is written in. Not a policy and not a closed list: the
 * caller unions it with whatever this business has typed before, and a unit
 * off both lists simply reads as part of the description.
 */
export const COMMON_UNITS: readonly string[] = [
  "sf", "sq", "sy", "lf", "ln", "ft", "in", "yd", "cy", "cf", "cm", "mi",
  "ea", "ls", "pr", "pair", "set", "sets", "lot", "kit", "kits",
  "ton", "tons", "lb", "lbs", "gal", "gals", "qt", "oz",
  "hr", "hrs", "hour", "hours", "day", "days", "wk", "wks", "mo", "mos",
  "bag", "bags", "box", "boxes", "bdl", "bundle", "roll", "rolls",
  "sheet", "sheets", "pc", "pcs", "cs", "dz", "load", "loads", "trip", "trips",
];

export interface ParsedEstimateLine {
  description: string;
  /** In thousandths; `1000` — one — when the sentence names no quantity. */
  quantityThousandths: number;
  /** As it was typed, so `SF` stays `SF`; matched against the known units case-insensitively. */
  unit: string;
  unitCostCents: number;
}

/** A number that could be a quantity: digits, optional thousands commas, optional decimals. */
const NUMBER = /^\d[\d,]*(\.\d+)?$/;
/** A number that could be money: the same, with at most two decimals, and an optional `$`. */
const MONEY = /^\$?\d[\d,]*(\.\d{1,2})?$/;

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => w !== "");
}

/** The default set, for a caller with nothing of its own to add. */
export const DEFAULT_UNITS: ReadonlySet<string> = new Set(COMMON_UNITS);

/** Every unit the parser should recognise: the trade's, plus this business's own. */
export function unitsFor(used: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>(COMMON_UNITS);
  for (const u of used) {
    const t = u.trim().toLowerCase();
    if (t !== "") out.add(t);
  }
  return out;
}

/**
 * One line. `null` when it cannot be read — see the header: a refusal, never a
 * line with a zero in it.
 */
export function parseEstimateLine(
  input: string,
  knownUnits: ReadonlySet<string> = DEFAULT_UNITS,
): ParsedEstimateLine | null {
  // A tab is what a spreadsheet pastes between columns, and it means the same
  // as a space here, so one grammar reads both.
  const text = input.replace(/[\t ]+/g, " ").trim();
  if (text === "") return null;

  const isUnit = (w: string) => knownUnits.has(w.toLowerCase());

  // ---- the money: after the last `@`, else a trailing money token
  let body = text;
  let money: string | null = null;
  let unitAfterMoney = "";
  const at = text.lastIndexOf("@");
  if (at >= 0) {
    body = text.slice(0, at).trim();
    const after = words(text.slice(at + 1));
    if (after.length === 0) return null; // "tile @" is half a sentence
    money = after[0];
    if (after.length === 2 && isUnit(after[1])) {
      // "120 tile @ 4.20 sf" — said as a rate, which is how it is spoken.
      unitAfterMoney = after[1];
    } else if (after.length > 1) {
      return null; // anything else after the price was not understood, so nothing is
    }
  } else {
    const w = words(text);
    if (w.length > 1 && MONEY.test(w[w.length - 1])) {
      money = w[w.length - 1];
      body = w.slice(0, -1).join(" ");
    }
  }

  let unitCostCents = 0;
  if (money !== null) {
    if (!MONEY.test(money)) return null;
    const cents = parseMoneyToCents(money);
    if (cents === null) return null;
    unitCostCents = cents;
  }

  // ---- the quantity and the unit: at the front, or at the back
  const w = words(body);
  if (w.length === 0) return null;
  let quantityThousandths = ONE;
  let unit = "";
  let rest = w;
  if (NUMBER.test(w[0])) {
    const q = quantityStringToThousandths(w[0]);
    if (q === null) return null;
    quantityThousandths = q;
    rest = w.slice(1);
    if (rest.length > 0 && isUnit(rest[0])) {
      unit = rest[0];
      rest = rest.slice(1);
    }
  } else {
    const last = w[w.length - 1];
    const prev = w.length >= 2 ? w[w.length - 2] : null;
    if (isUnit(last) && prev !== null && NUMBER.test(prev)) {
      const q = quantityStringToThousandths(prev);
      if (q === null) return null;
      quantityThousandths = q;
      unit = last;
      rest = w.slice(0, -2);
    } else if (w.length > 1 && NUMBER.test(last)) {
      const q = quantityStringToThousandths(last);
      if (q === null) return null;
      quantityThousandths = q;
      rest = w.slice(0, -1);
    }
  }
  if (unit === "" && unitAfterMoney !== "") unit = unitAfterMoney;

  const description = rest.join(" ").trim();
  // A quantity and a price for nothing is not a line.
  if (description === "") return null;
  return { description, quantityThousandths, unit, unitCostCents };
}

export interface ParsedEstimateBlock {
  /** The line as it was pasted, so the preview can show what it could not read. */
  input: string;
  parsed: ParsedEstimateLine | null;
}

/**
 * A pasted block, one row per line. Blank lines are dropped rather than
 * reported — a paste ends in a newline more often than not — and everything
 * else gets a row, read or not, so the preview can mark what failed instead of
 * quietly losing it.
 */
export function parseEstimateLines(
  text: string,
  knownUnits: ReadonlySet<string> = DEFAULT_UNITS,
): ParsedEstimateBlock[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((input) => ({ input, parsed: parseEstimateLine(input, knownUnits) }));
}
