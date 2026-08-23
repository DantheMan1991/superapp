import { describe, expect, it } from "vitest";
import {
  YIELD_REFUSALS,
  formatLb,
  formatRatio,
  runYield,
} from "../src/packs/production/core/yield";
import {
  LIVE_SOURCE_NOTES,
  STAGE_REFUSALS,
  cuttingYield,
  dressingPercentage,
  formatCondemned,
  reasonLabel,
  tallyCarcasses,
  type CarcassLine,
  type SheetInput,
} from "../src/packs/production/core/carcass";
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
  INSPECTIONS,
  INSPECTION_LABELS,
  INSPECTION_NOTES,
  LABELLING_OPTIONS,
  RATING_LABELS,
  centsToDisplay,
  processorHandlesFrom,
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
    expect(lotCarried(own, consumed, [])).toEqual({
      purchasedCents: 40_000,
      consumedCents: 100_000,
      releasedCents: 70_000,
      adjustedOnHandCents: 0,
      adjustedIssuedCents: 0,
      remainingCents: 70_000,
    });
  });

  it("is the plain accumulated cost before anything leaves", () => {
    const own = [{ quantity: 200, costCents: 40_000, movementKind: "placement" }];
    const consumed = [{ quantity: -500, costCents: 60_000, movementKind: "issue" }];
    expect(lotCarried(own, consumed, []).remainingCents).toBe(100_000);
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

/**
 * ── THE PROCESSOR DIRECTORY (slice 1b) ────────────────────────────────────
 *
 * Small surface, and every test here guards a decision rather than a mechanism.
 */
describe("processor vocabulary", () => {
  it("keeps the inspection set closed, and keeps `unknown` in it", () => {
    // Five values, and the fifth is the one that matters. "Not inspected" and
    // "nobody has said yet" are different states; a boolean would collapse the
    // second into the first on the very screen a legal question is answered
    // from. Mirrors the CHECK on production_processors.inspection.
    expect([...INSPECTIONS]).toEqual([
      "usda",
      "state",
      "custom_exempt",
      "uninspected",
      "unknown",
    ]);
    expect([...LABELLING_OPTIONS]).toEqual(["unknown", "no", "yes"]);
  });

  it("has a sentence for every inspection status", () => {
    // A status with no note would render as a bare word on the screen that
    // decides where meat may be sold. Every one of them has to explain itself.
    for (const value of INSPECTIONS) {
      expect(INSPECTION_LABELS[value]).toBeTruthy();
      expect(INSPECTION_NOTES[value]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("reads what processors handle from the profile, never inventing one", () => {
    // Same rule as runKinds, and deliberately a SEPARATE list: what a plant
    // will take is not what this farm raises.
    expect(
      processorHandlesFrom({ processorHandles: ["cattle", "sheep"] }),
    ).toEqual(["cattle", "sheep"]);
    expect(processorHandlesFrom(undefined)).toEqual([]);
    expect(processorHandlesFrom({ processorHandles: "cattle" })).toEqual([]);
    // Reading the wrong key is the mistake a copy-paste would make.
    expect(processorHandlesFrom({ runKinds: ["butchering"] })).toEqual([]);
  });

  it("never renders an unquoted fee as $0.00", () => {
    // THE ONE THAT WOULD MISLEAD A PERSON. A fee nobody has asked about is a
    // question; zero says the plant works for nothing, and a farm comparing two
    // quotes would pick the one that had not answered.
    expect(centsToDisplay(null)).toBeNull();
    expect(centsToDisplay(undefined)).toBeNull();
    expect(centsToDisplay(0)).toBe("$0.00");
    expect(centsToDisplay(9500)).toBe("$95.00");
    expect(centsToDisplay(90)).toBe("$0.90");
  });

  it("anchors every rating with a word", () => {
    // "4" means nothing on its own, and a farm comparing two plants a year
    // apart needs the same anchor both times.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(RATING_LABELS[n]).toBeTruthy();
    }
  });
});

/**
 * ── THE CARCASS STAGE (slice 1a) ──────────────────────────────────────────
 *
 * **THE CONDEMNATION TESTS ARE THE POINT OF THIS BLOCK.** Slice 0 refused to
 * model a condemnation at all, and the reason was arithmetic rather than
 * squeamishness: a condemned-head COUNT leaves the animal's live weight in the
 * denominator, and taking it out with an average is the unauditable fudge this
 * pack refuses everywhere else. So there is exactly one honest adjustment — sum
 * only the animals that PASSED, on both sides — and it is available only when
 * the plant weighed them. Both halves of that are certified below, including the
 * half where the app declines to adjust and says so.
 */
const line = (key: string, opts: Partial<CarcassLine> = {}): CarcassLine => ({
  key,
  inputKey: "pen",
  headCount: 1,
  liveLb: null,
  hangingLb: null,
  condemned: false,
  reason: "",
  ...opts,
});

const pen = (opts: Partial<SheetInput> = {}): SheetInput => ({
  key: "pen",
  headIn: null,
  liveLb: null,
  ...opts,
});

describe("tallyCarcasses", () => {
  it("counts the pilot's shape — a pen of 100 with three condemned", () => {
    const lines = [
      line("passed", { headCount: 97, hangingLb: 407.4, liveLb: 582 }),
      line("bad", {
        headCount: 3,
        condemned: true,
        liveLb: 18,
        reason: "airsacculitis",
      }),
    ];
    const tally = tallyCarcasses(lines, [pen({ headIn: 100, liveLb: 600 })]);

    expect(tally.headOnSheet).toBe(100);
    expect(tally.headPassed).toBe(97);
    expect(tally.headCondemned).toBe(3);
    expect(tally.headIn).toBe(100);
    expect(tally.headUnaccounted).toBe(0);
    expect(tally.condemnRate).toBeCloseTo(0.03, 6);
    expect(formatCondemned(tally)).toBe("3 of 100 head condemned (3.0%)");
  });

  it("groups causes largest first, with an unstated one always last", () => {
    // The grouping IS the feature. Three birds condemned is a number; the same
    // cause twice is the thing to act on.
    const tally = tallyCarcasses(
      [
        line("a", { headCount: 2, condemned: true, reason: "bruising" }),
        line("b", { headCount: 5, condemned: true, reason: "airsacculitis" }),
        line("c", { headCount: 5, condemned: true, reason: "" }),
        line("d", { headCount: 1, condemned: true, reason: "bruising" }),
      ],
      [],
    );

    expect(tally.byReason).toEqual([
      { reason: "airsacculitis", head: 5 },
      { reason: "", head: 5 },
      { reason: "bruising", head: 3 },
    ]);
    // The causes always add up to the count beside them — an unrecorded cause
    // is grouped, never dropped.
    expect(
      tally.byReason.reduce((sum, group) => sum + group.head, 0),
    ).toBe(tally.headCondemned);
    expect(tally.headCondemnedUnstated).toBe(5);
    expect(reasonLabel("")).toBe("No cause given on the sheet");
    expect(reasonLabel("bruising")).toBe("bruising");
  });

  it("reports a sheet that is short, and one that is over", () => {
    const short = tallyCarcasses(
      [line("a", { headCount: 60 })],
      [pen({ headIn: 100 })],
    );
    expect(short.headUnaccounted).toBe(40);

    const over = tallyCarcasses(
      [line("a", { headCount: 120 })],
      [pen({ headIn: 100 })],
    );
    expect(over.headUnaccounted).toBe(-20);
  });

  it("claims no reconciliation when no input is counted", () => {
    // A hundred pounds of flour has no head to account for. Null is not zero:
    // zero would mean a counted input that put nothing in.
    const tally = tallyCarcasses([line("a")], [pen({ headIn: null })]);
    expect(tally.headIn).toBeNull();
    expect(tally.headUnaccounted).toBeNull();
  });

  it("says none rather than a rate when nothing was condemned", () => {
    const tally = tallyCarcasses([line("a", { headCount: 4 })], []);
    expect(tally.condemnRate).toBe(0);
    expect(formatCondemned(tally)).toBe("None condemned");
  });
});

describe("dressingPercentage", () => {
  it("takes the condemned animals out of BOTH sides when the plant weighed them", () => {
    /**
     * **THE SLICE, IN ONE ASSERTION.** 97 birds hung at 407.4 lb against the
     * 582 lb those same 97 weighed live. The three condemned birds are in
     * neither number, which is the only honest way to leave them out, and it
     * needs nothing averaged anywhere.
     */
    const lines = [
      line("passed", { headCount: 97, liveLb: 582, hangingLb: 407.4 }),
      line("bad", { headCount: 3, condemned: true, liveLb: 18 }),
    ];
    const inputs = [pen({ headIn: 100, liveLb: 600 })];
    const result = dressingPercentage(lines, inputs, tallyCarcasses(lines, inputs));

    expect(result.dressing?.liveSource).toBe("plant");
    expect(result.dressing?.includesCondemned).toBe(false);
    expect(result.dressing?.fromLb).toBe(582);
    expect(result.dressing?.toLb).toBe(407.4);
    expect(formatRatio(result.dressing!.ratio)).toBe("70.0%");
  });

  it("falls back to the farm's scale, keeps the condemned in, and SAYS SO", () => {
    /**
     * The same kill with no per-carcass live weights. The denominator is now
     * everything that left the yard, condemned birds included, so the ratio is
     * genuinely lower — 67.9% against 70.0%. `includesCondemned` is what stops a
     * real condemnation being read as a bad kill for the rest of time.
     */
    const lines = [
      line("passed", { headCount: 97, hangingLb: 407.4 }),
      line("bad", { headCount: 3, condemned: true }),
    ];
    const inputs = [pen({ headIn: 100, liveLb: 600 })];
    const result = dressingPercentage(lines, inputs, tallyCarcasses(lines, inputs));

    expect(result.dressing?.liveSource).toBe("farm");
    expect(result.dressing?.includesCondemned).toBe(true);
    expect(result.dressing?.fromLb).toBe(600);
    expect(formatRatio(result.dressing!.ratio)).toBe("67.9%");
  });

  it("does not flag the farm's scale when nothing was condemned", () => {
    // The caveat is about condemned animals sitting in the denominator, not
    // about which scale was used. A clean kill on a farm weight is just a
    // slightly low reading, and shrink is explained by the source note.
    const lines = [line("passed", { headCount: 100, hangingLb: 420 })];
    const inputs = [pen({ headIn: 100, liveLb: 600 })];
    const result = dressingPercentage(lines, inputs, tallyCarcasses(lines, inputs));

    expect(result.dressing?.liveSource).toBe("farm");
    expect(result.dressing?.includesCondemned).toBe(false);
  });

  it("never sums the two scales", () => {
    // Both are measurements of the same animals hours apart. Adding them would
    // double the denominator; averaging them would invent a third weight that
    // nobody recorded. One is chosen, and the screen says which.
    const lines = [line("passed", { headCount: 1, liveLb: 1120, hangingLb: 690 })];
    const inputs = [pen({ headIn: 1, liveLb: 1150 })];
    const result = dressingPercentage(lines, inputs, tallyCarcasses(lines, inputs));

    expect(result.dressing?.fromLb).toBe(1120);
    expect(result.dressing?.fromLb).not.toBe(1150 + 1120);
  });

  it("REFUSES a sheet that does not account for what went in", () => {
    // 60 birds' carcasses under 100 birds' worth of live weight reads as a
    // catastrophic kill, and it looks precise.
    const lines = [line("passed", { headCount: 60, hangingLb: 252 })];
    const inputs = [pen({ headIn: 100, liveLb: 600 })];
    expect(
      dressingPercentage(lines, inputs, tallyCarcasses(lines, inputs))
        .refusedBecause,
    ).toBe("SHEET_INCOMPLETE");

    const over = [line("passed", { headCount: 120, hangingLb: 500 })];
    expect(
      dressingPercentage(over, inputs, tallyCarcasses(over, inputs))
        .refusedBecause,
    ).toBe("SHEET_OVER_ACCOUNTED");
  });

  it("REFUSES when every carcass was condemned", () => {
    const lines = [line("bad", { headCount: 100, condemned: true })];
    const inputs = [pen({ headIn: 100, liveLb: 600 })];
    expect(
      dressingPercentage(lines, inputs, tallyCarcasses(lines, inputs))
        .refusedBecause,
    ).toBe("ALL_CONDEMNED");
  });

  it("REFUSES on a partial set of hanging weights", () => {
    const lines = [
      line("a", { headCount: 50, hangingLb: 210 }),
      line("b", { headCount: 50 }),
    ];
    const inputs = [pen({ headIn: 100, liveLb: 600 })];
    expect(
      dressingPercentage(lines, inputs, tallyCarcasses(lines, inputs))
        .refusedBecause,
    ).toBe("PARTIAL_HANGING_WEIGHTS");
  });

  it("REFUSES with no sheet, no hanging weights, and no live weight anywhere", () => {
    expect(dressingPercentage([], [], tallyCarcasses([], [])).refusedBecause).toBe(
      "NO_SHEET",
    );

    const unweighed = [line("a", { headCount: 100 })];
    const inputs = [pen({ headIn: 100, liveLb: 600 })];
    expect(
      dressingPercentage(unweighed, inputs, tallyCarcasses(unweighed, inputs))
        .refusedBecause,
    ).toBe("NO_HANGING_WEIGHTS");

    const noLive = [line("a", { headCount: 100, hangingLb: 420 })];
    const dry = [pen({ headIn: 100, liveLb: null })];
    expect(
      dressingPercentage(noLive, dry, tallyCarcasses(noLive, dry)).refusedBecause,
    ).toBe("NO_LIVE_WEIGHTS");
  });

  it("only takes live weight from the inputs the sheet actually covers", () => {
    // Two pens, one sheet each. The second pen's trailer weight has no business
    // in the first pen's dressing percentage.
    const lines = [
      line("a", { inputKey: "pen-1", headCount: 50, hangingLb: 210 }),
      line("b", { inputKey: "pen-2", headCount: 50, hangingLb: 220 }),
    ];
    const inputs = [
      { key: "pen-1", headIn: 50, liveLb: 300 },
      { key: "pen-2", headIn: 50, liveLb: 310 },
    ];
    const result = dressingPercentage(lines, inputs, tallyCarcasses(lines, inputs));
    expect(result.dressing?.fromLb).toBe(610);
  });
});

describe("cuttingYield", () => {
  it("measures the cutting room with the animal's conformation out of it", () => {
    const lines = [line("a", { headCount: 1, liveLb: 1120, hangingLb: 690 })];
    const inputs = [pen({ headIn: 1, liveLb: 1150 })];
    const result = cuttingYield(
      lines,
      [lb("boxes", 480)],
      tallyCarcasses(lines, inputs),
    );

    expect(result.cutting?.fromLb).toBe(690);
    expect(result.cutting?.toLb).toBe(480);
    expect(formatRatio(result.cutting!.ratio)).toBe("69.6%");
  });

  it("needs no condemnation adjustment, because a condemned carcass never hangs", () => {
    /**
     * The quiet one, and it is worth an assertion of its own: the condemned
     * line is out of the denominator BY CONSTRUCTION rather than by correction.
     * It carries no hanging weight — the CHECK forbids one — so there is nothing
     * to subtract and nothing to average.
     */
    const lines = [
      line("passed", { headCount: 97, hangingLb: 407.4 }),
      line("bad", { headCount: 3, condemned: true, reason: "bruising" }),
    ];
    const inputs = [pen({ headIn: 100, liveLb: 600 })];
    const result = cuttingYield(
      lines,
      [lb("boxes", 300)],
      tallyCarcasses(lines, inputs),
    );
    expect(result.cutting?.fromLb).toBe(407.4);
  });

  it("REFUSES an incomplete sheet, which is where it would read OVER 100%", () => {
    // All the boxes are there and only some of the carcasses are. Left alone,
    // this is the loudest possible way to be wrong.
    const lines = [line("a", { headCount: 60, hangingLb: 252 })];
    const inputs = [pen({ headIn: 100 })];
    expect(
      cuttingYield(lines, [lb("boxes", 400)], tallyCarcasses(lines, inputs))
        .refusedBecause,
    ).toBe("SHEET_INCOMPLETE");
  });

  it("REFUSES with nothing out, nothing weighed, and only some weighed", () => {
    const lines = [line("a", { headCount: 1, hangingLb: 690 })];
    const tally = tallyCarcasses(lines, [pen({ headIn: 1 })]);

    expect(cuttingYield(lines, [], tally).refusedBecause).toBe("NO_OUTPUTS");
    expect(cuttingYield(lines, [lb("x", null)], tally).refusedBecause).toBe(
      "NO_OUTPUT_WEIGHTS",
    );
    expect(
      cuttingYield(lines, [lb("x", 400), lb("y", null)], tally).refusedBecause,
    ).toBe("PARTIAL_OUTPUT_WEIGHTS");
  });

  it("has a sentence for every refusal it can give", () => {
    // The rule this pack inherited: the reason a screen gives is more useful
    // than a number it had to invent — so every refusal has to have one.
    for (const key of Object.keys(STAGE_REFUSALS)) {
      expect(STAGE_REFUSALS[key as keyof typeof STAGE_REFUSALS].length).toBeGreaterThan(
        20,
      );
    }
    expect(Object.keys(LIVE_SOURCE_NOTES).sort()).toEqual(["farm", "plant"]);
  });
});
