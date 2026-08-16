import { describe, expect, it } from "vitest";
import {
  AREA_UNITS,
  DEFAULT_AREA_UNIT,
  areaUnitFrom,
  formatArea,
  formatAreaTotal,
  fromAcres,
  isAreaUnit,
  toAcres,
  totalArea,
  zoneCoverage,
} from "../src/packs/land/core/area";
import {
  SUGGESTED_ZONE_USES,
  TENURES,
  defaultProductive,
  isTenure,
  isValidZoneUse,
  zoneUseLabel,
  DEFAULT_STRUCTURE_KINDS,
  structureKindsFrom,
  ZONE_USE_FORMAT,
} from "../src/packs/land/vocabulary";

/**
 * The pure half of the `land` pack: area arithmetic and vocabulary.
 *
 * Most of what is worth asserting here is about the difference between ZERO
 * and UNKNOWN. An unmeasured parcel that reads as 0 acres is the bug that makes
 * every per-acre figure downstream wrong without anything looking broken, so
 * the null path is tested harder than the arithmetic.
 */

describe("area units", () => {
  it("round-trips acres through the tenant's unit", () => {
    for (const unit of AREA_UNITS) {
      expect(fromAcres(toAcres(12.5, unit), unit)).toBe(12.5);
    }
  });

  it("converts hectares to acres at the defined ratio", () => {
    // 1 ha = 10,000 m²; 1 acre = 4046.8564224 m² exactly.
    expect(toAcres(1, "hectare")).toBeCloseTo(2.4711, 4);
    expect(toAcres(10, "hectare")).toBeCloseTo(24.7105, 4);
  });

  it("leaves acres alone", () => {
    expect(toAcres(40, "acre")).toBe(40);
    expect(fromAcres(40, "acre")).toBe(40);
  });

  it("rounds to the column's scale, so nothing is lost on write", () => {
    // numeric(12,4): anything finer than 0.0001 acre (~0.4 m²) cannot be stored.
    expect(toAcres(1.234567, "acre")).toBe(1.2346);
  });
});

describe("areaUnitFrom", () => {
  it("reads the tenant's unit out of pack config", () => {
    expect(areaUnitFrom({ areaUnit: "hectare" })).toBe("hectare");
  });

  // TOTAL BY CONSTRUCTION. tenant_modules.config is jsonb with no shape
  // constraint and most tenants have no profile at all, so every one of these
  // is the ordinary path rather than an edge case.
  it.each([
    ["missing", undefined],
    ["null", null],
    ["an array", ["hectare"]],
    ["a string", "hectare"],
    ["an unknown unit", { areaUnit: "furlong" }],
    ["a non-string unit", { areaUnit: 42 }],
    ["an empty object", {}],
  ])("falls back to the default when config is %s", (_label, config) => {
    expect(areaUnitFrom(config)).toBe(DEFAULT_AREA_UNIT);
  });

  it("recognises only the units it can convert", () => {
    expect(isAreaUnit("acre")).toBe(true);
    expect(isAreaUnit("hectare")).toBe(true);
    expect(isAreaUnit("section")).toBe(false);
  });
});

describe("structureKindsFrom", () => {
  // The picker built on this shipped unfiltered and offered a chest freezer
  // and a tractor as places to put chickens. Found by clicking, 2026-08-16.
  it("does not count equipment as somewhere to put an animal", () => {
    expect(DEFAULT_STRUCTURE_KINDS).not.toContain("equipment");
    expect(DEFAULT_STRUCTURE_KINDS).not.toContain("vehicle");
    expect(DEFAULT_STRUCTURE_KINDS).toContain("building");
  });

  it("takes the tenant's own kinds when it has them", () => {
    // A chicken tractor is equipment to an accountant and a home to a bird.
    expect(structureKindsFrom({ structureKinds: ["coop", "chicken_tractor"] }))
      .toEqual(["coop", "chicken_tractor"]);
  });

  it("honours an explicitly empty list rather than overriding it", () => {
    // A farm that keeps nothing in a structure gets no picker, and that is a
    // configured answer rather than a missing one.
    expect(structureKindsFrom({ structureKinds: [] })).toEqual([]);
  });

  it("drops entries that are not usable kinds", () => {
    expect(structureKindsFrom({ structureKinds: ["barn", "", 42, null] }))
      .toEqual(["barn"]);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["an array", ["barn"]],
    ["a string", "barn"],
    ["a non-array value", { structureKinds: "barn" }],
    ["an empty object", {}],
  ])("falls back to the default when config is %s", (_label, config) => {
    expect(structureKindsFrom(config)).toEqual([...DEFAULT_STRUCTURE_KINDS]);
  });
});

describe("formatArea", () => {
  it("renders an unknown area as an em dash, never as zero", () => {
    expect(formatArea(null)).toBe("—");
    expect(formatArea(null, "hectare")).toBe("—");
  });

  it("does not print trailing zeros", () => {
    expect(formatArea(12.5)).toBe("12.5 acres");
    expect(formatArea(40)).toBe("40 acres");
  });

  it("singularises exactly one, in whatever unit is being shown", () => {
    // The argument is always ACRES — the canonical store — so one hectare is
    // 2.4711 of them. Getting this backwards would silently mislabel every
    // area on a hectare tenant's screen.
    expect(formatArea(1)).toBe("1 acre");
    expect(formatArea(toAcres(1, "hectare"), "hectare")).toBe("1 hectare");
    expect(formatArea(1, "hectare")).toBe("0.4047 hectares");
  });

  it("shows the tenant's unit", () => {
    expect(formatArea(toAcres(10, "hectare"), "hectare")).toBe("10 hectares");
  });
});

describe("totalArea", () => {
  it("sums what is known and counts what is not", () => {
    expect(totalArea([10, null, 32.5, null])).toEqual({
      acres: 42.5,
      unknown: 2,
      count: 4,
    });
  });

  it("treats an empty set as nothing rather than as unknown", () => {
    expect(totalArea([])).toEqual({ acres: 0, unknown: 0, count: 0 });
  });

  it("never lets an unknown area contribute zero silently", () => {
    const total = totalArea([null, null]);
    expect(total.acres).toBe(0);
    // The count is the whole point: 0 acres and "two parcels nobody measured"
    // are the same number and completely different facts.
    expect(total.unknown).toBe(2);
  });
});

describe("formatAreaTotal", () => {
  it("says so when nothing is recorded, instead of claiming zero acres", () => {
    expect(formatAreaTotal(totalArea([null, null]))).toBe("not recorded");
  });

  it("flags a partial total", () => {
    expect(formatAreaTotal(totalArea([10, null]))).toBe(
      "10 acres (1 not recorded)",
    );
  });

  it("keeps a complete total clean", () => {
    expect(formatAreaTotal(totalArea([10, 32.5]))).toBe("42.5 acres");
  });

  it("is zero acres, not 'not recorded', when there is nothing at all", () => {
    expect(formatAreaTotal(totalArea([]))).toBe("0 acres");
  });
});

describe("zoneCoverage", () => {
  it("reports the ground not yet divided up", () => {
    const result = zoneCoverage(100, [40, 30]);
    expect(result.assigned.acres).toBe(70);
    expect(result.unassignedAcres).toBe(30);
    expect(result.overAssigned).toBe(false);
  });

  it("reports over-assignment rather than refusing it", () => {
    // Zones do not have to tile a parcel and a survey can disagree with a
    // deed. Reporting the difference is right; a constraint here would make
    // the honest state unrepresentable.
    const result = zoneCoverage(50, [40, 30]);
    expect(result.unassignedAcres).toBe(-20);
    expect(result.overAssigned).toBe(true);
  });

  it("declines to compute a remainder it cannot know", () => {
    expect(zoneCoverage(null, [40]).unassignedAcres).toBeNull();
    // One unmeasured zone makes the remainder a guess, not a subtraction.
    expect(zoneCoverage(100, [40, null]).unassignedAcres).toBeNull();
  });

  it("counts the whole parcel as undivided when it has no zones", () => {
    expect(zoneCoverage(100, []).unassignedAcres).toBe(100);
  });
});

describe("zone use vocabulary", () => {
  it("mirrors the land_zone_uses_use_format CHECK", () => {
    // Kept in sync by hand with drizzle/0132_land_places.sql. If the CHECK
    // changes and this does not, an invalid use reaches Postgres and the user
    // sees a constraint violation instead of a sentence.
    expect(ZONE_USE_FORMAT.source).toBe("^[a-z][a-z0-9_]{0,62}$");
  });

  it.each(["pasture", "hay", "building_site", "silvopasture", "a"])(
    "accepts %s",
    (use) => {
      expect(isValidZoneUse(use)).toBe(true);
    },
  );

  it.each(["Pasture", "hay ground", "2nd_field", "_hay", "hay-ground", ""])(
    "rejects %s",
    (use) => {
      expect(isValidZoneUse(use)).toBe(false);
    },
  );

  it("rejects a use longer than the column allows", () => {
    expect(isValidZoneUse("a".repeat(63))).toBe(true);
    expect(isValidZoneUse("a".repeat(64))).toBe(false);
  });

  it("every suggestion is a valid value", () => {
    for (const { use } of SUGGESTED_ZONE_USES) {
      expect(isValidZoneUse(use)).toBe(true);
    }
  });

  it("labels a slug for people", () => {
    expect(zoneUseLabel("building_site")).toBe("Building site");
    expect(zoneUseLabel("hay")).toBe("Hay");
  });

  it("lists productive uses first, and the picker must not sort them", () => {
    // The order of this array is load-bearing for the use picker, which renders
    // it as declared. Sorting it alphabetically put `building_site` at the top
    // — the least likely answer for a paddock AND a non-productive one — so a
    // hurried tap recorded good ground as earning nothing. Found by using it.
    expect(SUGGESTED_ZONE_USES[0].use).toBe("pasture");
    expect(SUGGESTED_ZONE_USES[0].productive).toBe(true);

    // No productive use may appear after a non-productive one, which is the
    // property the picker actually depends on.
    const firstNonProductive = SUGGESTED_ZONE_USES.findIndex(
      (u) => !u.productive,
    );
    const lastProductive = SUGGESTED_ZONE_USES.map((u) => u.productive).lastIndexOf(
      true,
    );
    expect(lastProductive).toBeLessThan(firstNonProductive);
  });

  it("knows which suggested uses earn nothing", () => {
    expect(defaultProductive("pasture")).toBe(true);
    expect(defaultProductive("lane")).toBe(false);
    expect(defaultProductive("yard")).toBe(false);
  });

  it("assumes an unknown use is productive", () => {
    // The taxonomy is open, so the pack meets uses it has never heard of. The
    // safer default is to count them — leaving real ground out of a per-acre
    // figure is a quieter error than including a lane.
    expect(defaultProductive("silvopasture")).toBe(true);
  });
});

describe("tenure", () => {
  it("is a closed set", () => {
    expect([...TENURES]).toEqual(["owned", "leased", "crop_share"]);
  });

  it("rejects anything outside it", () => {
    // Unlike a zone use, tenure is NOT vocabulary: each value books
    // differently, so an unrecognised one has no defined behaviour.
    expect(isTenure("owned")).toBe(true);
    expect(isTenure("handshake")).toBe(false);
    expect(isTenure("rented")).toBe(false);
  });
});
