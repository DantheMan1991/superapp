import { describe, expect, it } from "vitest";
import {
  extendedCents,
  needsPricing,
  nextToPrice,
  priceQuestionFor,
  readPriceReply,
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
