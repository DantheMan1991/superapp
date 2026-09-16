import { describe, expect, it } from "vitest";
import {
  COST_PPM,
  type CostRowLike,
  barWidthPercent,
  costFilterCounts,
  costTotals,
  matchesCostFilter,
  ofBudgetLabel,
  ofBudgetPpm,
} from "@/packs/jobs/cost-math";

/**
 * The Job cost tab's arithmetic.
 *
 * The rules worth pinning are the ones about a code with NO budget: it is not
 * 0% full, it cannot be over budget, and it must not be added into a total that
 * compares budget against spend.
 */

function row(over: Partial<CostRowLike> = {}): CostRowLike {
  const budgetCents = over.budgetCents ?? 100_00;
  const committedCents = over.committedCents ?? 60_00;
  const actualCents = over.actualCents ?? 40_00;
  const projectedCents = over.projectedCents ?? Math.max(committedCents, actualCents);
  return {
    budgetCents,
    committedCents,
    actualCents,
    projectedCents,
    varianceCents: over.varianceCents ?? budgetCents - projectedCents,
    changesCents: over.changesCents ?? 0,
    hasBudget: over.hasBudget ?? true,
    ...over,
  };
}

describe("ofBudgetPpm", () => {
  it("measures the greater of ordered and spent, not spend alone", () => {
    // $60 ordered against a $100 budget is 60% spoken for, even though only
    // $40 has actually been billed — the same figure `Left` subtracts.
    expect(ofBudgetPpm(row())).toBe(600_000);
  });

  it("is null for a code with no budget, never zero", () => {
    // Zero would read as "nothing has happened here"; the truth is "there is
    // nothing to measure against", and the cell says `no budget`.
    expect(ofBudgetPpm(row({ hasBudget: false, budgetCents: 0 }))).toBeNull();
    expect(ofBudgetPpm(row({ hasBudget: true, budgetCents: 0 }))).toBeNull();
  });

  it("is zero when a budgeted code has nothing against it", () => {
    expect(ofBudgetPpm(row({ committedCents: 0, actualCents: 0, projectedCents: 0 }))).toBe(0);
  });

  it("does NOT cap — a code 140% through its budget says 140%", () => {
    const r = row({ committedCents: 140_00, actualCents: 0, projectedCents: 140_00 });
    expect(ofBudgetPpm(r)).toBe(1_400_000);
    expect(ofBudgetLabel(ofBudgetPpm(r))).toBe("140");
  });
});

describe("barWidthPercent", () => {
  it("clamps where the figure does not, because a track cannot be 140% long", () => {
    expect(barWidthPercent(null)).toBe(0);
    expect(barWidthPercent(0)).toBe(0);
    expect(barWidthPercent(COST_PPM / 2)).toBe(50);
    expect(barWidthPercent(COST_PPM)).toBe(100);
    expect(barWidthPercent(COST_PPM * 1.4)).toBe(100);
  });
});

describe("ofBudgetLabel", () => {
  it("gives one decimal, and no trailing zero", () => {
    expect(ofBudgetLabel(null)).toBe("—");
    expect(ofBudgetLabel(500_000)).toBe("50");
    expect(ofBudgetLabel(333_333)).toBe("33.3");
  });
});

describe("matchesCostFilter", () => {
  const overBudget = row({ committedCents: 130_00, projectedCents: 130_00, varianceCents: -30_00 });
  const unbudgeted = row({ hasBudget: false, budgetCents: 0, varianceCents: 0 });
  const healthy = row();

  it("keeps everything under All", () => {
    for (const r of [overBudget, unbudgeted, healthy]) {
      expect(matchesCostFilter(r, "all")).toBe(true);
    }
  });

  it("never calls an unbudgeted code over budget, however much is on it", () => {
    // A code with no budget cannot be over one — that is the same category
    // error the totals row avoids by excluding it.
    const spentHeavily = row({
      hasBudget: false,
      budgetCents: 0,
      committedCents: 900_00,
      projectedCents: 900_00,
      varianceCents: -900_00,
    });
    expect(matchesCostFilter(spentHeavily, "over")).toBe(false);
    expect(matchesCostFilter(spentHeavily, "unbudgeted")).toBe(true);
  });

  it("counts each pill over the whole list", () => {
    const counts = costFilterCounts([overBudget, unbudgeted, healthy]);
    expect(counts).toEqual({ all: 3, over: 1, unbudgeted: 1 });
  });
});

describe("costTotals", () => {
  it("adds up budgeted codes only, and says how many it left out", () => {
    const totals = costTotals([
      row({ budgetCents: 100_00, committedCents: 60_00, actualCents: 40_00, projectedCents: 60_00, varianceCents: 40_00 }),
      row({ budgetCents: 200_00, committedCents: 250_00, actualCents: 10_00, projectedCents: 250_00, varianceCents: -50_00 }),
      // Ordered against, never budgeted: in no figure below.
      row({ hasBudget: false, budgetCents: 0, committedCents: 999_00, actualCents: 999_00, projectedCents: 999_00, varianceCents: 0 }),
    ]);
    expect(totals.budgetCents).toBe(300_00);
    expect(totals.committedCents).toBe(310_00);
    expect(totals.actualCents).toBe(50_00);
    expect(totals.varianceCents).toBe(-10_00);
    expect(totals.budgetedCount).toBe(2);
    expect(totals.unbudgetedCount).toBe(1);
  });

  it("is all zeroes when nothing is budgeted", () => {
    const totals = costTotals([row({ hasBudget: false, budgetCents: 0, varianceCents: 0 })]);
    expect(totals.budgetCents).toBe(0);
    expect(totals.budgetedCount).toBe(0);
    expect(totals.unbudgetedCount).toBe(1);
  });
});
