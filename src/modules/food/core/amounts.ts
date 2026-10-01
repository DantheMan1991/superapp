/**
 * AN INGREDIENT LINE, READ FOR WHAT SCALES (D1, ADR 0123).
 *
 * The line stays as the recipe wrote it. This finds the amount at its start
 * ("1 ½", "1 1/2", "2-3", "200"), the unit after it ("cups", "g", "cloves"),
 * and an equivalent in brackets after the unit ("(190 g)"), and writes them
 * again for another number of servings. Everything else on the line is the
 * cook's own words and is left alone, except a few foods counted whole
 * ("1 egg", "2 eggs"), whose singular or plural follows the number.
 *
 * At the recipe's own size the line is shown exactly as written, so a line
 * this misreads can only ever be misscaled, never misquoted. A line with no
 * amount at its start ("salt and pepper to taste", "juice of 1 lemon") does
 * not scale, and the editor says so.
 *
 * Pure and import-free: the recipe page, the editor's read-back and (D3) the
 * shopping list all read lines through here.
 */

/** How a scaled amount is written: fractions for cups and counts, decimals for grams. */
export type AmountStyle = "fraction" | "decimal";

interface UnitDef {
  /** The full word, singular and plural; a unit written this way follows the number. */
  one: string;
  many: string;
  /** Short spellings, lower case and without a full stop; written as they were. */
  short: readonly string[];
  style: AmountStyle;
  /**
   * A container, whose size in brackets is the size of one ("1 can (15 oz)"),
   * written as it is whatever the servings; after a measure ("1 ½ cups
   * (190 g)", "1 stick (½ cup)") the brackets hold the same amount again,
   * and scale with it.
   */
  container?: boolean;
}

function unit(one: string, many: string, short: string[] = [], style: AmountStyle = "fraction"): UnitDef {
  return { one, many, short, style };
}

function container(one: string, many: string, short: string[] = []): UnitDef {
  return { one, many, short, style: "fraction", container: true };
}

const UNITS: readonly UnitDef[] = [
  unit("teaspoon", "teaspoons", ["tsp", "tsps", "ts"]),
  unit("tablespoon", "tablespoons", ["tbsp", "tbsps", "tbs", "tbl", "tbls"]),
  unit("cup", "cups", ["c"]),
  unit("ounce", "ounces", ["oz"]),
  unit("pound", "pounds", ["lb", "lbs"]),
  unit("pint", "pints", ["pt", "pts"]),
  unit("quart", "quarts", ["qt", "qts"]),
  unit("gallon", "gallons", ["gal"]),
  unit("gram", "grams", ["g", "gr", "grs"], "decimal"),
  unit("gramme", "grammes", [], "decimal"),
  unit("kilogram", "kilograms", ["kg", "kgs", "kilo", "kilos"], "decimal"),
  unit("milligram", "milligrams", ["mg"], "decimal"),
  unit("milliliter", "milliliters", ["ml", "mls"], "decimal"),
  unit("millilitre", "millilitres", [], "decimal"),
  unit("liter", "liters", ["l"], "decimal"),
  unit("litre", "litres", [], "decimal"),
  unit("centiliter", "centiliters", ["cl"], "decimal"),
  unit("deciliter", "deciliters", ["dl"], "decimal"),
  unit("clove", "cloves"),
  container("can", "cans"),
  container("tin", "tins"),
  container("jar", "jars"),
  container("bottle", "bottles"),
  container("package", "packages", ["pkg", "pkgs"]),
  container("packet", "packets"),
  container("bag", "bags"),
  container("box", "boxes"),
  container("carton", "cartons"),
  container("container", "containers"),
  container("envelope", "envelopes"),
  unit("stick", "sticks"),
  unit("slice", "slices"),
  unit("piece", "pieces", ["pc", "pcs"]),
  unit("pinch", "pinches"),
  unit("dash", "dashes"),
  unit("drop", "drops"),
  unit("bunch", "bunches"),
  unit("sprig", "sprigs"),
  unit("head", "heads"),
  unit("stalk", "stalks"),
  unit("leaf", "leaves"),
  unit("handful", "handfuls"),
  unit("sheet", "sheets"),
  unit("fillet", "fillets"),
  unit("scoop", "scoops"),
  unit("knob", "knobs"),
  unit("rasher", "rashers"),
  unit("strip", "strips"),
];

/** A few foods counted whole, so "2 eggs" halves to "1 egg" rather than "1 eggs". */
const COUNTED: ReadonlyArray<readonly [string, string]> = [
  ["egg", "eggs"],
  ["lemon", "lemons"],
  ["lime", "limes"],
  ["orange", "oranges"],
  ["onion", "onions"],
  ["shallot", "shallots"],
  ["potato", "potatoes"],
  ["tomato", "tomatoes"],
  ["carrot", "carrots"],
  ["apple", "apples"],
  ["banana", "bananas"],
  ["avocado", "avocados"],
  ["pepper", "peppers"],
  ["chile", "chiles"],
  ["chili", "chilies"],
  ["tortilla", "tortillas"],
  ["zucchini", "zucchinis"],
  ["cucumber", "cucumbers"],
];

/** Words that can stand between the number and a counted food: "2 large eggs". */
const SIZES = new Set(["large", "medium", "small", "big", "whole", "extra-large", "jumbo"]);

const VULGAR: Record<string, number> = {
  "½": 1 / 2,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅕": 1 / 5,
  "⅖": 2 / 5,
  "⅗": 3 / 5,
  "⅘": 4 / 5,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};
const VULGAR_CLASS = "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞";

/** One piece of a read line: the cook's words, an amount, or a unit as written. */
export type LinePiece =
  | { kind: "text"; text: string }
  | { kind: "amount"; text: string; min: number; max: number | null; style: AmountStyle }
  | { kind: "unit"; lead: string; text: string; unit: UnitDef }
  | { kind: "counted"; text: string; one: string; many: string };

export interface ReadLine {
  pieces: LinePiece[];
  /** True when the line starts with an amount, so a change of servings changes it. */
  scales: boolean;
}

interface NumberFound {
  value: number;
  end: number;
}

/**
 * The number at `at`: "1 ½", "1½", "1 1/2", "1-1/2", "3/4", "¾", "1.5",
 * "1,5", "1,000", "200". Null when there is none.
 */
function numberAt(text: string, at: number): NumberFound | null {
  const rest = text.slice(at);
  let m = new RegExp(`^(\\d+)\\s*([${VULGAR_CLASS}])`).exec(rest);
  if (m) return { value: Number(m[1]) + VULGAR[m[2]], end: at + m[0].length };
  m = /^(\d+)(?:\s+|-)(\d+)\s*[/⁄]\s*(\d+)/.exec(rest);
  if (m && Number(m[3]) > 0) {
    return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), end: at + m[0].length };
  }
  m = /^(\d+)\s*[/⁄]\s*(\d+)/.exec(rest);
  if (m && Number(m[2]) > 0) return { value: Number(m[1]) / Number(m[2]), end: at + m[0].length };
  m = new RegExp(`^([${VULGAR_CLASS}])`).exec(rest);
  if (m) return { value: VULGAR[m[1]], end: at + m[0].length };
  m = /^\d+,\d{3}(?![\d,])/.exec(rest);
  if (m) return { value: Number(m[0].replace(",", "")), end: at + m[0].length };
  m = /^(\d*)[.,](\d+)/.exec(rest);
  if (m && (m[1] !== "" || m[2] !== "")) {
    return { value: Number(`${m[1] || "0"}.${m[2]}`), end: at + m[0].length };
  }
  m = /^\d+/.exec(rest);
  if (m) return { value: Number(m[0]), end: at + m[0].length };
  return null;
}

/** An amount, alone or as a range ("2-3", "2 to 3", "2 or 3"). */
function amountAt(text: string, at: number): { min: number; max: number | null; end: number } | null {
  const first = numberAt(text, at);
  if (!first || first.value <= 0) return null;
  const joint = /^\s*(?:[-–—]|to\b|or\b)\s*/i.exec(text.slice(first.end));
  if (joint) {
    const second = numberAt(text, first.end + joint[0].length);
    if (second && second.value > first.value) {
      return { min: first.value, max: second.value, end: second.end };
    }
  }
  return { min: first.value, max: null, end: first.end };
}

/** The unit spelled by `word`, or null. "T" is a tablespoon and "t" a teaspoon, as old cards write them. */
function unitOf(word: string): UnitDef | null {
  if (word === "T") return UNITS[1];
  if (word === "t") return UNITS[0];
  const key = word.toLowerCase().replace(/\.$/, "");
  return UNITS.find((u) => u.one === key || u.many === key || u.short.includes(key)) ?? null;
}

/** The unit at `at`, including "fl oz" and "fluid ounces", with the spaces before it. */
function unitAt(text: string, at: number): { unit: UnitDef; lead: string; word: string; end: number } | null {
  const rest = text.slice(at);
  const fluid = /^(\s+)(fl\.?\s*oz\.?|fluid\s+ounces?)(?![A-Za-z])/i.exec(rest);
  if (fluid) {
    return { unit: unit("fluid ounce", "fluid ounces", ["fl oz"]), lead: fluid[1], word: fluid[2], end: at + fluid[0].length };
  }
  const m = /^(\s*)([A-Za-z]+\.?)(?![A-Za-z])/.exec(rest);
  if (!m) return null;
  // A unit glued to the number ("200g") or after a space; a bare letter is
  // only a unit after the number, never the start of a word ("2 t" is, "2 tomatoes" is not).
  const found = unitOf(m[2]);
  if (!found) return null;
  return { unit: found, lead: m[1], word: m[2], end: at + m[0].length };
}

/** A counted food after the amount, past any size word: the piece to change, or null. */
function countedAt(text: string, at: number): { lead: string; word: string; one: string; many: string } | null {
  const rest = text.slice(at);
  const sized = /^(\s+[A-Za-z-]+)?(\s+)([A-Za-z]+)(?![A-Za-z])/.exec(rest);
  if (!sized) return null;
  const size = sized[1]?.trim().toLowerCase();
  if (size && !SIZES.has(size)) return null;
  const word = sized[3];
  const pair = COUNTED.find(([one, many]) => word.toLowerCase() === one || word.toLowerCase() === many);
  if (!pair) return null;
  return { lead: `${sized[1] ?? ""}${sized[2]}`, word, one: pair[0], many: pair[1] };
}

/** Read one ingredient line (not a heading). */
export function readLine(text: string): ReadLine {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const amount = amountAt(text, lead.length);
  if (!amount) return { pieces: [{ kind: "text", text }], scales: false };
  // A number that is a size, not an amount ("2-inch piece of ginger",
  // "14-ounce can", "5 cm piece"): twice the recipe is not a 4-inch piece.
  if (/^\s*(?:-\s*[A-Za-z]|(?:inch|inches|in\.|cm|mm)(?![A-Za-z])|["”″])/i.test(text.slice(amount.end))) {
    return { pieces: [{ kind: "text", text }], scales: false };
  }

  const pieces: LinePiece[] = [];
  if (lead) pieces.push({ kind: "text", text: lead });
  let at = amount.end;
  let style: AmountStyle = "fraction";

  // A size in brackets straight after the number is the size of one can or
  // pack ("1 (14 oz) can"): it is written as it is, whatever the servings.
  const packSize = /^\s*\([^)]{1,40}\)/.exec(text.slice(at));
  let afterPack = at;
  if (packSize) afterPack = at + packSize[0].length;

  const found = unitAt(text, afterPack);
  if (found) style = found.unit.style;
  pieces.push({
    kind: "amount",
    text: text.slice(lead.length, amount.end),
    min: amount.min,
    max: amount.max,
    style,
  });
  if (packSize) pieces.push({ kind: "text", text: packSize[0] });
  at = afterPack;

  if (found) {
    pieces.push({ kind: "unit", lead: found.lead, text: found.word, unit: found.unit });
    at = found.end;
    // An equivalent in brackets after a measure ("1 ½ cups (190 g) flour") is
    // the same amount in other words, so it scales with it. After a container
    // ("1 can (15 oz) beans") it is the size of one, and stays.
    const equivalent = found.unit.container ? null : /^(\s*\()(\s*)/.exec(text.slice(at));
    if (equivalent) {
      const inner = amountAt(text, at + equivalent[0].length);
      const innerUnit = inner ? unitAt(text, inner.end) : null;
      if (inner && innerUnit) {
        pieces.push({ kind: "text", text: equivalent[0] });
        pieces.push({
          kind: "amount",
          text: text.slice(at + equivalent[0].length, inner.end),
          min: inner.min,
          max: inner.max,
          style: innerUnit.unit.style,
        });
        pieces.push({ kind: "unit", lead: innerUnit.lead, text: innerUnit.word, unit: innerUnit.unit });
        at = innerUnit.end;
      }
    }
  } else {
    const counted = countedAt(text, at);
    if (counted) {
      pieces.push({ kind: "text", text: counted.lead });
      pieces.push({ kind: "counted", text: counted.word, one: counted.one, many: counted.many });
      at += counted.lead.length + counted.word.length;
    }
  }
  if (at < text.length) pieces.push({ kind: "text", text: text.slice(at) });
  return { pieces, scales: true };
}

const FRACTIONS: ReadonlyArray<readonly [number, string]> = [
  [0, ""],
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
  [1, ""],
];

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** One number, written the way a cook reads it: "1 ½" for cups and eggs, "335" for grams. */
export function formatAmount(value: number, style: AmountStyle): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (style === "decimal") {
    if (value >= 100) return String(Math.round(value / 5) * 5);
    if (value >= 10) return String(Math.round(value));
    if (value >= 1) return trimZeros(value.toFixed(1));
    return trimZeros(value.toFixed(2));
  }
  let whole = Math.floor(value);
  const part = value - whole;
  let nearest = FRACTIONS[0];
  for (const candidate of FRACTIONS) {
    if (Math.abs(candidate[0] - part) < Math.abs(nearest[0] - part)) nearest = candidate;
  }
  if (nearest[0] === 1) whole += 1;
  const symbol = nearest[0] === 1 ? "" : nearest[1];
  if (whole === 0) return symbol || "⅛";
  return symbol ? `${whole} ${symbol}` : String(whole);
}

/** A piece of a line as shown: the words, with the amount and its unit marked. */
export interface ShownPart {
  text: string;
  amount: boolean;
}

function capitalLike(model: string, word: string): string {
  return model[0] && model[0] === model[0].toUpperCase() && model[0] !== model[0].toLowerCase()
    ? word[0].toUpperCase() + word.slice(1)
    : word;
}

/**
 * The line at `factor` times its size. At 1 it is the line exactly as written,
 * marked; otherwise each amount is multiplied and written again, and a unit or
 * a counted food written as a full word follows the new number.
 */
export function showLine(read: ReadLine, factor: number): ShownPart[] {
  const same = factor === 1;
  let last = 1;
  const parts: ShownPart[] = [];
  for (const piece of read.pieces) {
    if (piece.kind === "text") {
      parts.push({ text: piece.text, amount: false });
    } else if (piece.kind === "amount") {
      const min = piece.min * factor;
      const max = piece.max === null ? null : piece.max * factor;
      last = max ?? min;
      const text = same
        ? piece.text
        : max === null
          ? formatAmount(min, piece.style)
          : `${formatAmount(min, piece.style)}–${formatAmount(max, piece.style)}`;
      parts.push({ text, amount: true });
    } else if (piece.kind === "unit") {
      const lower = piece.text.toLowerCase();
      const full = lower === piece.unit.one || lower === piece.unit.many;
      const word = same || !full ? piece.text : capitalLike(piece.text, last > 1 ? piece.unit.many : piece.unit.one);
      parts.push({ text: piece.lead + word, amount: true });
    } else {
      const word = same ? piece.text : capitalLike(piece.text, last > 1 ? piece.many : piece.one);
      parts.push({ text: word, amount: false });
    }
  }
  // Neighbouring parts of the same kind run together, so a line renders as a
  // few spans rather than one per piece.
  return parts.reduce<ShownPart[]>((out, part) => {
    const previous = out[out.length - 1];
    if (previous && previous.amount === part.amount) previous.text += part.text;
    else out.push({ ...part });
    return out;
  }, []);
}

/** The line at `factor` times its size, as plain text (the shopping list, a copy). */
export function scaleLine(text: string, factor: number): string {
  return showLine(readLine(text), factor)
    .map((part) => part.text)
    .join("");
}
