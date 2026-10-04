import { z } from "zod";
import { addDays } from "@/lib/timezone";
import { formatAmount, readLine, scaleLine, type LinePiece } from "./amounts";
import { plannable } from "./week";

/**
 * THE SHOPPING LIST (D3, docs/modules/food.md, ADR 0130; the founder's calls
 * 2026-10-03, from the mockup of the week and the list): what the planned
 * days need, bought once per cooked batch, the same thing added up across
 * recipes, sorted by aisle; staples asked about once ("Have these at home?")
 * and left off for good when he always has them. CLAUDE NAMES WHAT EACH LINE
 * BUYS (`food_line_names`); THE AMOUNTS ARE ADDED HERE, from the lines
 * themselves (`core/amounts.ts`), never by a model.
 *
 * Pure: what a line asks for, the sums and their words, the list for a run of
 * days, and the days a list can cover. Ticks and the person's own items are
 * kept on the phone (`components/list-store.ts`).
 */

export const AISLES = ["produce", "meat", "dairy", "bakery", "pantry", "frozen", "drinks", "other"] as const;
export type Aisle = (typeof AISLES)[number];

export const AISLE_LABELS: Record<Aisle, string> = {
  produce: "Produce",
  meat: "Meat and fish",
  dairy: "Dairy and eggs",
  bakery: "Bread and bakery",
  pantry: "Pantry",
  frozen: "Frozen",
  drinks: "Drinks",
  other: "Other",
};

/**
 * One thing a line buys, as Claude named it once for the space: a line may buy
 * several ("Salt and pepper to taste"), and one named `null` buys nothing
 * (water).
 */
export interface LineName {
  item: string | null;
  aisle: Aisle;
  staple: boolean;
}

/* -- what a line asks for -------------------------------------------------- */

const OUNCE_G = 28.349523125;
const POUND_G = 453.59237;
const TSP_ML = 4.92892159375;

const MASS_G: Readonly<Record<string, number>> = {
  gram: 1,
  gramme: 1,
  kilogram: 1_000,
  milligram: 0.001,
  ounce: OUNCE_G,
  pound: POUND_G,
};
const VOLUME_ML: Readonly<Record<string, number>> = {
  teaspoon: TSP_ML,
  tablespoon: TSP_ML * 3,
  "fluid ounce": TSP_ML * 6,
  cup: TSP_ML * 48,
  pint: TSP_ML * 96,
  quart: TSP_ML * 192,
  gallon: TSP_ML * 768,
  milliliter: 1,
  millilitre: 1,
  centiliter: 10,
  deciliter: 100,
  liter: 1_000,
  litre: 1_000,
};
/** The units that say the recipe counts the American way, so its sums are shown in them. */
const US_UNITS = new Set(["ounce", "pound", "teaspoon", "tablespoon", "fluid ounce", "cup", "pint", "quart", "gallon"]);

/**
 * What a line asks for: a weight, a volume, a number of something with a unit
 * of its own (cloves, cans of a size), a count (3 onions, 2 eggs), or nothing
 * a list can add (to taste). Weights and volumes add across their units;
 * nothing turns a volume into a weight.
 */
export type Measure =
  | { kind: "mass"; grams: number; us: boolean }
  | { kind: "volume"; ml: number; us: boolean }
  | { kind: "unit"; key: string; one: string; many: string; count: number; times: boolean }
  | { kind: "count"; count: number }
  | { kind: "none" };

type AmountPiece = Extract<LinePiece, { kind: "amount" }>;

function bracketAt(piece: LinePiece | undefined): string {
  if (!piece || piece.kind !== "text") return "";
  return /^\s*(\([^)]{1,40}\))/.exec(piece.text)?.[1] ?? "";
}

/**
 * A line, at `factor` times its size, as a list adds it. A range ("2-3
 * cloves") buys its larger end. A size in brackets is part of a container's
 * unit ("1 can (15 oz)", "1 (14 oz) can"), so two sizes are never added
 * together. A line with no amount at its start asks for nothing a list adds.
 */
export function measureOf(text: string, factor: number): Measure {
  const read = readLine(text);
  if (!read.scales) return { kind: "none" };
  const pieces = read.pieces;
  const at = pieces.findIndex((piece) => piece.kind === "amount");
  if (at < 0) return { kind: "none" };
  const amount = pieces[at] as AmountPiece;
  const value = (amount.max ?? amount.min) * factor;

  let next = at + 1;
  // "1 (14 oz) can": the size of one, before its container.
  let pack = pieces[next + 1]?.kind === "unit" ? bracketAt(pieces[next]) : "";
  if (pack) next += 1;
  const piece = pieces[next];
  if (piece?.kind === "unit") {
    const name = piece.unit.one;
    if (name in MASS_G) return { kind: "mass", grams: value * MASS_G[name], us: US_UNITS.has(name) };
    if (name in VOLUME_ML) return { kind: "volume", ml: value * VOLUME_ML[name], us: US_UNITS.has(name) };
    // "1 can (15 oz) beans": a container's size follows it.
    if (!pack && piece.unit.container) pack = bracketAt(pieces[next + 1]);
    const suffix = pack ? ` ${pack}` : "";
    return {
      kind: "unit",
      key: `${name}${suffix}`,
      one: `${name}${suffix}`,
      many: `${piece.unit.many}${suffix}`,
      count: value,
      times: false,
    };
  }
  return { kind: "count", count: value };
}

/** A planned food by its amount, as Log food has it: grams and ounces as a weight, a portion of its own as so many of it. */
export function measureOfFood(amount: number, portion: string, grams: number): Measure {
  if (portion === "g") return { kind: "mass", grams, us: false };
  if (portion === "oz") return { kind: "mass", grams, us: true };
  // One of a portion reads as the portion ("1 banana"); more as so many of it ("3 × banana").
  return { kind: "unit", key: `portion:${portion}`, one: portion, many: portion.replace(/^1\s+/, ""), count: amount, times: true };
}

/* -- adding up --------------------------------------------------------------- */

/** What one thing on the list comes to, from every line that asks for it. */
export interface Total {
  count: number;
  units: Map<string, { one: string; many: string; times: boolean; count: number }>;
  grams: number;
  gramsUs: boolean;
  ml: number;
  mlUs: boolean;
}

export function emptyTotal(): Total {
  return { count: 0, units: new Map(), grams: 0, gramsUs: false, ml: 0, mlUs: false };
}

export function addTo(total: Total, measure: Measure): void {
  switch (measure.kind) {
    case "mass":
      total.grams += measure.grams;
      total.gramsUs ||= measure.us;
      return;
    case "volume":
      total.ml += measure.ml;
      total.mlUs ||= measure.us;
      return;
    case "count":
      total.count += measure.count;
      return;
    case "unit": {
      const unit = total.units.get(measure.key) ?? { one: measure.one, many: measure.many, times: measure.times, count: 0 };
      unit.count += measure.count;
      total.units.set(measure.key, unit);
      return;
    }
    case "none":
      return;
  }
}

/** "1 ⅓ lb", "10 oz", "450 g", "1.5 kg". */
export function massWords(grams: number, us: boolean): string {
  if (us) {
    const ounces = grams / OUNCE_G;
    return ounces >= 16 - 1e-9 ? `${formatAmount(ounces / 16, "fraction")} lb` : `${formatAmount(ounces, "fraction")} oz`;
  }
  return grams >= 1_000 ? `${formatAmount(grams / 1_000, "decimal")} kg` : `${formatAmount(grams, "decimal")} g`;
}

/** "1 ½ cups", "3 tbsp", "2 tsp", "500 ml", "1.5 l". */
export function volumeWords(ml: number, us: boolean): string {
  if (us) {
    const cups = ml / (TSP_ML * 48);
    if (cups >= 0.25 - 1e-9) return `${formatAmount(cups, "fraction")} ${cups > 1 + 1e-9 ? "cups" : "cup"}`;
    const tbsp = ml / (TSP_ML * 3);
    if (tbsp >= 1 - 1e-9) return `${formatAmount(tbsp, "fraction")} tbsp`;
    return `${formatAmount(ml / TSP_ML, "fraction")} tsp`;
  }
  return ml >= 1_000 ? `${formatAmount(ml / 1_000, "decimal")} l` : `${formatAmount(ml, "decimal")} ml`;
}

/** A total in words, its parts joined: "3", "7 cloves", "2 cans (15 oz)", "3 cloves + 1 tsp", "1 banana", "5 × banana". Empty when nothing adds up. */
export function totalWords(total: Total): string {
  const parts: string[] = [];
  if (total.count > 1e-9) parts.push(formatAmount(total.count, "fraction"));
  for (const unit of total.units.values()) {
    if (unit.count <= 1e-9) continue;
    if (unit.times) {
      parts.push(Math.abs(unit.count - 1) < 1e-9 ? unit.one : `${formatAmount(unit.count, "fraction")} × ${unit.many}`);
    } else {
      parts.push(`${formatAmount(unit.count, "fraction")} ${unit.count > 1 + 1e-9 ? unit.many : unit.one}`);
    }
  }
  if (total.grams > 1e-9) parts.push(massWords(total.grams, total.gramsUs));
  if (total.ml > 1e-9) parts.push(volumeWords(total.ml, total.mlUs));
  return parts.join(" + ");
}

/* -- the list ---------------------------------------------------------------- */

/** A cook on the list's days: its recipe's lines, bought for the batch (`make` of what the recipe makes). */
export interface ListCook {
  planId: string;
  day: string;
  title: string;
  yieldAmount: number | null;
  make: number;
  lines: string[];
}

/** A food planned from the list on the list's days. */
export interface ListFood {
  planId: string;
  day: string;
  name: string;
  amount: number;
  portion: string;
  grams: number;
}

/** One thing to buy. */
export interface ListItem {
  /** What a tick is kept by on the phone: the item's name, or a line not yet sorted. */
  key: string;
  name: string;
  aisle: Aisle;
  /** Most kitchens keep it: asked about under "Have these at home?". */
  staple: boolean;
  /** What it comes to, in words; empty when nothing adds up ("to taste"). */
  amount: string;
  /** What needs it: the recipe, or the planned food, and how much each wants when there are several. */
  sources: { label: string; amount: string }[];
  /** False for a line Claude has not named yet: shown as the recipe wrote it, at the batch's size. */
  sorted: boolean;
}

export interface ShoppingList {
  items: ListItem[];
  /** How many cooks and planned foods the days have. */
  cooks: number;
  foods: number;
  /** Lines not named yet. */
  unsorted: number;
  /** What the person always has, which the days would have listed. */
  leftOff: string[];
}

/** A line as the list keeps it: trimmed, and never a heading (`ListCook.lines` holds no headings). */
export function cleanLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Every line the days ask for, once: what Claude is asked to name, with the planned foods' names. */
export function listLines(cooks: readonly ListCook[], foods: readonly ListFood[]): string[] {
  const out = new Set<string>();
  for (const cook of cooks) for (const line of cook.lines) if (cleanLine(line)) out.add(cleanLine(line));
  for (const food of foods) if (cleanLine(food.name)) out.add(cleanLine(food.name));
  return [...out];
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The list for the days from `from` to `to`: each cook's lines at its batch's
 * size and each planned food, gathered by what Claude named them, added up
 * here, sorted by aisle and then by name. A line that buys two things counts
 * its amount for each ("1 cup each carrots and celery"). What the person
 * always has is left off, and named in `leftOff`; a line not named yet is
 * listed as written.
 */
export function buildList(input: {
  cooks: readonly ListCook[];
  foods: readonly ListFood[];
  names: Readonly<Record<string, readonly LineName[]>>;
  always: readonly string[];
  from: string;
  to: string;
}): ShoppingList {
  const inDays = (day: string) => day >= input.from && day <= input.to;
  const cooks = input.cooks.filter((cook) => inDays(cook.day));
  const foods = input.foods.filter((food) => inDays(food.day));
  const always = new Set(input.always.map((item) => item.toLowerCase()));

  interface Gathered {
    name: string;
    aisle: Aisle;
    staple: boolean;
    total: Total;
    bySource: Map<string, Total>;
  }
  const gathered = new Map<string, Gathered>();
  const unsorted: ListItem[] = [];
  const leftOff = new Set<string>();

  const add = (line: string, label: string, measure: Measure, asWritten: string) => {
    const names = input.names[line];
    if (names === undefined || names.length === 0) {
      unsorted.push({ key: `line:${asWritten}`, name: asWritten, aisle: "other", staple: false, amount: "", sources: [{ label, amount: "" }], sorted: false });
      return;
    }
    for (const name of names) {
      if (name.item === null) continue;
      const key = name.item.toLowerCase();
      if (always.has(key)) {
        leftOff.add(key);
        continue;
      }
      const entry = gathered.get(key) ?? { name: capital(name.item), aisle: name.aisle, staple: false, total: emptyTotal(), bySource: new Map() };
      entry.staple ||= name.staple;
      addTo(entry.total, measure);
      const source = entry.bySource.get(label) ?? emptyTotal();
      addTo(source, measure);
      entry.bySource.set(label, source);
      gathered.set(key, entry);
    }
  };

  for (const cook of cooks) {
    const factor = cook.yieldAmount && cook.yieldAmount > 0 ? cook.make / cook.yieldAmount : 1;
    for (const raw of cook.lines) {
      const line = cleanLine(raw);
      if (!line) continue;
      add(line, cook.title, measureOf(line, factor), factor === 1 ? line : cleanLine(scaleLine(line, factor)));
    }
  }
  for (const food of foods) {
    const line = cleanLine(food.name);
    if (!line) continue;
    add(line, food.name, measureOfFood(food.amount, food.portion, food.grams), line);
  }

  const items: ListItem[] = [...gathered.entries()].map(([key, entry]) => {
    const many = entry.bySource.size > 1;
    return {
      key,
      name: entry.name,
      aisle: entry.aisle,
      staple: entry.staple,
      amount: totalWords(entry.total),
      sources: [...entry.bySource.entries()].map(([label, total]) => ({ label, amount: many ? totalWords(total) : "" })),
      sorted: true,
    };
  });
  items.sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.name.localeCompare(b.name));
  return { items: [...items, ...unsorted], cooks: cooks.length, foods: foods.length, unsorted: unsorted.length, leftOff: [...leftOff].sort() };
}

/* -- the days a list covers ------------------------------------------------- */

export interface ListRange {
  from: string;
  to: string;
}

/** A new list's days: today and the six after it. */
export function defaultRange(today: string): ListRange {
  return { from: today, to: addDays(today, 6) };
}

/**
 * Days a list may still cover: ending today or later, and no later than next
 * week's Sunday (what can be planned). It may have started before this week:
 * a Sunday's shop for the week ahead lasts into it.
 */
export function rangeOk(range: ListRange, today: string): boolean {
  return range.to <= plannable(today).to && range.from <= range.to && range.to >= today;
}

function utc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Oct 4 to 10", "Sep 29 to Oct 5", or one day: "Oct 4". */
export function spanWords(from: string, to: string): string {
  const month = (day: string) => utc(day).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const date = (day: string) => utc(day).getUTCDate();
  if (from === to) return `${month(from)} ${date(from)}`;
  return month(from) === month(to) ? `${month(from)} ${date(from)} to ${date(to)}` : `${month(from)} ${date(from)} to ${month(to)} ${date(to)}`;
}

/* -- a shopping trip, kept on the phone ------------------------------------ */

/** A thing on the list ticked off (`got`) or said to be at home (`have`), with what it came to then. */
export interface Mark {
  kind: "got" | "have";
  amount: string;
}

/** Something the person added themselves; `got` is the first day of the list it was ticked on. */
export interface OwnItem {
  id: string;
  name: string;
  got: string | null;
}

/**
 * What the phone keeps of the list (D3, the founder's default): the days it
 * covers, the marks of this trip (kept by the list's first day, so a list for
 * other days starts unticked), and the person's own items.
 */
export interface ShoppingState {
  range: ListRange | null;
  marks: { from: string; byKey: Record<string, Mark> };
  own: OwnItem[];
}

export const EMPTY_SHOPPING: ShoppingState = { range: null, marks: { from: "", byKey: {} }, own: [] };

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const shoppingStateSchema = z.object({
  range: z.object({ from: dayString, to: dayString }).nullable(),
  marks: z.object({
    from: z.string().max(10),
    byKey: z.record(z.string().max(600), z.object({ kind: z.enum(["got", "have"]), amount: z.string().max(200) })),
  }),
  own: z
    .array(z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(120), got: dayString.nullable() }))
    .max(200),
});

/** The marks of the list that starts on `from`: marks made for a list starting another day are an old trip's. */
export function marksFor(state: ShoppingState, from: string): Record<string, Mark> {
  return state.marks.from === from ? state.marks.byKey : {};
}

/** The person's own items on the list that starts on `from`: not ticked yet, or ticked on this trip. */
export function ownFor(state: ShoppingState, from: string): OwnItem[] {
  return state.own.filter((item) => item.got === null || item.got === from);
}

/** Set or clear a mark on the list that starts on `from`; an old trip's marks and ticked items go. */
export function setMark(state: ShoppingState, from: string, key: string, mark: Mark | null): ShoppingState {
  const byKey = { ...marksFor(state, from) };
  if (mark) byKey[key] = mark;
  else delete byKey[key];
  return { ...state, marks: { from, byKey }, own: ownFor(state, from) };
}

export function addOwn(state: ShoppingState, id: string, name: string): ShoppingState {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!clean) return state;
  return { ...state, own: [...state.own, { id, name: clean, got: null }] };
}

export function toggleOwn(state: ShoppingState, from: string, id: string): ShoppingState {
  return { ...state, own: ownFor(state, from).map((item) => (item.id === id ? { ...item, got: item.got ? null : from } : item)) };
}

export function removeOwn(state: ShoppingState, id: string): ShoppingState {
  return { ...state, own: state.own.filter((item) => item.id !== id) };
}

/* -- inputs ------------------------------------------------------------------ */

/** "Always have" on, or put back. */
export const alwaysHaveSchema = z.object({
  item: z.string().trim().min(1).max(80),
  always: z.boolean(),
});
export type AlwaysHaveInput = z.infer<typeof alwaysHaveSchema>;
