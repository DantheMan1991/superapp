import { describe, expect, it } from "vitest";
import {
  formatMeasurement,
  measureLines,
  measureQuestionFor,
  measureSlug,
  nextToMeasure,
  outstandingMeasures,
  readMeasureReply,
  type DeclaredMeasure,
  type TakenMeasure,
} from "../src/packs/jobs/measure-math";

/**
 * MEASURING THE BUILDING BEFORE PRICING IT (X7).
 *
 * The founder's idea: *"What if before the questions it prompts you to grab
 * measurements. Full exterior elevation square footage, wall square footage,
 * wall perimeter etc. Then the questions can use this information as it
 * goes."*
 *
 * The rule these hold: **read what an estimator actually types, and refuse
 * everything that would have to be guessed at.** A wrong measurement is
 * worse than a wrong price, because it multiplies through every line that
 * reads it.
 */

function declared(over: Partial<DeclaredMeasure> = {}): DeclaredMeasure {
  return {
    id: "m1",
    name: "Wall perimeter",
    unit: "lf",
    kind: "length",
    guidance: "",
    required: true,
    ...over,
  };
}

function taken(over: Partial<TakenMeasure> = {}): TakenMeasure {
  return {
    slug: "wall-perimeter",
    name: "Wall perimeter",
    unit: "lf",
    valueThousandths: 248_000,
    passed: false,
    note: "",
    ...over,
  };
}

describe("measureSlug", () => {
  it("is the name reduced to its identity", () => {
    expect(measureSlug("Wall perimeter")).toBe("wall-perimeter");
    expect(measureSlug("  Wall   Perimeter  ")).toBe("wall-perimeter");
    expect(measureSlug("Roof area (sf)")).toBe("roof-area-sf");
  });

  /** Two outlines asking for the same number are asking for ONE number. */
  it("puts the same number under the same name however it is written", () => {
    expect(measureSlug("wall perimeter")).toBe(measureSlug("Wall Perimeter"));
  });
});

describe("measureQuestionFor", () => {
  it("names the unit, because the answer is a bare figure", () => {
    expect(measureQuestionFor(declared()).prompt).toBe("Wall perimeter — how many lf?");
  });

  it("carries the business's own guidance into the question", () => {
    const ask = measureQuestionFor(declared({ guidance: "outside face, all the way round" }));
    expect(ask.prompt).toBe("Wall perimeter — how many lf? (outside face, all the way round)");
  });

  it("asks plainly when there is no unit", () => {
    expect(measureQuestionFor(declared({ unit: "" })).prompt).toBe("Wall perimeter — what is it?");
  });
});

describe("nextToMeasure", () => {
  it("takes them in the order the outline lists them", () => {
    const list = [declared({ id: "a", name: "Footprint" }), declared({ id: "b" })];
    expect(nextToMeasure(list, [taken({ slug: "footprint" })])?.id).toBe("b");
  });

  /**
   * **A PASS IS A REAL ANSWER AND IT STICKS.** Without this the walk asks
   * the same thing at every turn, which is the bug X6 already paid for once.
   */
  it("does not ask again for one that was passed", () => {
    const passed = taken({ valueThousandths: null, passed: true });
    expect(nextToMeasure([declared()], [passed])).toBeNull();
  });

  it("is nothing once the list is answered", () => {
    expect(nextToMeasure([declared()], [taken()])).toBeNull();
    expect(nextToMeasure([], [])).toBeNull();
  });
});

describe("outstandingMeasures", () => {
  /** An optional one is offered, not owed: it must not hold the walk up. */
  it("counts only the ones the outline said were required", () => {
    const list = [declared({ id: "a" }), declared({ id: "b", name: "Deck area", required: false })];
    expect(outstandingMeasures(list, []).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("formatMeasurement and measureLines", () => {
  it("writes a number the way the rest of the pack does", () => {
    expect(formatMeasurement(taken())).toBe("248 lf");
    expect(formatMeasurement(taken({ valueThousandths: 2_400_500, unit: "sf" }))).toBe("2,400.5 sf");
  });

  it("says so plainly when there is no number", () => {
    expect(formatMeasurement(taken({ valueThousandths: null, passed: true }))).toBe("not measured");
  });

  /**
   * These lines go into EVERY turn's prompt, which is the whole point: an
   * answer falls out of the walk's context after thirty, and this does not.
   */
  it("gives the walk the numbers, with the note that qualifies them", () => {
    expect(
      measureLines([
        taken(),
        taken({ slug: "roof-area", name: "Roof area", unit: "sf", valueThousandths: 2_840_000, note: "4:12, no porch" }),
        taken({ slug: "deck", name: "Deck", valueThousandths: null, passed: true }),
      ]),
    ).toEqual(["- Wall perimeter: 248 lf", "- Roof area: 2,840 sf (4:12, no porch)"]);
  });
});

describe("readMeasureReply", () => {
  it("takes a plain figure however it is written", () => {
    expect(readMeasureReply("248")).toEqual({ kind: "value", valueThousandths: 248_000 });
    expect(readMeasureReply("2,400")).toEqual({ kind: "value", valueThousandths: 2_400_000 });
    expect(readMeasureReply("2400 sf")).toEqual({ kind: "value", valueThousandths: 2_400_000 });
    expect(readMeasureReply("about 248 lf")).toEqual({ kind: "value", valueThousandths: 248_000 });
    expect(readMeasureReply("call it 1,234,567")).toEqual({
      kind: "value",
      valueThousandths: 1_234_567_000,
    });
  });

  /**
   * **WHAT IS ON THE TAPE.** An estimator does not convert to a decimal
   * before typing, and a tool that made them would be a tool they stop
   * using — the founder's bar is *"seamless and snappy"*.
   */
  it("reads feet and inches", () => {
    expect(readMeasureReply(`38'-6"`)).toEqual({ kind: "value", valueThousandths: 38_500 });
    expect(readMeasureReply(`38' 6"`)).toEqual({ kind: "value", valueThousandths: 38_500 });
    expect(readMeasureReply(`38'6"`)).toEqual({ kind: "value", valueThousandths: 38_500 });
    expect(readMeasureReply("38 ft 6 in")).toEqual({ kind: "value", valueThousandths: 38_500 });
    expect(readMeasureReply(`40'`)).toEqual({ kind: "value", valueThousandths: 40_000 });
  });

  /** A perimeter is walked round a plan and written down as it is walked. */
  it("adds a run up", () => {
    expect(readMeasureReply("40 + 24 + 40 + 24")).toEqual({
      kind: "value",
      valueThousandths: 128_000,
    });
  });

  it("multiplies a footprint out, however it is written", () => {
    expect(readMeasureReply("24 x 40")).toEqual({ kind: "value", valueThousandths: 960_000 });
    expect(readMeasureReply("24 by 40")).toEqual({ kind: "value", valueThousandths: 960_000 });
    expect(readMeasureReply("24*40")).toEqual({ kind: "value", valueThousandths: 960_000 });
    expect(readMeasureReply(`24' x 40'`)).toEqual({ kind: "value", valueThousandths: 960_000 });
  });

  it("takes a sum of products, which is how a wall area gets written", () => {
    expect(readMeasureReply("40x9 + 24x9")).toEqual({ kind: "value", valueThousandths: 576_000 });
  });

  /**
   * **TWO FIGURES IS NOT AN ANSWER**, the rule X6 set for prices. Choosing
   * between them, or averaging, is the pack inventing a number.
   */
  it("refuses to choose between two figures", () => {
    expect(readMeasureReply("240 to 260")).toEqual({ kind: "unclear" });
    expect(readMeasureReply("240 or 260")).toEqual({ kind: "unclear" });
    expect(readMeasureReply("240, 260")).toEqual({ kind: "unclear" });
  });

  /**
   * **SUBTRACTION IS NOT READ ON PURPOSE.** `38-6` is feet and inches to
   * the person typing it; reading it as arithmetic would make it 32.
   */
  it("does not do arithmetic with a minus sign", () => {
    expect(readMeasureReply("38-6")).toEqual({ kind: "unclear" });
  });

  it("takes passing as a real answer", () => {
    for (const said of ["skip", "pass for now", "later", "n/a", "not on this job", "TBD", "I don't know"]) {
      expect(readMeasureReply(said), said).toEqual({ kind: "pass" });
    }
  });

  /**
   * A pass matched on a SUBSTRING would read *internal* as `na` and throw
   * away a measurement somebody was giving.
   */
  it("does not find a passing word inside another word", () => {
    expect(readMeasureReply("internal 40")).toEqual({ kind: "value", valueThousandths: 40_000 });
    expect(readMeasureReply("bananas")).toEqual({ kind: "unclear" });
    expect(readMeasureReply("laterals 120")).toEqual({ kind: "value", valueThousandths: 120_000 });
  });

  /**
   * One figure among words it does not know is still one figure. Refusing
   * *"2,400 sf gross"* would be safe and infuriating, and the founder's bar
   * is *"seamless and snappy and just part of the flow"*.
   */
  it("takes the one figure in an answer it does not otherwise understand", () => {
    expect(readMeasureReply("2,400 sf gross")).toEqual({ kind: "value", valueThousandths: 2_400_000 });
    expect(readMeasureReply("somewhere near 248")).toEqual({ kind: "value", valueThousandths: 248_000 });
  });

  it("refuses nothing, and refuses nought", () => {
    expect(readMeasureReply("   ")).toEqual({ kind: "unclear" });
    expect(readMeasureReply("0")).toEqual({ kind: "unclear" });
    expect(readMeasureReply("the usual")).toEqual({ kind: "unclear" });
  });
});
