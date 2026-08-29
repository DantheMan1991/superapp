/**
 * What a plan will take to build. PURE — no imports but the other core files,
 * no database, no `server-only`.
 *
 * **A TAKEOFF IS ARITHMETIC ON A SHAPE YOU DREW**, and that is the whole of the
 * line between it and the optimizer this pack refuses: 1,240 ft of fence ÷ 8 ft
 * spacing = 156 posts. Nothing here decides anything. Every number can be
 * checked by looking at the drawing and doing the division yourself, which is
 * the test docs/modules/land.md settled on after the rule needed sharpening
 * twice.
 *
 * **IT NEVER GUESSES A MISSING FIGURE.** A fence with no post spacing recorded
 * produces a NOTE saying so, not a post count off a default nobody chose. "156
 * posts" from a spacing you never set is a made-up number wearing a decimal
 * point, and it would be ordered from. This is the first thing in the pack that
 * READS the attribute bag rather than displaying it, and the bag is only worth
 * having if what comes out of it is what somebody put in.
 */
import { geometryLengthM, shapeOf, type FeatureGeometry } from "./geo";
import { featureKindLabel } from "./features";
import { fromMetres, type LengthUnit } from "./length";

/** What a feature has to offer this file. A narrow view of `land_features`. */
export interface TakeoffFeature {
  id: string;
  name: string;
  kind: string;
  geometry: FeatureGeometry | null;
  attributes: Record<string, string | number | boolean>;
}

/**
 * A quantity of something, and where it came from.
 *
 * `sourceFeatureId` is nullable because **a materials list that can only hold
 * what geometry produced is useless the first time you need insulators and a
 * bag of staples.** Hand-added lines are the point of that column.
 */
export interface TakeoffLine {
  /** Open taxonomy, lowercase: `post`, `wire`, `pipe`, `gate`. */
  material: string;
  label: string;
  quantity: number;
  unit: TakeoffUnit;
  sourceFeatureId: string | null;
  sourceName: string;
}

export type TakeoffUnit = "each" | "ft" | "m";

/** Something the drawing cannot answer, said out loud rather than guessed. */
export interface TakeoffNote {
  featureId: string;
  featureName: string;
  message: string;
}

export interface Takeoff {
  lines: TakeoffLine[];
  notes: TakeoffNote[];
}

/** The attribute keys this file reads. Named here so the form can offer them. */
export const POST_SPACING_KEY = "post_spacing";
export const WIRE_COUNT_KEY = "wire_count";

function numberFrom(
  attributes: Record<string, string | number | boolean>,
  key: string,
): number | null {
  const raw = attributes[key];
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  // A form sends "8" and a paste sends 8. Both are somebody typing a number.
  if (typeof raw === "string") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * The materials a plan needs, one set of lines per feature.
 *
 * **LENGTHS COME OUT IN THE TENANT'S OWN UNIT**, because this is a list to
 * order from and nobody buys fence by the metre in a country that sells it by
 * the foot. `post_spacing` is read in that same unit — it is a figure somebody
 * typed on a screen labelled in it.
 *
 * Per feature rather than pre-totalled: the sum is one `reduce` away and cannot
 * be un-summed, and checking a number means finding the fence it came from.
 */
export function takeoffFor(
  features: readonly TakeoffFeature[],
  unit: LengthUnit,
): Takeoff {
  const lines: TakeoffLine[] = [];
  const notes: TakeoffNote[] = [];
  const lengthUnit: TakeoffUnit = unit === "foot" ? "ft" : "m";

  for (const feature of features) {
    const name = feature.name || featureKindLabel(feature.kind);
    const add = (
      material: string,
      label: string,
      quantity: number,
      itemUnit: TakeoffUnit,
    ) => {
      if (!(quantity > 0)) return;
      lines.push({
        material,
        label,
        // Two decimals: a shopping list rounds, and a length good to the
        // centimetre claims more than a traced line can support.
        quantity: Math.round(quantity * 100) / 100,
        unit: itemUnit,
        sourceFeatureId: feature.id,
        sourceName: name,
      });
    };
    const note = (message: string) =>
      notes.push({ featureId: feature.id, featureName: name, message });

    if (!feature.geometry) {
      note("has not been drawn yet, so nothing can be counted from it");
      continue;
    }

    const shape = shapeOf(feature.geometry);
    const metres = geometryLengthM(feature.geometry);
    const length = fromMetres(metres, unit);

    /**
     * THE GENERIC RULES, which is what makes this work for a kind the pack has
     * never heard of. A point is one of the thing; a line is its length. Both
     * restate the drawing rather than inventing anything, so a profile's own
     * `trough` or `energizer` gets counted without this file learning the word.
     * An AREA gets nothing: there is no generic material in an acre.
     */
    if (shape === "point") {
      add(feature.kind, featureKindLabel(feature.kind), 1, "each");
    } else if (shape === "line") {
      add(feature.kind, featureKindLabel(feature.kind), length, lengthUnit);
    }

    // …and the specifics, for the kinds where a length implies more than itself.
    if (feature.kind === "fence" && shape === "line") {
      const spacing = numberFrom(feature.attributes, POST_SPACING_KEY);
      if (spacing === null) {
        note(`needs a ${POST_SPACING_KEY} before posts can be counted`);
      } else {
        // Posts at both ends, so the count is spans plus one.
        add("post", "Posts", Math.floor(length / spacing) + 1, "each");
      }

      const strands = numberFrom(feature.attributes, WIRE_COUNT_KEY);
      if (strands === null) {
        note(`needs a ${WIRE_COUNT_KEY} before wire can be counted`);
      } else {
        add("wire", "Wire", length * strands, lengthUnit);
      }
    }
  }

  return { lines, notes };
}

/** One line per material and unit, for the list you actually order from. */
export interface TakeoffTotal {
  material: string;
  label: string;
  quantity: number;
  unit: TakeoffUnit;
}

export function totalsOf(lines: readonly TakeoffLine[]): TakeoffTotal[] {
  const byKey = new Map<string, TakeoffTotal>();
  for (const line of lines) {
    const key = `${line.material}:${line.unit}`;
    const found = byKey.get(key);
    if (found) found.quantity = Math.round((found.quantity + line.quantity) * 100) / 100;
    else {
      byKey.set(key, {
        material: line.material,
        label: line.label,
        quantity: line.quantity,
        unit: line.unit,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The saved list against what the drawing says now.
 *
 * **IT REPORTS, IT NEVER CORRECTS** — the rule `compareArea` already follows for
 * a deed that disagrees with a boundary, and the reason a saved takeoff is a
 * SNAPSHOT rather than a live query. You ordered from 1,240 ft. Somebody has
 * since nudged the line to 1,310. Recomputing on read would silently rewrite
 * what you bought from, which is the one thing a saved list exists to prevent.
 */
export interface TakeoffDrift {
  material: string;
  label: string;
  unit: TakeoffUnit;
  saved: number;
  now: number;
  difference: number;
}

export function driftOf(
  saved: readonly TakeoffTotal[],
  now: readonly TakeoffTotal[],
): TakeoffDrift[] {
  const nowByKey = new Map(now.map((t) => [`${t.material}:${t.unit}`, t]));
  const savedByKey = new Map(saved.map((t) => [`${t.material}:${t.unit}`, t]));
  const keys = new Set([...nowByKey.keys(), ...savedByKey.keys()]);

  const drift: TakeoffDrift[] = [];
  for (const key of keys) {
    const before = savedByKey.get(key);
    const after = nowByKey.get(key);
    const savedQty = before?.quantity ?? 0;
    const nowQty = after?.quantity ?? 0;
    const difference = Math.round((nowQty - savedQty) * 100) / 100;
    // Only what MOVED. A list where every line reads "no change" is a list
    // nobody scans for the one that did.
    if (difference === 0) continue;
    drift.push({
      material: (before ?? after)!.material,
      label: (before ?? after)!.label,
      unit: (before ?? after)!.unit,
      saved: savedQty,
      now: nowQty,
      difference,
    });
  }
  return drift.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * What a line costs, when somebody has typed a unit price.
 *
 * **THE PRICE IS WHAT YOU TYPED, ON THAT LINE, ON THAT DAY — NEVER A CATALOG.**
 * The moment there is a price list there are vendors, quotes and effective
 * dates, and this slice has quietly become purchasing. Quantities are the
 * deliverable; a dollar figure is a convenience stored beside them.
 */
export function lineCost(quantity: number, unitCost: number | null): number | null {
  if (unitCost === null || !Number.isFinite(unitCost)) return null;
  return Math.round(quantity * unitCost * 100) / 100;
}
