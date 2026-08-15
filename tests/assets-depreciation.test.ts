import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  depreciableBaseCents,
  isDepreciationMethod,
  periodAmountCents,
  periodEndDate,
  periodOf,
  unpostedPeriods,
  type DepreciationInput,
} from "@/packs/assets/core/depreciation";

/**
 * Depreciation schedules. Pure — no database.
 *
 * The property most of this file is about is the one in the module header: a
 * schedule sums to the depreciable base EXACTLY. A cent lost here becomes a
 * permanent unexplainable orphan on a balance sheet, so it is tested at awkward
 * numbers rather than round ones.
 */

const base = (over: Partial<DepreciationInput> = {}): DepreciationInput => ({
  costCents: 1_200_000,
  salvageValueCents: 0,
  method: "straight_line",
  usefulLifeMonths: 60,
  inServiceOn: "2026-01-15",
  ...over,
});

describe("depreciableBaseCents", () => {
  it("is cost less salvage", () => {
    expect(
      depreciableBaseCents({ costCents: 100_000, salvageValueCents: 20_000 }),
    ).toBe(80_000);
  });

  it("never goes negative when salvage exceeds cost", () => {
    expect(
      depreciableBaseCents({ costCents: 10_000, salvageValueCents: 25_000 }),
    ).toBe(0);
  });
});

describe("buildSchedule — the exactness invariant", () => {
  it("sums to the depreciable base when it divides evenly", () => {
    const rows = buildSchedule(base());
    expect(rows).toHaveLength(60);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(1_200_000);
  });

  it("sums to the base EXACTLY when it does not divide evenly", () => {
    // 100_001 over 7 months: 14285.857… a month. The classic place a cent goes
    // missing.
    const rows = buildSchedule(
      base({ costCents: 100_001, usefulLifeMonths: 7 }),
    );
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(100_001);
  });

  it("stays exact across a spread of awkward amounts and lives", () => {
    for (const cost of [1, 7, 99, 100_003, 999_999, 3_333_333]) {
      for (const months of [1, 3, 7, 12, 60, 84, 240]) {
        const rows = buildSchedule(base({ costCents: cost, usefulLifeMonths: months }));
        const total = rows.reduce((s, r) => s + r.amountCents, 0);
        expect(total, `cost=${cost} months=${months}`).toBe(cost);
      }
    }
  });

  it("respects salvage — the base is what is written off, not the cost", () => {
    const rows = buildSchedule(
      base({ costCents: 500_000, salvageValueCents: 50_000, usefulLifeMonths: 9 }),
    );
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(450_000);
  });

  it("lands book value exactly on salvage in the final period", () => {
    const rows = buildSchedule(
      base({ costCents: 777_777, salvageValueCents: 12_345, usefulLifeMonths: 11 }),
    );
    expect(rows.at(-1)!.bookValueCents).toBe(12_345);
  });

  it("spreads the remainder across the earliest periods, never the last", () => {
    // 10 cents over 4 months: 2,2,3,3 would be wrong; 3,3,2,2 is the rule.
    const rows = buildSchedule(
      base({ costCents: 10, usefulLifeMonths: 4 }),
    );
    expect(rows.map((r) => r.amountCents)).toEqual([3, 3, 2, 2]);
    // The final period is the plain per-month figure, which is what makes a
    // printed schedule look right to whoever checks it.
    expect(rows.at(-1)!.amountCents).toBe(2);
  });

  it("keeps accumulated monotonic and never over-depreciates", () => {
    const rows = buildSchedule(
      base({ costCents: 123_457, salvageValueCents: 7, usefulLifeMonths: 13 }),
    );
    let prev = 0;
    for (const row of rows) {
      expect(row.amountCents).toBeGreaterThanOrEqual(0);
      expect(row.accumulatedCents).toBeGreaterThanOrEqual(prev);
      expect(row.bookValueCents).toBeGreaterThanOrEqual(7);
      prev = row.accumulatedCents;
    }
  });
});

describe("buildSchedule — periods", () => {
  it("starts in the in-service month, not the acquisition month", () => {
    const rows = buildSchedule(base({ inServiceOn: "2026-03-20", usefulLifeMonths: 3 }));
    expect(rows.map((r) => r.period)).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("rolls the year over correctly", () => {
    const rows = buildSchedule(base({ inServiceOn: "2026-11-01", usefulLifeMonths: 4 }));
    expect(rows.map((r) => r.period)).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("does not drift on a month-end in-service date", () => {
    // `new Date("2026-01-31")` plus a month is the classic "March 3rd" bug.
    // Periods are month buckets, so the day must never re-enter the maths.
    const rows = buildSchedule(base({ inServiceOn: "2026-01-31", usefulLifeMonths: 3 }));
    expect(rows.map((r) => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});

describe("buildSchedule — the empty cases", () => {
  it("is empty for method none, because land does not depreciate", () => {
    expect(buildSchedule(base({ method: "none" }))).toEqual([]);
  });

  it("is empty when there is nothing to write off", () => {
    expect(
      buildSchedule(base({ costCents: 100_000, salvageValueCents: 100_000 })),
    ).toEqual([]);
  });

  it("is empty for a non-positive life rather than dividing by zero", () => {
    expect(buildSchedule(base({ usefulLifeMonths: 0 }))).toEqual([]);
    expect(buildSchedule(base({ usefulLifeMonths: -12 }))).toEqual([]);
  });
});

describe("periodAmountCents", () => {
  it("finds the amount for a period inside the life", () => {
    expect(periodAmountCents(base({ usefulLifeMonths: 12, costCents: 1_200 }), "2026-01")).toBe(100);
  });

  it("is zero before and after the life, not an error", () => {
    const input = base({ usefulLifeMonths: 12 });
    expect(periodAmountCents(input, "2025-12")).toBe(0);
    expect(periodAmountCents(input, "2030-01")).toBe(0);
  });
});

describe("unpostedPeriods", () => {
  const input = base({ inServiceOn: "2026-03-01", usefulLifeMonths: 12, costCents: 1_200 });

  it("returns every period up to and including `through`", () => {
    const rows = unpostedPeriods(input, "2026-05", []);
    expect(rows.map((r) => r.period)).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("catches up several months at once — the normal case, not an edge one", () => {
    // Nobody opens the app on the last day of every month.
    expect(unpostedPeriods(input, "2026-08", []).map((r) => r.period)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("skips what is already posted, including a gap in the middle", () => {
    const rows = unpostedPeriods(input, "2026-06", ["2026-03", "2026-05"]);
    expect(rows.map((r) => r.period)).toEqual(["2026-04", "2026-06"]);
  });

  it("is empty once everything through the date is posted", () => {
    expect(unpostedPeriods(input, "2026-04", ["2026-03", "2026-04"])).toEqual([]);
  });

  it("never runs past the end of the life", () => {
    expect(unpostedPeriods(input, "2099-12", []).length).toBe(12);
  });
});

describe("periodOf / periodEndDate", () => {
  it("takes the period from a date", () => {
    expect(periodOf("2026-08-14")).toBe("2026-08");
  });

  it("dates a period to its last day, so a monthly P&L is honest", () => {
    expect(periodEndDate("2026-01")).toBe("2026-01-31");
    expect(periodEndDate("2026-04")).toBe("2026-04-30");
  });

  it("handles February in a leap year and a common year", () => {
    expect(periodEndDate("2024-02")).toBe("2024-02-29");
    expect(periodEndDate("2026-02")).toBe("2026-02-28");
  });

  it("handles December without rolling the year", () => {
    expect(periodEndDate("2026-12")).toBe("2026-12-31");
  });
});

describe("isDepreciationMethod", () => {
  it("accepts what the CHECK constraint accepts", () => {
    expect(isDepreciationMethod("none")).toBe(true);
    expect(isDepreciationMethod("straight_line")).toBe(true);
  });

  it("rejects a method the database would refuse", () => {
    // Kept in step with assets_depreciation_method_valid by hand; if a method
    // is added, both move together.
    expect(isDepreciationMethod("declining_balance")).toBe(false);
    expect(isDepreciationMethod("macrs")).toBe(false);
  });
});
