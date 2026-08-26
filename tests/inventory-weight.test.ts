import { describe, expect, it } from "vitest";
import {
  averagePackageWeight,
  formatWeight,
  hasRecordedWeight,
  weightOf,
} from "../src/packs/inventory/core/weight";

/**
 * What a package weighs. PURE — no database, so this lives on the `pure` side
 * of `tests/db-backed-files.ts`.
 *
 * **THE POINT OF THE FILE IS THE TWO RULES**, and everything else is
 * arithmetic: unweighed is not zero, and pounds on hand are approximate and
 * say so.
 */

const receipt = (quantity: number, weightLb: number | null) => ({
  quantity,
  weightLb,
});

describe("averagePackageWeight", () => {
  it("averages what actually arrived weighed", () => {
    // The plant's figures: 38 packages, 47.5 lb.
    expect(averagePackageWeight([receipt(38, 47.5)])).toBeCloseTo(1.25, 10);
  });

  it("weights the average by quantity, not by delivery", () => {
    // 38 at 1.25 and 2 at 5.0 is 47.5 + 10 over 40, not the mean of 1.25 and
    // 5.0. A per-delivery mean would let one small pallet drag the figure.
    expect(averagePackageWeight([receipt(38, 47.5), receipt(2, 10)])).toBeCloseTo(
      57.5 / 40,
      10,
    );
  });

  it("SKIPS a delivery nobody weighed rather than counting it as zero", () => {
    // The rule the whole file rests on. Counting the unweighed 40 would put
    // the average at 47.5/78 and quietly halve every figure downstream.
    expect(
      averagePackageWeight([receipt(38, 47.5), receipt(40, null)]),
    ).toBeCloseTo(1.25, 10);
  });

  it("ignores anything going out, the way averageCostRate does", () => {
    // An outbound movement's pounds are this rate applied to a quantity, so
    // folding one back in would be circular. The database refuses one outright
    // — this makes the function correct without depending on that.
    expect(
      averagePackageWeight([receipt(38, 47.5), receipt(-10, 12.5)]),
    ).toBeCloseTo(1.25, 10);
  });

  it("is null when nothing was ever weighed, and null is not zero", () => {
    expect(averagePackageWeight([])).toBeNull();
    expect(averagePackageWeight([receipt(38, null)])).toBeNull();
    expect(hasRecordedWeight([receipt(38, null)])).toBe(false);
    expect(hasRecordedWeight([receipt(38, 47.5)])).toBe(true);
  });

  it("does not round the rate", () => {
    // Rounding belongs at the moment a number is shown or stored, once, not at
    // every step of a fold. 1/3 lb packages must not become 0.3333.
    const rate = averagePackageWeight([receipt(3, 1)]);
    expect(rate).toBe(1 / 3);
  });
});

describe("weightOf", () => {
  it("is EXACT for an item stocked by mass, and says so", () => {
    // 840 pounds of feed is 840 pounds. The quantity IS the weight, `convert`
    // is exact, and nothing here is an estimate.
    expect(weightOf({ unit: "lb", quantity: 840, rate: null })).toEqual({
      lb: 840,
      approximate: false,
    });
    expect(weightOf({ unit: "ton", quantity: 1, rate: null })).toEqual({
      lb: 2000,
      approximate: false,
    });
  });

  it("is APPROXIMATE for anything counted, and says that too", () => {
    // 38 packages at an average of 1.25 lb. The actual 38 are each a little
    // more or less: that is what catch weight IS, and the flag is what stops a
    // screen presenting it as measured.
    expect(weightOf({ unit: "pkg", quantity: 38, rate: 1.25 })).toEqual({
      lb: 47.5,
      approximate: true,
    });
  });

  it("has no answer for something counted that nobody weighed", () => {
    expect(weightOf({ unit: "pkg", quantity: 38, rate: null })).toEqual({
      lb: null,
      approximate: false,
    });
    // A volume cannot be weighed at all without knowing what is in the bucket
    // — `core/units.ts`'s rule, and as true for milk as for feed.
    expect(weightOf({ unit: "gal", quantity: 5, rate: null }).lb).toBeNull();
    // Nor can head, until somebody weighs a delivery of them.
    expect(weightOf({ unit: "head", quantity: 70, rate: null }).lb).toBeNull();
  });

  it("rounds the product to the quantity column's scale", () => {
    // Anything finer than numeric(18,4) is a precision the database does not
    // keep, so reporting it would imply one that is not there.
    expect(weightOf({ unit: "pkg", quantity: 3, rate: 1 / 3 }).lb).toBe(1);
    expect(weightOf({ unit: "pkg", quantity: 1, rate: 1 / 3 }).lb).toBe(0.3333);
  });
});

describe("formatWeight", () => {
  it("says about when it is about", () => {
    expect(formatWeight({ lb: 47.5, approximate: true })).toBe("about 47.5 lb");
    expect(formatWeight({ lb: 840, approximate: false })).toBe("840 lb");
  });

  it("is null rather than an empty string when nobody weighed it", () => {
    // So a caller decides what unweighed looks like on its own screen, instead
    // of rendering a stray "lb" beside nothing.
    expect(formatWeight({ lb: null, approximate: false })).toBeNull();
  });

  it("does not print trailing zeroes from the rounding", () => {
    expect(formatWeight({ lb: 12.5, approximate: true })).toBe("about 12.5 lb");
    expect(formatWeight({ lb: 12, approximate: true })).toBe("about 12 lb");
  });
});
