import { describe, expect, it } from "vitest";
import {
  YIELD_REFUSALS,
  formatLb,
  formatRatio,
  runYield,
  yieldWarning,
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
  BAND_REFUSALS,
  bandCovers,
  describeBand,
  isBanded,
  resolveBands,
  shortLabel,
  snapshotLabel,
  type BandedItem,
} from "../src/packs/production/core/band";
import {
  PORTION_REFUSALS,
  portionRefusal,
  portionSentence,
  tallyPortions,
  type PortionLine,
} from "../src/packs/production/core/portions";
import {
  COST_BASES,
  RUN_STATUSES,
  SLUG_FORMAT,
  INSPECTIONS,
  INSPECTION_LABELS,
  INSPECTION_NOTES,
  inspectionNote,
  LABELLING_OPTIONS,
  RATING_LABELS,
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_NOTES,
  BOOKING_SOON_WITHIN_DAYS,
  bookingStanding,
  exemptionsFrom,
  exemptionStanding,
  exemptionNote,
  EXEMPTION_WARN_AT,
  pathOf,
  PATH_LABELS,
  daysBetween,
  describeBookingDate,
  categoryRepeatsLabel,
  centsToDisplay,
  compareLabels,
  COMPUTABLE_PRICE_UNITS,
  isComputablePriceUnit,
  isPriceUnit,
  PRICE_CATEGORIES,
  PRICE_CATEGORY_LABELS,
  PRICE_UNITS,
  PRICE_UNIT_LABELS,
  PRICE_UNIT_NOTES,
  priceCategoryRank,
  priceWithUnit,
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

  it("says the tenant's word, not the pack's, in every note", () => {
    // FOUND BY DRIVING IT. The note under the inspection field said "this
    // processor" on a screen that said Butcher everywhere else — a renameable
    // word hardcoded in the one paragraph a person actually reads.
    expect(inspectionNote("unknown", "Butcher")).toContain("this butcher");
    expect(inspectionNote("unknown", "Butcher")).not.toContain("processor");
    expect(inspectionNote("unknown", "Processor")).toContain("this processor");

    // No note may keep an unsubstituted token, whatever it is called, and no
    // note may name the pack's own default where a tenant word belongs.
    for (const value of INSPECTIONS) {
      const rendered = inspectionNote(value, "Butcher");
      expect(rendered).not.toContain("{word}");
      expect(rendered.toLowerCase()).not.toContain("processor");
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

  it("keeps the booking set closed, with no state for \"it happened\"", () => {
    // Three, and the absence of a fourth is the decision. Whether a date became
    // a processing day is answered by run_id; a status somebody must remember
    // to advance is how a farm ends up with a list that says everything is
    // still pending.
    expect([...BOOKING_STATUSES]).toEqual(["held", "confirmed", "cancelled"]);
    for (const s of BOOKING_STATUSES) {
      expect(BOOKING_STATUS_LABELS[s]).toBeTruthy();
      expect(BOOKING_STATUS_NOTES[s]?.length ?? 0).toBeGreaterThan(20);
    }
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

/**
 * ── BOOKED DATES (slice 1c) ───────────────────────────────────────────────
 *
 * **`bookingStanding` IS THE WHOLE SLICE IN ONE FUNCTION.** Everything the
 * screen groups by and everything the digest raises comes out of it, and the
 * state that justifies the feature — `missed` — exists only because it is
 * derived. Nothing sets it, so nothing can forget to.
 */
describe("what a plant charges", () => {
  it("keeps the unit set CLOSED, and keeps all eight in it", () => {
    // **THE COLUMN THE ITEMISED PRICE LIST EXISTS FOR.** $1.05 is a different
    // amount of money in each of these, and the pack has already paid once for
    // a column that could only hold one of them: `cut_wrap_cents_per_lb` was
    // per pound, every poultry plant quotes cutting per bird, and a real rate
    // sheet is what proved it. Mirrors the CHECK on
    // production_processor_price_items.unit.
    expect([...PRICE_UNITS]).toEqual([
      "head",
      "live_lb",
      "hanging_lb",
      "finished_lb",
      "package",
      "box",
      "flat",
      "hour",
    ]);
  });

  it("has a short label and an explanation for every unit", () => {
    // A unit with no label renders as a slug beside a price. A unit with no
    // note leaves "per lb hanging" and "per lb packaged" as the same words to
    // somebody who has not butchered.
    for (const unit of PRICE_UNITS) {
      expect(PRICE_UNIT_LABELS[unit]).toBeTruthy();
      expect(PRICE_UNIT_NOTES[unit]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("knows which units a finished run can work out for itself", () => {
    // The split the next slice rests on: these four come off the carcass rows
    // and the outputs, and the rest are a number only a person knows. Getting
    // this wrong in either direction is a fee invented or a fee lost.
    expect(COMPUTABLE_PRICE_UNITS.every(isComputablePriceUnit)).toBe(true);
    for (const unit of ["head", "live_lb", "hanging_lb", "finished_lb"]) {
      expect(isComputablePriceUnit(unit)).toBe(true);
    }
    for (const unit of ["package", "box", "flat", "hour"]) {
      expect(isComputablePriceUnit(unit)).toBe(false);
    }
  });

  it("refuses a unit it does not know, however plausible", () => {
    expect(isPriceUnit("head")).toBe(true);
    expect(isPriceUnit("lb")).toBe(false);
    expect(isPriceUnit("each")).toBe(false);
    expect(isPriceUnit("")).toBe(false);
  });

  it("ranks the categories the way a rate sheet reads, with the unexpected last", () => {
    // The category is an OPEN taxonomy — the first plant charging for something
    // nobody anticipated must not be a migration — so the order is a rank
    // rather than an enum, and anything unanticipated sorts to the end instead
    // of to the top.
    expect(priceCategoryRank("slaughter")).toBeLessThan(
      priceCategoryRank("cutting"),
    );
    expect(priceCategoryRank("extra")).toBeLessThan(
      priceCategoryRank("brining"),
    );
    for (const category of PRICE_CATEGORIES) {
      expect(PRICE_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it("NEVER PRINTS A PRICE WITHOUT ITS UNIT, and prints nothing for an unquoted one", () => {
    // Both halves matter. A bare $1.05 is the ambiguity the table was built to
    // end; a $0.00 says the plant works for nothing, when the truth is that
    // nobody asked. Same refusal `centsToDisplay` makes.
    expect(priceWithUnit(105, "head")).toBe("$1.05 per head");
    expect(priceWithUnit(90, "hanging_lb")).toBe("$0.90 per lb hanging");
    expect(priceWithUnit(null, "head")).toBeNull();
    expect(priceWithUnit(undefined, "head")).toBeNull();
    // A genuine zero is a real answer — they waived it — and does print.
    expect(priceWithUnit(0, "flat")).toBe("$0.00 flat");
  });
});

describe("bookingStanding", () => {
  const at = (bookedFor: string, opts: Partial<{ status: string; runId: string | null }> = {}) =>
    bookingStanding(
      { status: "confirmed", runId: null, bookedFor, ...opts },
      "2026-08-23",
    );

  it("RAISES A DATE THAT WENT BY WITH NOTHING RECORDED", () => {
    // The reason this slice exists. Either the animals went and nobody wrote it
    // down — so the yield, the cost and the traceability chain are missing — or
    // the date was lost. Both need a person.
    expect(at("2026-08-20")).toBe("missed");
    expect(at("2026-08-22")).toBe("missed");
  });

  it("stops raising it the moment somebody records what happened", () => {
    // Self-clearing, which notifications.md requires of anything that reaches a
    // person unasked. Two ways out, and both are the right thing to do.
    expect(at("2026-08-20", { runId: "run-1" })).toBe("done");
    expect(at("2026-08-20", { status: "cancelled" })).toBe("cancelled");
  });

  it("a finished date is never urgent again, whichever way it finished", () => {
    expect(at("2026-09-30", { status: "cancelled" })).toBe("cancelled");
    expect(at("2026-09-30", { runId: "run-1" })).toBe("done");
  });

  it("separates today, soon, and far enough away to ignore", () => {
    expect(at("2026-08-23")).toBe("today");
    expect(at("2026-08-24")).toBe("soon");
    // Twenty-one days is a livestock horizon, not a software one: animals at
    // weight, a trailer, and a withdrawal that has cleared.
    expect(BOOKING_SOON_WITHIN_DAYS).toBe(21);
    expect(at("2026-09-13")).toBe("soon");
    expect(at("2026-09-14")).toBe("upcoming");
  });

  it("counts days across a month end and a DST change without drifting", () => {
    // Both sides are parsed at UTC midnight, so no transition can make a day 23
    // hours long. The tenant's zone was already applied when `today` was made;
    // applying it twice is how an off-by-one appears for half the year.
    expect(daysBetween("2026-08-23", "2026-09-13")).toBe(21);
    expect(daysBetween("2026-10-25", "2026-11-08")).toBe(14);
    expect(daysBetween("2026-03-01", "2026-03-15")).toBe(14);
    expect(daysBetween("2026-08-23", "2026-08-20")).toBe(-3);
  });

  it("says when in words, never a bare date", () => {
    expect(describeBookingDate("2026-08-23", "2026-08-23")).toBe("today");
    expect(describeBookingDate("2026-08-24", "2026-08-23")).toBe("tomorrow");
    expect(describeBookingDate("2026-08-22", "2026-08-23")).toBe("yesterday");
    expect(describeBookingDate("2026-09-04", "2026-08-23")).toBe("in 12 days");
    expect(describeBookingDate("2026-08-20", "2026-08-23")).toBe("3 days ago");
  });
});

/**
 * ── THE PROCESSING PATH AND THE EXEMPTION (slice 1d) ──────────────────────
 *
 * The path is derived from one column and the exemption is a ratio over runs.
 * Neither is stored as its own answer, which is the rule the rest of this pack
 * has followed since slice 0.
 */
describe("processing path", () => {
  it("is on-farm exactly when no processor is named", () => {
    // Null is NOT missing data here. It is the other half of the choice the
    // design describes: on-farm uninspected, or sent out to a butcher.
    expect(pathOf(null)).toBe("on_farm");
    expect(pathOf("some-processor-id")).toBe("sent_out");
    expect(PATH_LABELS.on_farm).toBe("Done here");
    expect(PATH_LABELS.sent_out).toBe("Sent out");
  });
});

describe("exemptionsFrom", () => {
  it("reads a cap from the profile and never invents one", () => {
    // A pack carrying "poultry: 1000" would know both what a bird is and whose
    // law it is under. The pilot's figure lives in the profile.
    expect(exemptionsFrom({ exemptions: [{ kind: "poultry", annualHead: 1000 }] }))
      .toEqual([{ kind: "poultry", annualHead: 1000 }]);
    expect(exemptionsFrom(undefined)).toEqual([]);
    expect(exemptionsFrom({})).toEqual([]);
    expect(exemptionsFrom({ exemptions: "poultry" })).toEqual([]);
  });

  it("drops a malformed rule instead of trusting it", () => {
    // tenant_modules.config is jsonb with no shape constraint, and this figure
    // decides whether a screen tells a farm it may keep processing birds. A
    // half-typed rule must not become a cap of NaN or of zero.
    expect(
      exemptionsFrom({
        exemptions: [
          { kind: "poultry", annualHead: 1000 },
          { kind: "swine" },
          { annualHead: 50 },
          { kind: "beef", annualHead: 0 },
          { kind: "goat", annualHead: "many" },
          "nonsense",
        ],
      }),
    ).toEqual([{ kind: "poultry", annualHead: 1000 }]);
  });
});

describe("exemptionStanding", () => {
  it("warns with room left to do something about it", () => {
    // 80%, and the reason is a lead time rather than a round number: a
    // processor books six to twelve months ahead, so being told at 999 is being
    // told far too late to send the next batch out instead.
    expect(EXEMPTION_WARN_AT).toBe(0.8);
    expect(exemptionStanding(0, 1000)).toBe("clear");
    expect(exemptionStanding(799, 1000)).toBe("clear");
    expect(exemptionStanding(800, 1000)).toBe("close");
    expect(exemptionStanding(999, 1000)).toBe("close");
  });

  it("separates AT the limit from OVER it", () => {
    // Different sentences, because they are different situations: one means
    // every batch from here goes out, the other means meat has already been
    // processed that cannot be sold the way somebody may be assuming.
    expect(exemptionStanding(1000, 1000)).toBe("at");
    expect(exemptionStanding(1001, 1000)).toBe("over");
  });

  it("says nothing when there is no cap to be near", () => {
    expect(exemptionStanding(50, 0)).toBe("clear");
  });

  it("has a sentence for every standing, and never a bare number", () => {
    for (const [used, cap] of [[0, 1000], [850, 1000], [1000, 1000], [1200, 1000]]) {
      const note = exemptionNote(
        exemptionStanding(used, cap),
        used,
        cap,
        "Butcher",
      );
      expect(note.length).toBeGreaterThan(15);
      // The tenant's word, never the pack's default.
      expect(note).not.toContain("Processor");
    }
    expect(exemptionNote("over", 1200, 1000, "Butcher")).toContain("200 more");
    expect(exemptionNote("close", 850, 1000, "Butcher")).toContain("150 left");
  });
});

// ------------------------------------------- the whole-bird remainder (2f) ---

function cut(
  key: string,
  patch: Partial<PortionLine> = {},
): PortionLine {
  return {
    key,
    label: key,
    category: "cutting",
    unit: "head",
    quantity: null,
    ...patch,
  };
}

describe("tallyPortions", () => {
  it("derives the ten that go back whole out of a hundred", () => {
    // The founder's sentence, as arithmetic: "10 of the 100 birds might need to
    // be whole birds and then some will get cut up."
    const tally = tallyPortions(
      [
        cut("slaughter", { category: "slaughter", label: "Slaughter" }),
        cut("quartered", { label: "Quartered", quantity: 90 }),
      ],
      100,
    );

    expect(tally.headPortioned).toBe(90);
    expect(tally.headWhole).toBe(10);
    expect(tally.headOver).toBeNull();
    expect(portionRefusal(tally)).toBeNull();
    expect(portionSentence(tally)).toBe("90 Quartered, 10 back whole");
  });

  it("does not count slaughter, which every animal gets", () => {
    // Counting it would read a hundred slaughtered plus ninety quartered as a
    // sheet for a hundred and ninety birds.
    const tally = tallyPortions(
      [
        cut("s", { category: "slaughter", label: "Slaughter", quantity: 100 }),
        cut("p", { category: "packaging", label: "Vacuum bag", quantity: 100 }),
        cut("q", { label: "Quartered", quantity: 90 }),
      ],
      100,
    );
    expect(tally.shares.map((s) => s.key)).toEqual(["q"]);
    expect(tally.headWhole).toBe(10);
  });

  it("flags a sheet asking for more head than it covers", () => {
    // "Ask for 130 and nothing objects" — the SHEET_OVER_ACCOUNTED shape,
    // arriving on the cut sheet.
    const tally = tallyPortions(
      [
        cut("q", { label: "Quartered", quantity: 90 }),
        cut("e", { label: "Eight piece", quantity: 40 }),
      ],
      100,
    );
    expect(tally.headPortioned).toBe(130);
    expect(tally.headWhole).toBeNull();
    expect(tally.headOver).toBe(30);
    expect(portionRefusal(tally)).toBe("SHEET_OVER_PORTIONED");
    // Nothing to hand over: a printed "minus thirty back whole" would be worse
    // than the silence.
    expect(portionSentence(tally)).toBe("");
  });

  it("reads a blank quantity as all of them, the way the fee already does", () => {
    // `lineQuantity` measures the whole run for a head-priced line with nothing
    // typed, and that figure is what reached the meat. Two answers to one
    // question is the thing this agreement exists to prevent.
    const one = tallyPortions([cut("q", { label: "Quartered" })], 100);
    expect(one.shares[0]?.source).toBe("all");
    expect(one.headPortioned).toBe(100);
    expect(one.headWhole).toBe(0);
    expect(portionSentence(one)).toBe("100 Quartered");

    // Two blanks each claim every bird, which over-accounts — and being told so
    // is the useful half.
    const two = tallyPortions(
      [cut("q", { label: "Quartered" }), cut("e", { label: "Eight piece" })],
      100,
    );
    expect(portionRefusal(two)).toBe("SHEET_OVER_PORTIONED");
  });

  it("says a sheet with no cutting at all is all whole birds", () => {
    // Not a refusal: a hundred birds and a slaughter line is a hundred whole
    // birds, which is exactly what a plant that will not cut under fifty offers.
    const tally = tallyPortions(
      [cut("s", { category: "slaughter", label: "Slaughter" })],
      100,
    );
    expect(portionRefusal(tally)).toBeNull();
    expect(tally.headWhole).toBe(100);
    expect(portionSentence(tally)).toBe("100 back whole");
  });

  it("refuses when cutting is charged by weight, and when nobody said how many head", () => {
    const byWeight = tallyPortions(
      [cut("c", { label: "Cut and wrap", unit: "hanging_lb" })],
      1,
    );
    expect(byWeight.cutByWeight).toBe(true);
    expect(portionRefusal(byWeight)).toBe("CUT_NOT_BY_HEAD");

    const noHead = tallyPortions([cut("q", { label: "Quartered" })], null);
    expect(portionRefusal(noHead)).toBe("NO_HEAD_COUNT");
    expect(noHead.headWhole).toBeNull();
    expect(portionSentence(noHead)).toBe("");
  });

  it("ignores an instruction line, which asks for no animals at all", () => {
    const tally = tallyPortions(
      [
        cut("i", { category: "cutting", label: "Grind the chuck", unit: null }),
        cut("q", { label: "Quartered", quantity: 90 }),
      ],
      100,
    );
    expect(tally.shares).toHaveLength(1);
    expect(tally.headWhole).toBe(10);
  });

  it("gives every refusal a sentence", () => {
    for (const reason of [
      "NO_HEAD_COUNT",
      "CUT_NOT_BY_HEAD",
      "SHEET_OVER_PORTIONED",
    ] as const) {
      expect(PORTION_REFUSALS[reason].length).toBeGreaterThan(20);
    }
  });
});

describe("compareLabels", () => {
  it("puts a rate sheet's bands in the order the paper has them", () => {
    // What `localeCompare` produced on a live screen: 1001 to 1500, 101 to 250,
    // 251 to 500, 50 to 100.
    const bands = ["1001 to 1500", "101 to 250", "251 to 500", "50 to 100"];
    expect([...bands].sort(compareLabels)).toEqual([
      "50 to 100",
      "101 to 250",
      "251 to 500",
      "1001 to 1500",
    ]);
  });

  it("sorts by the words first and only then by the figures", () => {
    const rows = [
      "Slaughter, Cornish x, 501 to 1000",
      "Cutting, 50 to 100",
      "Slaughter, Cornish x, 50 to 100",
    ];
    expect([...rows].sort(compareLabels)).toEqual([
      "Cutting, 50 to 100",
      "Slaughter, Cornish x, 50 to 100",
      "Slaughter, Cornish x, 501 to 1000",
    ]);
  });

  it("is a general comparison, not a band-shaped one", () => {
    expect([" Box of 12", " Box of 6"].sort(compareLabels)).toEqual([
      " Box of 6",
      " Box of 12",
    ]);
    expect(compareLabels("Quartered", "Quartered")).toBe(0);
  });
});

describe("categoryRepeatsLabel", () => {
  it("suppresses a category the label already begins with", () => {
    // `Slaughter, Cornish x, 50 to 100 · Slaughter` was on a live screen: the
    // old check fired only on an exact match.
    expect(categoryRepeatsLabel("Slaughter", "Slaughter")).toBe(true);
    expect(categoryRepeatsLabel("Slaughter", "Slaughter, Cornish x, 50 to 100")).toBe(
      true,
    );
    expect(categoryRepeatsLabel("Slaughter", " slaughter ")).toBe(true);
  });

  it("keeps it when the label only starts with the same letters", () => {
    // The boundary is load-bearing: a levy is not a repeat.
    expect(categoryRepeatsLabel("Slaughter", "Slaughterhouse levy")).toBe(false);
    expect(categoryRepeatsLabel("Cutting", "Quartered")).toBe(false);
    expect(categoryRepeatsLabel("", "Quartered")).toBe(false);
  });
});

// ------------------------------------------------ the app does the lookup ---

function priced(patch: Partial<BandedItem> = {}): BandedItem {
  return {
    id: patch.id ?? "x",
    kind: "chicken",
    category: "slaughter",
    label: "Slaughter",
    variant: "",
    headMin: 0,
    headMax: null,
    priceCents: 350,
    unit: "head",
    minimumCents: null,
    ...patch,
  };
}

/** The shape off the real sheet: one breed, six bands. */
const CORNISH = [
  priced({ id: "a", variant: "Cornish Cross", headMin: 50, headMax: 100, priceCents: 350 }),
  priced({ id: "b", variant: "Cornish Cross", headMin: 101, headMax: 250, priceCents: 325 }),
  priced({ id: "c", variant: "Cornish Cross", headMin: 251, headMax: 500, priceCents: 300 }),
  priced({ id: "d", variant: "Cornish Cross", headMin: 501, headMax: 1000, priceCents: 275 }),
  priced({ id: "e", variant: "Cornish Cross", headMin: 1001, headMax: 1500, priceCents: 260 }),
  priced({ id: "f", variant: "Cornish Cross", headMin: 1501, headMax: null, priceCents: 250 }),
];

describe("resolveBands", () => {
  it("resolves 800 Cornish Cross to $2.75, and says which band", () => {
    const [group] = resolveBands(CORNISH, 800);
    expect(group.chosen?.id).toBe("d");
    expect(group.chosen?.priceCents).toBe(275);
    expect(group.refusedBecause).toBeNull();
    expect(describeBand(group.chosen!)).toBe("501 to 1000 head");
  });

  it("keeps the breeds apart, and offers one entry each", () => {
    const ranger = CORNISH.map((b) =>
      priced({ ...b, id: `r-${b.id}`, variant: "Freedom Ranger", priceCents: (b.priceCents ?? 0) + 25 }),
    );
    const groups = resolveBands([...CORNISH, ...ranger], 800);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.chosen?.priceCents).sort()).toEqual([275, 300]);
  });

  it("reports a batch no band covers rather than quoting the nearest", () => {
    // Printed on the sheet this was modelled from: "if you show up with less
    // than 50 chickens, we do not offer cutting, whole birds only."
    const [group] = resolveBands(CORNISH, 30);
    expect(group.chosen).toBeNull();
    expect(group.refusedBecause).toBe("NO_BAND_COVERS");
    // Emphatically NOT the 50-to-100 row, which is the nearest one.
    expect(BAND_REFUSALS.NO_BAND_COVERS).toContain("rather than rounded");
  });

  it("says the sheet is ambiguous rather than picking, when two bands overlap", () => {
    const overlapping = [
      priced({ id: "a", headMin: 50, headMax: 200, priceCents: 350 }),
      priced({ id: "b", headMin: 101, headMax: 250, priceCents: 325 }),
    ];
    const [group] = resolveBands(overlapping, 150);
    expect(group.chosen).toBeNull();
    expect(group.refusedBecause).toBe("BANDS_OVERLAP");
    // And a head count only one of them covers still resolves.
    expect(resolveBands(overlapping, 60)[0].chosen?.id).toBe("a");
  });

  it("resolves an unbanded row whatever the head count, including none", () => {
    // Most of a rate sheet is this: a delivery charge, a bag, a giblet fee.
    const delivery = [priced({ id: "d", category: "extra", label: "Delivery", unit: "flat" })];
    expect(resolveBands(delivery, null)[0].chosen?.id).toBe("d");
    expect(resolveBands(delivery, 800)[0].chosen?.id).toBe("d");
  });

  it("refuses to pick a band when the sheet does not say how many head", () => {
    const [group] = resolveBands(CORNISH, null);
    expect(group.chosen).toBeNull();
    expect(group.refusedBecause).toBe("NO_HEAD_COUNT");
    // The bands still come back, lowest floor first, so a person can pick one.
    expect(group.bands.map((b) => b.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("describes a band the way the sheet reads it", () => {
    expect(describeBand(priced({ headMin: 50, headMax: 100 }))).toBe("50 to 100 head");
    expect(describeBand(priced({ headMin: 1501, headMax: null }))).toBe("1501 head and over");
    expect(describeBand(priced({ headMin: 0, headMax: 49 }))).toBe("up to 49 head");
    // Not banded at all — nothing to say, and the caller drops the span.
    expect(describeBand(priced({}))).toBe("");
    expect(isBanded(priced({}))).toBe(false);
    expect(isBanded(priced({ headMin: 50 }))).toBe(true);
    expect(isBanded(priced({ headMax: 49 }))).toBe(true);
  });

  it("covers a band inclusively at both ends", () => {
    const band = priced({ headMin: 101, headMax: 250 });
    expect(bandCovers(band, 100)).toBe(false);
    expect(bandCovers(band, 101)).toBe(true);
    expect(bandCovers(band, 250)).toBe(true);
    expect(bandCovers(band, 251)).toBe(false);
    // No ceiling means no ceiling.
    expect(bandCovers(priced({ headMin: 1501 }), 40_000)).toBe(true);
  });
});

describe("snapshotLabel", () => {
  it("says which of 24 prices was quoted, after the rate sheet is gone", () => {
    // The line is a SNAPSHOT and `SET NULL (price_item_id)` guarantees the row
    // survives its price item; nothing guarantees the meaning of "Slaughter" on
    // its own once the breed and the band are columns somewhere else.
    expect(snapshotLabel(CORNISH[3])).toBe(
      "Slaughter · Cornish Cross · 501 to 1000 head",
    );
  });

  it("leaves an ordinary row alone", () => {
    expect(snapshotLabel(priced({ label: "Quartered", category: "cutting" }))).toBe(
      "Quartered",
    );
    expect(snapshotLabel(priced({ label: "Quartered", variant: "Boneless" }))).toBe(
      "Quartered · Boneless",
    );
  });

  it("shortens back to what is being asked for, for the printed sentence", () => {
    // FOUND BY READING A LIVE SHEET OUT LOUD. The reconciliation joins with the
    // same `·` this composes with, so a sheet for ninety quartered birds printed
    // "90 Quartered · 50 head and over · 10 back whole" — the band reading as a
    // third portion.
    expect(shortLabel(snapshotLabel(CORNISH[3]))).toBe("Slaughter");
    expect(shortLabel("Quartered · 50 head and over")).toBe("Quartered");
    expect(shortLabel("Quartered")).toBe("Quartered");
    const tally = tallyPortions(
      [
        cut("q", { label: shortLabel("Quartered · 50 head and over"), quantity: 90 }),
      ],
      100,
    );
    expect(portionSentence(tally)).toBe("90 Quartered, 10 back whole");
  });

  it("is suppressed as a repeated category the way any label is", () => {
    // The composed label begins with its category, so the screen does not print
    // "Slaughter · Cornish Cross · 501 to 1000 head · Slaughter".
    expect(categoryRepeatsLabel("Slaughter", snapshotLabel(CORNISH[3]))).toBe(true);
  });
});

describe("yieldWarning — livestock slice 8d", () => {
  it("says nothing about a yield that is possible", () => {
    expect(yieldWarning(0.699)).toBeNull();
    expect(yieldWarning(1)).toBeNull();
    expect(yieldWarning(null)).toBeNull();
  });

  it("TELLS ON MORE COMING OUT THAN WENT IN", () => {
    // Weight is not created by cutting an animal up. Hilltop Farm has a
    // finished kill reading 150%, which is 100 lb in and 150 lb out.
    const said = yieldWarning(1.5);
    expect(said).not.toBeNull();
    expect(said).toMatch(/never weighed|packaging/i);
  });
});
