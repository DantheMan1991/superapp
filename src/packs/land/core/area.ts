/**
 * Area arithmetic. PURE — no imports, no database, no `server-only`.
 *
 * Acres are the canonical store (see the `area_acres` column comment in
 * `src/db/schema/land.ts`); `packConfig.land.areaUnit` is a display and entry
 * unit. Conversion happens HERE, at the edge, so nothing downstream has to ask
 * what unit a number is in before it can add two of them.
 *
 * THIS IS NOT MONEY. `cash-basis-allocate.ts` is quarantined because dividing
 * dollars can invent or lose a cent; area has no such duty, and rounding half
 * a square metre off a paddock costs nothing. What area DOES do is act as the
 * divisor in per-acre figures, which is why the one thing this file is careful
 * about is refusing to treat an unknown area as zero.
 */

/** Exact, by definition: 1 international acre = 4046.8564224 m². */
const SQ_M_PER_ACRE = 4046.8564224;
const SQ_M_PER_HECTARE = 10_000;
const ACRES_PER_HECTARE = SQ_M_PER_HECTARE / SQ_M_PER_ACRE;

export const AREA_UNITS = ["acre", "hectare"] as const;
export type AreaUnit = (typeof AREA_UNITS)[number];

export const DEFAULT_AREA_UNIT: AreaUnit = "acre";

export function isAreaUnit(value: unknown): value is AreaUnit {
  return (
    typeof value === "string" && (AREA_UNITS as readonly string[]).includes(value)
  );
}

/**
 * The tenant's unit, from `packConfig.land.areaUnit`.
 *
 * TOTAL BY CONSTRUCTION. `tenant_modules.config` is jsonb with no shape
 * constraint and most tenants have never installed a profile at all, so an
 * unreadable value must mean the default rather than a crashed page — the same
 * discipline `resolveLabels` follows.
 */
export function areaUnitFrom(config: unknown): AreaUnit {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).areaUnit;
    if (isAreaUnit(value)) return value;
  }
  return DEFAULT_AREA_UNIT;
}

/** Column scale is 4, so anything finer than this is lost on write anyway. */
function roundAcres(acres: number): number {
  return Math.round(acres * 10_000) / 10_000;
}

/** A number entered in the tenant's unit → acres, for storage. */
export function toAcres(value: number, unit: AreaUnit): number {
  return roundAcres(unit === "hectare" ? value * ACRES_PER_HECTARE : value);
}

/** Stored acres → the tenant's unit, for display. */
export function fromAcres(acres: number, unit: AreaUnit): number {
  const value = unit === "hectare" ? acres / ACRES_PER_HECTARE : acres;
  return Math.round(value * 10_000) / 10_000;
}

export const AREA_UNIT_LABELS: Record<AreaUnit, { one: string; many: string }> =
  {
    acre: { one: "acre", many: "acres" },
    hectare: { one: "hectare", many: "hectares" },
  };

/**
 * "12.5 acres", or an em dash when the area is not recorded.
 *
 * NULL RENDERS AS "—", NEVER AS 0 — the same rule `assets` applies to cost, and
 * for a sharper reason: a zero area is a divide-by-zero waiting in every
 * per-acre report, while "not recorded" is a fact somebody can go and fix.
 */
export function formatArea(
  acres: number | null,
  unit: AreaUnit = DEFAULT_AREA_UNIT,
): string {
  if (acres === null) return "—";
  const value = fromAcres(acres, unit);
  // Trailing zeros are noise on a field boundary: 12.5 acres, not 12.5000.
  const shown = Number(value.toFixed(4)).toString();
  const words = AREA_UNIT_LABELS[unit];
  return `${shown} ${value === 1 ? words.one : words.many}`;
}

export interface AreaTotal {
  /** Sum of what IS recorded. */
  acres: number;
  /** How many rows contributed nothing because their area is unknown. */
  unknown: number;
  /** How many rows there were in total. */
  count: number;
}

/**
 * Total a set of areas WITHOUT letting an unknown one read as zero.
 *
 * The count of unknowns is returned rather than swallowed because it is the
 * difference between "this farm is 142 acres" and "this farm is at least 142
 * acres, and two parcels have never been measured". A total that hides the
 * second is confidently wrong, and every per-acre number computed from it
 * inherits the error silently.
 */
export function totalArea(areas: (number | null)[]): AreaTotal {
  let acres = 0;
  let unknown = 0;
  for (const area of areas) {
    if (area === null) unknown += 1;
    else acres += area;
  }
  return { acres: roundAcres(acres), unknown, count: areas.length };
}

/**
 * "142.5 acres", "142.5 acres (2 not recorded)", or "not recorded".
 *
 * A total of nothing-known is NOT "0 acres". Nobody owns zero acres; they own
 * ground nobody has measured.
 */
export function formatAreaTotal(
  total: AreaTotal,
  unit: AreaUnit = DEFAULT_AREA_UNIT,
): string {
  if (total.count > 0 && total.unknown === total.count) return "not recorded";
  const base = formatArea(total.acres, unit);
  return total.unknown > 0 ? `${base} (${total.unknown} not recorded)` : base;
}

/**
 * How much of a parcel its zones account for.
 *
 * Zones do not have to tile a parcel — lanes, ditches and the bit behind the
 * barn are real and frequently unmapped — so this REPORTS the difference and
 * never enforces it. A hard constraint here would make the honest state
 * (some ground not yet divided up) unrepresentable.
 */
export function zoneCoverage(
  parcelAcres: number | null,
  zoneAreas: (number | null)[],
): { assigned: AreaTotal; unassignedAcres: number | null; overAssigned: boolean } {
  const assigned = totalArea(zoneAreas);
  if (parcelAcres === null || assigned.unknown > 0) {
    return { assigned, unassignedAcres: null, overAssigned: false };
  }
  const remainder = roundAcres(parcelAcres - assigned.acres);
  return {
    assigned,
    unassignedAcres: remainder,
    overAssigned: remainder < 0,
  };
}
