import { describe, expect, it } from "vitest";
import {
  YIELD_REFUSALS,
  formatLb,
  formatRatio,
  runYield,
} from "../src/packs/production/core/yield";
import {
  lotShareCents,
  rollBasis,
  rollCents,
  rollRun,
} from "../src/packs/production/core/roll";
import {
  COST_BASES,
  RUN_STATUSES,
  SLUG_FORMAT,
  isValidSlug,
  runKindsFrom,
  slugLabel,
} from "../src/packs/production/vocabulary";
import { lotCarried } from "../src/packs/inventory/core/costing";
import { headEffect, summariseHead } from "../src/packs/livestock/core/herd";

/**
 * The pure half of `production`. No database anywhere in this file.
 *
 * **THE YIELD REFUSALS ARE THE MOST IMPORTANT THING HERE.** Every one of them
 * exists because the alternative is not "approximately right" but "confidently
 * wrong in a specific direction", and a test that only checked the happy path
 * would let any of them be relaxed into an average without anybody noticing.
 */

const lb = (key: string, value: number | null) => ({ key, lb: value });

describe("runYield", () => {
  it("measures the steer the design keeps quoting", () => {
    const result = runYield([lb("in", 1150)], [lb("out", 690)]);
    expect(result.yield?.inLb).toBe(1150);
    expect(result.yield?.outLb).toBe(690);
    expect(formatRatio(result.yield!.ratio)).toBe("60.0%");
  });

  it("adds up several boxes against several animals", () => {
    const result = runYield(
      [lb("a", 1150), lb("b", 1050)],
      [lb("x", 690), lb("y", 600), lb("z", 30)],
    );
    expect(result.yield?.inLb).toBe(2200);
    expect(result.yield?.outLb).toBe(1320);
    expect(formatRatio(result.yield!.ratio)).toBe("60.0%");
  });

  it("REFUSES when only some of the outputs were weighed", () => {
    // The sharp one. Three of five boxes weighed, divided by the whole animal,
    // reads as a catastrophic kill — and the number would look precise.
    const result = runYield(
      [lb("in", 1150)],
      [lb("x", 400), lb("y", 200), lb("z", null)],
    );
    expect(result.yield).toBeUndefined();
    expect(result.refusedBecause).toBe("PARTIAL_OUTPUT_WEIGHTS");
    expect(YIELD_REFUSALS.PARTIAL_OUTPUT_WEIGHTS).toContain("disastrous");
  });

  it("REFUSES when only some of the inputs were weighed", () => {
    // The mirror image, and it errs the other way: a ratio over half the
    // animals reads as a far better yield than the run had.
    const result = runYield([lb("a", 1150), lb("b", null)], [lb("x", 690)]);
    expect(result.refusedBecause).toBe("PARTIAL_INPUT_WEIGHTS");
  });

  it("REFUSES when head went in and nobody put them on a scale", () => {
    expect(runYield([lb("in", null)], [lb("out", 690)]).refusedBecause).toBe(
      "NO_INPUT_WEIGHTS",
    );
    expect(runYield([lb("in", 1150)], [lb("out", null)]).refusedBecause).toBe(
      "NO_OUTPUT_WEIGHTS",
    );
  });

  it("says nothing has happened rather than dividing by nothing", () => {
    expect(runYield([], []).refusedBecause).toBe("NO_INPUTS");
    expect(runYield([lb("in", 1150)], []).refusedBecause).toBe("NO_OUTPUTS");
  });

  it("has a sentence for every refusal it can produce", () => {
    // A refusal with no copy is a blank space where a reason should be, which
    // is worse than the number it replaced.
    for (const reason of Object.keys(YIELD_REFUSALS)) {
      expect(YIELD_REFUSALS[reason as keyof typeof YIELD_REFUSALS].length)
        .toBeGreaterThan(20);
    }
  });

  it("formats what it has and an em dash for what it does not", () => {
    expect(formatLb(690)).toBe("690.0 lb");
    expect(formatLb(null)).toBe("—");
    expect(formatRatio(null)).toBe("—");
  });
});

describe("lotShareCents", () => {
  it("carries the whole pen when the whole pen goes", () => {
    expect(lotShareCents(100_000, 200, 200)).toBe(100_000);
  });

  it("carries half the pen when half of it goes", () => {
    expect(lotShareCents(100_000, 100, 200)).toBe(50_000);
  });

  it("DOES NOT CHARGE ONE AND A HALF PENS ACROSS TWO KILL DAYS", () => {
    /**
     * The bug this function exists to prevent, and it is an ordinary farm
     * fortnight. Take half a $1,000 pen on Saturday, the rest a fortnight
     * later. The accumulated cost never goes down, so pro-rating the GROSS
     * figure both times charges $500 then $1,000.
     *
     * Netting what has already been released off first is what makes the two
     * halves sum to the pen.
     */
    const first = lotShareCents(100_000, 100, 200);
    expect(first).toBe(50_000);
    const remainingAfter = 100_000 - first!;
    const second = lotShareCents(remainingAfter, 100, 100);
    expect(second).toBe(50_000);
    expect(first! + second!).toBe(100_000);
  });

  it("never carries more than there is, even when the ledger has gone negative", () => {
    // Inventory allows negative stock on purpose. A share of MORE than is
    // standing is still the whole remainder, not a multiple of it.
    expect(lotShareCents(100_000, 300, 200)).toBe(100_000);
  });

  it("refuses rather than returning a confident zero with nothing standing", () => {
    expect(lotShareCents(100_000, 10, 0)).toBeNull();
  });
});

describe("rollBasis", () => {
  const share = (
    key: string,
    weight: number | null,
    quantity: number,
    unit: string,
  ) => ({ key, lb: weight, quantity, unit });

  it("uses weight when everything was weighed", () => {
    expect(
      rollBasis([share("a", 400, 400, "lb"), share("b", 12, 12, "each")]),
    ).toBe("weight");
  });

  it("falls back to count when nothing was weighed but everything is counted the same way", () => {
    // Sixty loaves out of one bake are each a sixtieth of the flour. That is how
    // a bakery has always costed, and it is the right answer for a run where
    // nobody owns a scale.
    expect(
      rollBasis([share("a", null, 40, "each"), share("b", null, 20, "each")]),
    ).toBe("quantity");
  });

  it("REFUSES across two units with no weights", () => {
    // A dozen eggs and a pound of butter have no ratio between them —
    // inventory's own rule about adding quantities across units.
    expect(
      rollBasis([share("a", null, 12, "each"), share("b", null, 3, "lb")]),
    ).toBe("none");
  });

  it("refuses an empty run rather than splitting nothing", () => {
    expect(rollBasis([])).toBe("none");
  });
});

describe("rollCents", () => {
  it("splits a pot so the pieces sum to it EXACTLY", () => {
    // The odd cent has to land somewhere, or the freezer holds a different
    // amount of money than the run took out of stock.
    const split = rollCents(100, [
      { key: "a", basis: 1 },
      { key: "b", basis: 1 },
      { key: "c", basis: 1 },
    ]);
    expect([...split.values()].reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("is deterministic on ties, so two runs of the same arithmetic agree", () => {
    const shares = [
      { key: "a", basis: 1 },
      { key: "b", basis: 1 },
      { key: "c", basis: 1 },
    ];
    expect([...rollCents(100, shares)]).toEqual([...rollCents(100, shares)]);
  });

  it("weights by the basis given", () => {
    const split = rollCents(1000, [
      { key: "big", basis: 750 },
      { key: "small", basis: 250 },
    ]);
    expect(split.get("big")).toBe(750);
    expect(split.get("small")).toBe(250);
  });

  it("splits nothing across a basis of nothing", () => {
    expect(rollCents(1000, [{ key: "a", basis: 0 }]).size).toBe(0);
    expect(rollCents(0, [{ key: "a", basis: 5 }]).size).toBe(0);
  });
});

describe("rollRun", () => {
  it("puts more of the pot on the heavier box", () => {
    const roll = rollRun(50_000, [
      { key: "cuts", lb: 400, quantity: 400, unit: "lb" },
      { key: "trim", lb: 100, quantity: 100, unit: "lb" },
    ]);
    expect(roll.basis).toBe("weight");
    expect(roll.byOutput.get("cuts")).toBe(40_000);
    expect(roll.byOutput.get("trim")).toBe(10_000);
  });

  it("lands the outputs with NO cost rather than an invented one", () => {
    // `none` is an answer, not a failure. The screen says why.
    const roll = rollRun(50_000, [
      { key: "a", lb: null, quantity: 12, unit: "each" },
      { key: "b", lb: null, quantity: 3, unit: "lb" },
    ]);
    expect(roll.basis).toBe("none");
    expect(roll.byOutput.size).toBe(0);
  });

  it("still reports the basis when there was no money to split", () => {
    // Raised stock with no purchase basis genuinely cost nothing anybody
    // recorded, and the screen still has to explain how it WOULD have split.
    const roll = rollRun(0, [{ key: "a", lb: 10, quantity: 10, unit: "lb" }]);
    expect(roll.basis).toBe("weight");
    expect(roll.byOutput.size).toBe(0);
  });
});

describe("lotCarried", () => {
  it("nets what has left off what was spent", () => {
    const own = [
      { quantity: 200, costCents: 40_000, movementKind: "placement" },
      { quantity: -100, costCents: 70_000, movementKind: "processed" },
    ];
    const consumed = [{ quantity: -500, costCents: 100_000, movementKind: "issue" }];
    expect(lotCarried(own, consumed)).toEqual({
      purchasedCents: 40_000,
      consumedCents: 100_000,
      releasedCents: 70_000,
      remainingCents: 70_000,
    });
  });

  it("is the plain accumulated cost before anything leaves", () => {
    const own = [{ quantity: 200, costCents: 40_000, movementKind: "placement" }];
    const consumed = [{ quantity: -500, costCents: 60_000, movementKind: "issue" }];
    expect(lotCarried(own, consumed).remainingCents).toBe(100_000);
  });
});

describe("processed head", () => {
  it("is a REMOVAL, not a death and not a transfer", () => {
    /**
     * Getting this wrong moves the one number the broiler enterprise lives on.
     * Unrecognised kinds fall through to `transfer`, and a transfer IN inflates
     * mortality's denominator; classing it as a death would make a successful
     * batch read as a catastrophic one.
     */
    expect(headEffect("processed")).toBe("removal");
    const summary = summariseHead([
      { movementKind: "placement", quantity: 210 },
      { movementKind: "death", quantity: -10 },
      { movementKind: "processed", quantity: -200 },
    ]);
    expect(summary.intake).toBe(210);
    expect(summary.died).toBe(10);
    expect(summary.removed).toBe(200);
    expect(summary.transferred).toBe(0);
    expect(summary.balance).toBe(0);
  });
});

describe("vocabulary", () => {
  it("mirrors the CHECK constraints on run_kind", () => {
    expect(SLUG_FORMAT.source).toBe("^[a-z][a-z0-9_]{0,62}$");
    expect(isValidSlug("butchering")).toBe(true);
    expect(isValidSlug("bake_day")).toBe(true);
    expect(isValidSlug("Bake Day")).toBe(false);
    expect(isValidSlug("2nd_bake")).toBe(false);
  });

  it("keeps the two closed sets closed", () => {
    expect([...RUN_STATUSES]).toEqual(["in_progress", "complete"]);
    expect([...COST_BASES]).toEqual(["weight", "quantity", "none"]);
  });

  it("reads run kinds from the profile and never invents one", () => {
    // A pack that knew what "butchering" was would know what industry it was
    // in. Anything unreadable is an empty list and a free-text field.
    expect(runKindsFrom({ runKinds: ["butchering", "baking"] })).toEqual([
      "butchering",
      "baking",
    ]);
    expect(runKindsFrom(undefined)).toEqual([]);
    expect(runKindsFrom({ runKinds: "butchering" })).toEqual([]);
    expect(runKindsFrom({})).toEqual([]);
  });

  it("turns a slug into words", () => {
    expect(slugLabel("bake_day")).toBe("Bake day");
  });
});
