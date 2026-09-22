import { significantWords } from "./outline-merge";
import { formatQuantity } from "./billing-math";
import {
  canonicalUnit,
  convertThousandths,
  dimensionOf,
  readQuantity,
  type CanonicalUnit,
  type Dimension,
  type Schedule,
  type ScheduleColumn,
  type ScheduleRow,
} from "./bim-schedule";

/**
 * THE TAKEOFF OFF THE MODEL — pure, no database, no model (X15, ADR 0107).
 *
 * The founder, when the measure-up learned to read a room schedule: *"I'm
 * really looking for way more than just room schedules here. Lumber takeoff,
 * drywall etc from the model."*
 *
 * A wall schedule, a material takeoff or a framing schedule is a list of
 * THINGS with quantities against them — `Basic Wall: Exterior - 2x6 Wood
 * Stud · 12 · 248' · 2,232 SF`, `Gypsum Wall Board · 4,464 SF`, `2x10 · 46
 * · 14'`. An assembly is what the business builds that thing out of, priced
 * once at a size and scaled to any other (ADR 0086). So a takeoff is a JOIN:
 * the model's name for a thing → the assembly it means → the assembly's
 * lines at the quantity the model states.
 *
 * ── THIS FILE READS THE TABLE, NEVER THE FILE ───────────────────────────────
 *
 * `bim-schedule.ts` has already turned the export into a `Schedule` with its
 * columns classified. Here the rows are grouped by the column that names
 * things, every quantity column is added up per name, and each name is
 * matched to an assembly by what the business has said it means before —
 * or, when the words plainly agree, suggested. Nothing here decides; the
 * person confirms every match, and the confirmation is what gets remembered.
 */

/** One quantity column, added up for one name. */
export interface TakeoffQuantity {
  header: string;
  unit: CanonicalUnit | "";
  dimension: Dimension | null;
  totalThousandths: number;
}

/** One thing the model names, with everything the schedule says about it. */
export interface TakeoffRow {
  /** As the model wrote it. */
  key: string;
  /** The key reduced to its identity. */
  slug: string;
  /** Schedule rows behind it. */
  rows: number;
  /** The `Count` column added up, or the rows when there is none. */
  count: number;
  quantities: TakeoffQuantity[];
}

/**
 * The identity of a name: case and punctuation go, runs of anything else
 * become one space. `Basic Wall: Exterior - 2x6` and `basic wall exterior
 * 2x6` are one key. The same reduction the price book uses for a
 * description, for the same reason.
 */
export function keySlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normal(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The columns that name a thing, best first. `Family and Type` is what a
 * Revit element schedule calls it, `Material: Name` a material takeoff,
 * `Type` a framing schedule. The fallback is the first word column that is
 * not a number, a mark or a comment.
 */
const KEY_HEADERS = [
  "family and type",
  "type",
  "material: name",
  "material name",
  "material",
  "family",
  "type name",
  "assembly description",
  "description",
  "name",
];

const NOT_A_KEY = /^(number|no\.?|#|mark|type mark|level|comments?|phase.*|keynote|id|count)$/;

export function keyColumnOf(columns: readonly ScheduleColumn[]): ScheduleColumn | null {
  const text = columns.filter((c) => c.kind === "text");
  for (const wanted of KEY_HEADERS) {
    const found = text.find((c) => normal(c.header) === wanted);
    if (found) return found;
  }
  return text.find((c) => !NOT_A_KEY.test(normal(c.header))) ?? null;
}

/** A `Count` column: bare figures under that header. */
export function countColumnOf(columns: readonly ScheduleColumn[]): ScheduleColumn | null {
  return (
    columns.find((c) => c.kind === "quantity" && c.unit === "" && normal(c.header) === "count") ??
    null
  );
}

/**
 * **A FRAMING MEMBER IS NAMED BY ITS TYPE AND ITS CUT LENGTH** (X16). Forty-six
 * 2x10s at 14' and twelve at 12' are two things on a lumber list, not one
 * 2x10 with a total length, so a framing schedule — a *Count* column beside
 * a *Cut Length* — is named by both columns unless the person says
 * otherwise. Any other schedule is named by one.
 */
export function alsoColumnDefault(columns: readonly ScheduleColumn[]): ScheduleColumn | null {
  if (!countColumnOf(columns)) return null;
  return (
    columns.find(
      (c) => c.kind === "quantity" && c.dimension === "length" && normal(c.header) === "cut length",
    ) ?? null
  );
}

/**
 * THE SCHEDULE AS THINGS WITH QUANTITIES.
 *
 * Rows sharing a name are one thing, in the order first seen, every quantity
 * column added up across them. A row with nothing in the naming column is
 * counted and left out — the preview says how many — because a quantity
 * with no name is a figure nobody can put against anything.
 *
 * **The figures are what the cells say.** A schedule exported grouped by
 * type with *Calculate totals* on carries the total in the row; one exported
 * itemised carries each element and the sum is taken here; one grouped
 * WITHOUT totals carries one element's figure beside a count of many, and
 * this cannot tell that from the first case. The guide says which way to
 * export; the preview shows the count beside the figure so the eye can.
 */
export function takeoffRows(
  columns: readonly ScheduleColumn[],
  rows: readonly ScheduleRow[],
  keyIndex: number,
  /** A second column that splits a name — a member's cut length (X16). */
  alsoIndex: number | null = null,
): { rows: TakeoffRow[]; unnamed: number } {
  const count = countColumnOf(columns);
  const quantityColumns = columns.filter(
    (c) => c.kind === "quantity" && c.index !== (count?.index ?? -1),
  );
  const out = new Map<string, TakeoffRow>();
  let unnamed = 0;
  for (const row of rows) {
    const name = (row.cells[keyIndex] ?? "").trim();
    if (keySlug(name) === "") {
      unnamed += 1;
      continue;
    }
    const more = alsoIndex === null ? "" : (row.cells[alsoIndex] ?? "").trim();
    const key = more === "" ? name : `${name} · ${more}`;
    const slug = keySlug(key);
    let group = out.get(slug);
    if (!group) {
      group = {
        key,
        slug,
        rows: 0,
        count: 0,
        quantities: quantityColumns.map((c) => ({
          header: c.header,
          unit: c.unit,
          dimension: c.dimension,
          totalThousandths: 0,
        })),
      };
      out.set(slug, group);
    }
    group.rows += 1;
    const counted = count ? readQuantity(row.cells[count.index] ?? "") : null;
    group.count += counted ? Math.round(counted.valueThousandths / 1000) : 1;
    quantityColumns.forEach((c, i) => {
      const q = readQuantity(row.cells[c.index] ?? "");
      if (q && q.unit === c.unit) group.quantities[i].totalThousandths += q.valueThousandths;
    });
  }
  return { rows: [...out.values()], unnamed };
}

/* ------------------------------------------------------ which assembly it is */

export interface AssemblyToMatch {
  id: string;
  name: string;
  drivingUnit: string;
  /** What the model has called this before, as the business confirmed it. */
  keys: readonly string[];
}

export type MatchHow = "remembered" | "words";

/**
 * The assembly a name means: the one the business has said it means
 * before, else the one whose every significant word the name contains —
 * *Interior door, hung* is not in *Single-Flush: 36" x 80"*, and this will
 * not pretend it is. A suggestion by words is offered, never taken.
 */
export function matchAssembly(
  row: Pick<TakeoffRow, "key" | "slug">,
  assemblies: readonly AssemblyToMatch[],
): { assemblyId: string; how: MatchHow } | null {
  const remembered = assemblies.find((a) => a.keys.some((k) => keySlug(k) === row.slug));
  if (remembered) return { assemblyId: remembered.id, how: "remembered" };
  const have = significantWords(row.key);
  if (have.size === 0) return null;
  let best: { id: string; words: number } | null = null;
  for (const a of assemblies) {
    const wanted = [...significantWords(a.name)];
    if (wanted.length === 0 || !wanted.every((w) => have.has(w))) continue;
    if (!best || wanted.length > best.words) best = { id: a.id, words: wanted.length };
  }
  return best ? { assemblyId: best.id, how: "words" } : null;
}

/* ------------------------------------------------------ the figure it is at */

/**
 * Which quantity column answers a dimension, best first: a wall's *Length*
 * before its *Unconnected Height*, a takeoff's *Material: Area* over a
 * bare *Area* only when that is all there is.
 */
const PREFERRED: Record<Dimension, string[]> = {
  length: ["length", "cut length", "perimeter", "unconnected height", "height", "width"],
  area: ["area", "material: area", "net area", "gross area"],
  volume: ["volume", "material: volume"],
  count: ["count"],
};

export interface Driver {
  valueThousandths: number;
  /** The figure it came from, in words: "Length 248 lf", "12 in the schedule". */
  from: string;
}

function figure(valueThousandths: number, unit: string): string {
  const n = formatQuantity(valueThousandths);
  return unit === "" ? n : `${n} ${unit}`;
}

/**
 * **THE QUANTITY AN ASSEMBLY IS DROPPED AT, FROM WHAT THE MODEL SAYS.**
 *
 * An assembly is per something — `320 sf`, `10 lf`, one door. The row's
 * quantity in that dimension drives it, converted into the assembly's own
 * unit; an assembly per nothing, or per a unit this cannot read, is dropped
 * once per thing counted. A row with no figure in the dimension cannot drive
 * the assembly at all, and says so rather than guessing: a drywall assembly
 * needs an area, and a schedule that only has lengths has not given one.
 */
export function driverFor(
  row: Pick<TakeoffRow, "count" | "quantities">,
  assembly: Pick<AssemblyToMatch, "drivingUnit">,
): Driver | null {
  const unit = canonicalUnit(assembly.drivingUnit);
  const byCount = (): Driver | null =>
    row.count > 0
      ? { valueThousandths: row.count * 1000, from: `${row.count} in the schedule` }
      : null;
  if (unit === null || dimensionOf(unit) === "count") return byCount();
  const dimension = dimensionOf(unit);
  const candidates = row.quantities.filter(
    (q) => q.dimension === dimension && q.totalThousandths > 0,
  );
  if (candidates.length === 0) return null;
  const preferred = PREFERRED[dimension];
  const ranked = [...candidates].sort((a, b) => {
    const ia = preferred.indexOf(normal(a.header));
    const ib = preferred.indexOf(normal(b.header));
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const chosen = ranked[0];
  const value = convertThousandths(chosen.totalThousandths, chosen.unit, assembly.drivingUnit);
  if (value === null || value <= 0) return null;
  return {
    valueThousandths: value,
    from: `${chosen.header} ${figure(chosen.totalThousandths, chosen.unit)}`,
  };
}

/**
 * Why a row cannot drive an assembly, for the person who asked it to.
 */
export function whyNoDriver(
  row: Pick<TakeoffRow, "count" | "quantities">,
  assembly: Pick<AssemblyToMatch, "name" | "drivingUnit">,
): string {
  const unit = canonicalUnit(assembly.drivingUnit);
  if (unit === null || dimensionOf(unit) === "count") return "the schedule counts nothing for it";
  const dimension = dimensionOf(unit);
  const any = row.quantities.some((q) => q.dimension === dimension && q.totalThousandths > 0);
  if (!any) {
    return `${assembly.name} is per ${assembly.drivingUnit.trim()} and the schedule has no ${dimension === "area" ? "area" : dimension} for it`;
  }
  return `the schedule's ${dimension} cannot be turned into ${assembly.drivingUnit.trim()}`;
}

/* ------------------------------------------------------------- as a line */

export interface LineFromModel {
  description: string;
  quantityThousandths: number;
  unit: string;
}

/**
 * A row as a plain estimate line, when no assembly makes it: the model's
 * name as the description and one of its figures as the quantity — the
 * column the person chose, or the count. Priced by the price book or by
 * hand, exactly as a line pasted off a spreadsheet is.
 */
export function lineFromRow(row: TakeoffRow, from: string): LineFromModel | null {
  if (from === "count") {
    return row.count > 0
      ? { description: row.key, quantityThousandths: row.count * 1000, unit: "ea" }
      : null;
  }
  const q = row.quantities.find((x) => normal(x.header) === normal(from));
  if (!q || q.totalThousandths <= 0) return null;
  return { description: row.key, quantityThousandths: q.totalThousandths, unit: q.unit };
}

/** Where a figure came from, for the line's basis: the whole story in one clause. */
export function offTheModel(schedule: Pick<Schedule, "title">, fileName: string, row: Pick<TakeoffRow, "key">, from: string): string {
  const source = schedule.title.trim() !== "" ? schedule.title.trim() : fileName.trim() || "the model";
  return `off the model: ${source} · ${row.key} · ${from}`.slice(0, 200);
}
