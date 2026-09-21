import { describe, expect, it } from "vitest";
import {
  extendedCents,
  needsPricing,
  nextToPrice,
  phaseOnScreen,
  priceQuestionFor,
  readPriceReply,
  type PendingPrice,
  type PriceableLine,
} from "../src/packs/jobs/walk-price-math";

/**
 * THE MONEY, ASKED FOR RATHER THAN GUESSED (X6).
 *
 * The founder: *"I'm still not seeing how the estimate is built with pricing
 * etc. Seems like I am just answering questions."* He was right — the walk
 * was forbidden to touch money at all.
 *
 * The rule these tests protect: **one number, one meaning.** `$3,400`
 * against 240 lf is either three and a half thousand or eight hundred and
 * sixteen thousand, and nothing here is allowed to decide which.
 */

function line(over: Partial<PriceableLine> = {}): PriceableLine {
  return {
    id: "l1",
    description: "Footing concrete",
    unit: "lf",
    quantityThousandths: 240_000,
    unitCostCents: 0,
    basis: "none",
    ...over,
  };
}

describe("needsPricing", () => {
  it("is what X2b already calls a line it could not price", () => {
    expect(needsPricing(line())).toBe(true);
    expect(needsPricing(line({ basis: "memory", unitCostCents: 1_400 }))).toBe(false);
    expect(needsPricing(line({ basis: "sub", unitCostCents: 18_400_00 }))).toBe(false);
  });

  /** A priced line that somehow carries nothing is still a line with no price. */
  it("catches a basis that claims a price the line has not got", () => {
    expect(needsPricing(line({ basis: "memory", unitCostCents: 0 }))).toBe(true);
  });
});

describe("nextToPrice", () => {
  it("takes them in the order they were proposed", () => {
    const rows = [
      line({ id: "a", basis: "memory", unitCostCents: 100 }),
      line({ id: "b" }),
      line({ id: "c" }),
    ];
    expect(nextToPrice(rows)?.id).toBe("b");
  });

  it("is nothing once everything carries a price", () => {
    expect(nextToPrice([line({ basis: "said", unitCostCents: 1_400 })])).toBeNull();
    expect(nextToPrice([])).toBeNull();
  });
});

describe("priceQuestionFor", () => {
  /**
   * **THE QUESTION NAMES WHICH NUMBER IT WANTS.** Without the unit in the
   * wording, `3400` against 240 lf is unreadable — and unreadable here means
   * $816,000 on a proposal.
   */
  it("asks for a rate when there is a real quantity, and says the unit", () => {
    const ask = priceQuestionFor(line());
    expect(ask.perUnit).toBe(true);
    expect(ask.prompt).toBe("Footing concrete, 240 lf — what are you getting per lf?");
  });

  it("asks for the amount outright on a lump, without saying per each", () => {
    const ask = priceQuestionFor(
      line({ description: "Mobilisation", unit: "", quantityThousandths: 1_000 }),
    );
    expect(ask.perUnit).toBe(false);
    expect(ask.prompt).toBe("Mobilisation — what are you getting for that?");
    expect(ask.prompt).not.toContain("per");
  });

  /** A quantity of one with a unit is still one thing, not a rate. */
  it("treats one of something as a lump", () => {
    expect(priceQuestionFor(line({ unit: "ea", quantityThousandths: 1_000 })).perUnit).toBe(false);
  });

  it("writes the quantity the way the rest of the pack does", () => {
    expect(priceQuestionFor(line({ quantityThousandths: 62_500 })).prompt).toContain("62.5 lf");
  });
});

describe("readPriceReply", () => {
  const rate = priceQuestionFor(line());
  const lump = priceQuestionFor(line({ unit: "", quantityThousandths: 1_000 }));

  it("takes a figure however it is written", () => {
    expect(readPriceReply("14", rate)).toEqual({ kind: "price", unitCostCents: 1_400 });
    expect(readPriceReply("$14.00", rate)).toEqual({ kind: "price", unitCostCents: 1_400 });
    expect(readPriceReply("about 14 a foot", rate)).toEqual({ kind: "price", unitCostCents: 1_400 });
    expect(readPriceReply("3,400", lump)).toEqual({ kind: "price", unitCostCents: 340_000 });
  });

  /**
   * **TWO NUMBERS IS NOT AN ANSWER.** *"About twelve, maybe fourteen"* is a
   * person thinking aloud. Averaging it, or taking the larger, is the pack
   * inventing a price — so it asks again, which costs a sentence.
   */
  it("refuses to choose between two figures", () => {
    expect(readPriceReply("about 12, maybe 14", rate)).toEqual({ kind: "unclear" });
    expect(readPriceReply("12 to 14 a foot", rate)).toEqual({ kind: "unclear" });
  });

  it("takes passing as a real answer", () => {
    for (const said of ["skip", "pass for now", "leave it", "TBD", "I don't know yet"]) {
      expect(readPriceReply(said, rate), said).toEqual({ kind: "pass" });
    }
  });

  /** A passing word wins over a number in it: "skip, maybe 14" is a pass. */
  it("prefers passing over a figure in the same breath", () => {
    expect(readPriceReply("skip it, maybe 14", rate)).toEqual({ kind: "pass" });
  });

  it("refuses nothing, and refuses nought", () => {
    expect(readPriceReply("   ", rate)).toEqual({ kind: "unclear" });
    expect(readPriceReply("0", rate)).toEqual({ kind: "unclear" });
  });

  /**
   * A lump's answer IS its amount; a rate's answer is per unit. This is the
   * whole ambiguity the question's wording exists to remove, held here.
   */
  it("keeps the two readings apart", () => {
    expect(readPriceReply("3400", rate)).toEqual({ kind: "price", unitCostCents: 340_000 });
    expect(readPriceReply("3400", lump)).toEqual({ kind: "price", unitCostCents: 340_000 });
    /**
     * Same figure, and the extension is what differs: **$3,400 read as a
     * rate against 240 lf is eight hundred and sixteen thousand dollars.**
     * That is the number the wording exists to keep off a proposal.
     */
    expect(extendedCents(240_000, 340_000)).toBe(816_000_00);
    expect(extendedCents(1_000, 340_000)).toBe(3_400_00);
  });
});

describe("extendedCents", () => {
  it("is the quantity at the rate, rounded once", () => {
    expect(extendedCents(240_000, 1_400)).toBe(336_000);
    expect(extendedCents(1_000, 18_400_00)).toBe(18_400_00);
    expect(extendedCents(62_500, 14_800)).toBe(925_000);
  });

  it("is nothing at nothing", () => {
    expect(extendedCents(0, 1_400)).toBe(0);
    expect(extendedCents(240_000, 0)).toBe(0);
  });
});

/**
 * **WHICH PHASE THE SCREEN SAYS IT IS ON.**
 *
 * The founder, driving walk EST-6: the header read *"04. STRUCTURAL /
 * Rough carpentry - step 1 of 10"* while the question on the screen was
 * *"Wall board, 1/2", hang & finish, 1,216 sf - what are you getting per
 * sf?"*, which is a DRYWALL line. Every price in a phase was asked under
 * the name of a different phase, because the header came off `currentStep`
 * and `currentStep` has already left the phase whose questions settled.
 *
 * A price answered against the wrong mental phase is the mistake this whole
 * layer exists to avoid, so it is held by a test rather than by a comment.
 */
describe("phaseOnScreen", () => {
  const steps = [
    { id: "s1", title: "Rough carpentry", section: "04. Structural", guidance: "frame it" },
    { id: "s2", title: "Drywall", section: "09. Finishes", guidance: "hang and finish" },
    { id: "s3", title: "Paint", section: "09. Finishes", guidance: "" },
  ];
  function price(over: Partial<PendingPrice> = {}): PendingPrice {
    return {
      lineId: "pl1",
      stepId: "s2",
      stepTitle: "Drywall",
      stepSection: "09. Finishes",
      ...over,
    };
  }

  it("is where the walk is standing when nothing is being priced", () => {
    expect(phaseOnScreen(steps, steps[0], null)).toEqual({
      stepId: "s1",
      title: "Rough carpentry",
      section: "04. Structural",
      guidance: "frame it",
      number: 1,
    });
  });

  /** The bug, in one assertion: the money belongs to the phase it came from. */
  it("is the phase being PRICED, not the one the walk has derived", () => {
    const on = phaseOnScreen(steps, steps[2], price());
    expect(on.title).toBe("Drywall");
    expect(on.section).toBe("09. Finishes");
    expect(on.number).toBe(2);
    expect(on.stepId).toBe("s2");
  });

  /**
   * The outline is read live (ADR 0098), so a phase renamed mid-walk reads
   * by its new name — the line's remembered words are the FALLBACK, not the
   * answer.
   */
  it("prefers the outline's words while the outline still has the step", () => {
    const renamed = [steps[0], { ...steps[1], title: "Wall board" }, steps[2]];
    expect(phaseOnScreen(renamed, steps[2], price()).title).toBe("Wall board");
  });

  /** And a phase DELETED mid-walk can still say what it was called. */
  it("falls back to the words the line remembers, and reports no number", () => {
    const on = phaseOnScreen([steps[0], steps[2]], steps[2], price());
    expect(on.title).toBe("Drywall");
    expect(on.section).toBe("09. Finishes");
    /** 0, never 2 of 2: the outline no longer has anywhere to point. */
    expect(on.number).toBe(0);
  });

  /** A proposed line with no step at all is the same case. */
  it("handles a price with no phase behind it", () => {
    const on = phaseOnScreen(steps, steps[2], price({ stepId: null, stepTitle: "", stepSection: "" }));
    expect(on).toEqual({ stepId: null, title: "", section: "", guidance: "", number: 0 });
  });

  /** Past the end of the outline: what the header has always said. */
  it("counts the whole outline when there is nowhere to stand", () => {
    expect(phaseOnScreen(steps, null, null).number).toBe(3);
    expect(phaseOnScreen(steps, null, null).title).toBe("");
  });
});
