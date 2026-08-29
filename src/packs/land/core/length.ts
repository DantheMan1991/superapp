/**
 * Length display. PURE — no imports, no database, no `server-only`.
 *
 * The sibling of `area.ts`, with ONE DIFFERENCE THAT MATTERS: **area has a
 * canonical store and length does not.** `area_acres` is a column because a
 * deed states an acreage and a boundary is allowed to disagree with it; a
 * length is never typed in and never stored, it is computed from the geometry
 * by `geometryLengthM` every time it is shown.
 *
 * So there is no `toMetres` here to match `toAcres`. Nothing writes a length,
 * which means nothing can write one in the wrong unit — and the slice that adds
 * a saved takeoff (2b.1) stores the QUANTITY it computed, not the length it
 * came from.
 *
 * Metres are the internal unit because that is what haversine returns. Feet are
 * the default DISPLAY unit because the profile this pack was built for buys
 * fence by the foot and wire by the roll.
 */

/** Exact, by definition: 1 international foot = 0.3048 m. */
const M_PER_FOOT = 0.3048;

export const LENGTH_UNITS = ["foot", "metre"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const DEFAULT_LENGTH_UNIT: LengthUnit = "foot";

export function isLengthUnit(value: unknown): value is LengthUnit {
  return (
    typeof value === "string" &&
    (LENGTH_UNITS as readonly string[]).includes(value)
  );
}

/**
 * The tenant's unit, from `packConfig.land.lengthUnit`.
 *
 * TOTAL BY CONSTRUCTION, exactly as `areaUnitFrom` is: `tenant_modules.config`
 * is jsonb with no shape constraint, so anything unreadable means the default
 * rather than a page that throws while rendering a fence.
 *
 * SEPARATE FROM `areaUnit` ON PURPOSE, though most tenants will set both the
 * same way. They are not the same choice: the acre survives in places that
 * otherwise went metric, and a tenant who measures ground in hectares may still
 * buy fence by the metre — or by the foot, if that is what the supplier quotes.
 * Deriving one from the other would be a guess this file has no basis for.
 */
export function lengthUnitFrom(config: unknown): LengthUnit {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).lengthUnit;
    if (isLengthUnit(value)) return value;
  }
  return DEFAULT_LENGTH_UNIT;
}

/** Metres → the tenant's unit, for display. */
export function fromMetres(metres: number, unit: LengthUnit): number {
  return unit === "foot" ? metres / M_PER_FOOT : metres;
}

/** The tenant's unit → metres. For a spacing somebody typed, not for a length. */
export function toMetres(value: number, unit: LengthUnit): number {
  return unit === "foot" ? value * M_PER_FOOT : value;
}

export const LENGTH_UNIT_LABELS: Record<LengthUnit, { short: string }> = {
  foot: { short: "ft" },
  metre: { short: "m" },
};

/**
 * "1,240 ft", or an em dash when there is no geometry to measure.
 *
 * **ROUNDED TO THE WHOLE UNIT, AND THAT IS THE POINT.** A fence traced off
 * aerial imagery is good to a few feet at best, so "1,240.37 ft" claims a
 * precision the source cannot support and invites somebody to order wire to it.
 * The same reasoning `AREA_DISAGREEMENT_THRESHOLD` is loose for.
 *
 * NULL RENDERS AS "—", NEVER AS 0, the rule `formatArea` already follows: a
 * feature whose geometry has not been drawn yet has no length, and a zero would
 * read as one that is nothing long.
 */
export function formatLength(
  metres: number | null,
  unit: LengthUnit = DEFAULT_LENGTH_UNIT,
): string {
  if (metres === null) return "—";
  const value = Math.round(fromMetres(metres, unit));
  return `${value.toLocaleString("en-US")} ${LENGTH_UNIT_LABELS[unit].short}`;
}

/**
 * "±3 m" / "±10 ft" — how well the phone knows where it is.
 *
 * **THE ± IS NOT DECORATION AND THE FIGURE IS NOT OPTIONAL.** A screen that
 * shows a position without its accuracy is the screen that gets a post planted
 * in the wrong place with total confidence. `GeolocationCoordinates.accuracy`
 * is a 95% radius in metres and every browser reports it, so there is never a
 * reason to hide it.
 *
 * Rounded UP, unlike every other length here. A ±3.4 m reading shown as "±3 m"
 * claims a little more than the instrument offered, and this is the one number
 * in the pack where erring generous is the wrong direction.
 */
export function formatAccuracy(
  metres: number | null,
  unit: LengthUnit = DEFAULT_LENGTH_UNIT,
): string {
  if (metres === null || !Number.isFinite(metres)) return "±?";
  const value = Math.ceil(fromMetres(metres, unit));
  return `±${value.toLocaleString("en-US")} ${LENGTH_UNIT_LABELS[unit].short}`;
}

export interface LengthTotal {
  /** Sum of what could be measured, in metres. */
  metres: number;
  /** How many features contributed nothing because they have no geometry. */
  unknown: number;
  count: number;
}

/**
 * Total a set of lengths WITHOUT letting an undrawn feature read as zero.
 *
 * Same shape and same reason as `totalArea`: "3,400 ft of fence" and "3,400 ft
 * of fence, and two runs nobody has drawn yet" are different answers, and the
 * second is the one that tells you the number is a floor.
 */
export function totalLength(lengths: (number | null)[]): LengthTotal {
  let metres = 0;
  let unknown = 0;
  for (const length of lengths) {
    if (length === null) unknown += 1;
    else metres += length;
  }
  return { metres, unknown, count: lengths.length };
}

/** "3,400 ft", "3,400 ft (2 not drawn)", or "not drawn". */
export function formatLengthTotal(
  total: LengthTotal,
  unit: LengthUnit = DEFAULT_LENGTH_UNIT,
): string {
  if (total.count > 0 && total.unknown === total.count) return "not drawn";
  const base = formatLength(total.metres, unit);
  return total.unknown > 0 ? `${base} (${total.unknown} not drawn)` : base;
}
