/**
 * Units of measure. PURE — no imports, no database, no `server-only`.
 *
 * THE RULE THE WHOLE PACK RESTS ON, from the Inventory design:
 *
 * > Every item has exactly one stocking unit and its balance is kept only in
 * > that unit. Buy feed in bags, keep the balance in pounds.
 *
 * That kills the "is my number in bags or pounds" class of bug before it
 * starts. A purchase unit is an ENTRY convenience converted at the edge, never
 * a second balance — the same arrangement `land` uses for acres.
 *
 * THREE KINDS OF CONVERSION, and only two of them live here:
 *
 *   1. **Fixed and exact** — 12 each = 1 dozen, 2000 lb = 1 ton. Universal, so
 *      they are constants in code rather than tenant data. Nobody's dozen is
 *      thirteen.
 *   2. **Fixed but item-specific** — a 50 lb bag of feed; a flat of eggs is
 *      THIRTY, not twelve. "1 bag" means nothing in general, so this lives on
 *      the item row, not here.
 *   3. **Measured per lot** — a steer goes in at 1,150 lb live and hangs at
 *      690. **That is not a conversion at all.** Modelling it as a factor bakes
 *      a permanent unauditable fudge into the books and every carcass is
 *      quietly wrong. It is a production yield, it belongs to the `production`
 *      pack, and inventory must have no opinion on it.
 */

/**
 * What a unit measures. Conversion is only ever defined WITHIN a dimension —
 * there is no factor between pounds and gallons that does not depend on what
 * is in the bucket.
 */
export type UnitDimension = "mass" | "volume" | "count" | "area";

export interface UnitDefinition {
  code: string;
  dimension: UnitDimension;
  /** How many BASE units this one is worth. Base is the dimension's canonical unit. */
  perBase: number;
  singular: string;
  plural: string;
}

/**
 * The base unit per dimension: pound, gallon, each, acre.
 *
 * US-customary, matching the `land` pack's decision that US-only is acceptable
 * for this profile. Metric units convert exactly and are offered; nothing here
 * prevents a metric tenant, it just means their balances are stored in pounds.
 */
export const UNITS: readonly UnitDefinition[] = [
  // mass — base: pound
  { code: "lb", dimension: "mass", perBase: 1, singular: "pound", plural: "pounds" },
  { code: "oz", dimension: "mass", perBase: 1 / 16, singular: "ounce", plural: "ounces" },
  { code: "ton", dimension: "mass", perBase: 2000, singular: "ton", plural: "tons" },
  { code: "kg", dimension: "mass", perBase: 2.20462262185, singular: "kilogram", plural: "kilograms" },
  { code: "g", dimension: "mass", perBase: 0.00220462262185, singular: "gram", plural: "grams" },
  // volume — base: gallon
  { code: "gal", dimension: "volume", perBase: 1, singular: "gallon", plural: "gallons" },
  { code: "qt", dimension: "volume", perBase: 0.25, singular: "quart", plural: "quarts" },
  { code: "pt", dimension: "volume", perBase: 0.125, singular: "pint", plural: "pints" },
  { code: "floz", dimension: "volume", perBase: 1 / 128, singular: "fluid ounce", plural: "fluid ounces" },
  { code: "l", dimension: "volume", perBase: 0.264172052358, singular: "litre", plural: "litres" },
  // count — base: each
  { code: "each", dimension: "count", perBase: 1, singular: "each", plural: "each" },
  { code: "dozen", dimension: "count", perBase: 12, singular: "dozen", plural: "dozen" },
  /**
   * HEAD IS A UNIT OF MEASURE, and that is the decision that let the lot spine
   * be one mechanism. "70 head" is a quantity exactly as "500 lb" is — so the
   * head ledger and the inventory ledger were always the same ledger, and
   * `livestock` needs no parallel counter.
   */
  { code: "head", dimension: "count", perBase: 1, singular: "head", plural: "head" },
  // area — base: acre. Shared vocabulary with `land`, which stores acres too.
  { code: "acre", dimension: "area", perBase: 1, singular: "acre", plural: "acres" },
] as const;

const BY_CODE = new Map(UNITS.map((u) => [u.code, u]));

export function getUnit(code: string): UnitDefinition | null {
  return BY_CODE.get(code) ?? null;
}

export function isKnownUnit(code: string): boolean {
  return BY_CODE.has(code);
}

/** Every unit that can convert to this one. The picker's options. */
export function unitsInDimensionOf(code: string): UnitDefinition[] {
  const unit = getUnit(code);
  if (!unit) return [];
  return UNITS.filter((u) => u.dimension === unit.dimension);
}

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitError";
  }
}

/**
 * Convert between two units OF THE SAME DIMENSION.
 *
 * Throws across dimensions rather than guessing. There is no universal factor
 * between pounds and gallons — it depends entirely on what is in the container —
 * and an app that quietly invented one would produce balances nobody could
 * explain.
 */
export function convert(value: number, from: string, to: string): number {
  const a = getUnit(from);
  const b = getUnit(to);
  if (!a) throw new UnitError(`unknown unit: ${from}`);
  if (!b) throw new UnitError(`unknown unit: ${to}`);
  if (a.dimension !== b.dimension) {
    throw new UnitError(
      `cannot convert ${from} to ${to}: ${a.dimension} is not ${b.dimension}`,
    );
  }
  if (a.code === b.code) return value;
  // Round to the quantity column's scale. Anything finer is lost on write, so
  // returning it would imply a precision the database does not keep.
  return roundQuantity((value * a.perBase) / b.perBase);
}

/** `numeric(18,4)` — the scale every quantity in this pack is stored at. */
export function roundQuantity(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * "12.5 lb", "1 head", "—".
 *
 * Null renders as an em dash, never as 0 — the same rule `land` applies to an
 * unmeasured area and `assets` to an unknown cost. "None on hand" and "never
 * counted" are different facts.
 */
export function formatQuantity(value: number | null, unitCode: string): string {
  if (value === null) return "—";
  const unit = getUnit(unitCode);
  const shown = Number(roundQuantity(value).toFixed(4)).toString();
  if (!unit) return `${shown} ${unitCode}`;
  return `${shown} ${value === 1 ? unit.singular : unit.plural}`;
}

/**
 * How many stocking units one purchase unit is worth.
 *
 * Item-specific conversions win — a bag is 50 lb because THIS item says so, and
 * no global table can know that. Where the item says nothing, an exact global
 * conversion is used if the two units share a dimension. Returns null when
 * neither applies, which the caller must treat as "cannot convert" rather than
 * as 1.
 */
export function purchaseUnitFactor(item: {
  stockingUnit: string;
  purchaseUnit: string | null;
  purchaseUnitQty: number | null;
}): number | null {
  if (!item.purchaseUnit || item.purchaseUnit === item.stockingUnit) return 1;
  if (item.purchaseUnitQty !== null && item.purchaseUnitQty > 0) {
    return item.purchaseUnitQty;
  }
  try {
    return convert(1, item.purchaseUnit, item.stockingUnit);
  } catch {
    return null;
  }
}
