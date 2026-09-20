import { describe, expect, it } from "vitest";
import {
  isAlreadyAsked,
  proposeMerges,
  significantWords,
  stemWord,
  type StepLike,
} from "../src/packs/jobs/outline-merge";

/**
 * BRINGING ONE OUTLINE'S QUESTIONS ONTO ANOTHER'S STEPS.
 *
 * Every case below was measured against the pilot's own pair — 33 hand-edited
 * steps and a 73-step outline read off his chart — and the ones marked as
 * traps are matches the first cut actually made.
 */

function step(id: string, title: string, questions = 3): StepLike {
  return { id, title, questions };
}

/** His hand-edited outline, verbatim. */
const HAND = [
  step("h1", "Permits and fees"),
  step("h2", "Site work and excavation"),
  step("h3", "Foundation"),
  step("h4", "Framing labour"),
  step("h5", "Framing materials"),
  step("h6", "Electrical"),
  step("h7", "Gutters"),
  step("h8", "Landscaping"),
  step("h9", "Heating and cooling"),
];

/** The outline read off his chart, verbatim. */
const CHART = [
  step("c1", "Permits", 1),
  step("c2", "Excavation", 1),
  step("c3", "Foundation", 1),
  step("c4", "Framing", 1),
  step("c5", "Electrical Fixtures Material", 1),
  step("c6", "Electric", 1),
  step("c7", "Downspout/Footer/Gutter", 1),
  step("c8", "Landscape", 1),
  step("c9", "HVAC", 1),
];

describe("stemWord", () => {
  it("reaches across plain plurals and gerunds", () => {
    expect(stemWord("landscaping")).toBe("landscap");
    expect(stemWord("landscape")).toBe("landscap");
    expect(stemWord("gutters")).toBe("gutter");
    expect(stemWord("appliances")).toBe("applianc");
    expect(stemWord("appliance")).toBe("applianc");
  });
});

describe("significantWords", () => {
  /**
   * **THE BUG THAT MADE A MAGNET.** `and` is three letters, so a length
   * filter alone let it through, and a long title shares it with everything —
   * which is how *Utilities and septic* matched *Windows and Doors*.
   */
  it("drops the words that make a long title match everything", () => {
    expect([...significantWords("Windows and Doors (Including Hardware)")]).toEqual([
      "window",
      "door",
      "hardwar",
    ]);
  });

  it("drops words too short to mean anything", () => {
    expect([...significantWords("Tile")]).toEqual(["til"]);
    expect([...significantWords("AV")]).toEqual([]);
  });
});

describe("proposeMerges", () => {
  const proposals = proposeMerges(HAND, CHART);
  const by = (title: string) => proposals.find((p) => p.sourceTitle === title);

  it("matches the ones anybody would", () => {
    expect(by("Foundation")).toMatchObject({ targetTitle: "Foundation", reason: "same words" });
    expect(by("Permits and fees")).toMatchObject({ targetTitle: "Permits" });
    expect(by("Site work and excavation")).toMatchObject({ targetTitle: "Excavation" });
  });

  /**
   * **THE CLOSEST CONTAINMENT, NOT THE FIRST.** `Electrical Fixtures
   * Material` comes first in his chart and the first cut took it. `Electric`
   * is the phase; the other is a line item inside one.
   */
  it("prefers the shortest thing that contains the title", () => {
    expect(by("Electrical")).toMatchObject({
      targetTitle: "Electric",
      reason: "one contains the other",
    });
  });

  it("reaches across a plural and a gerund", () => {
    expect(by("Landscaping")).toMatchObject({ targetTitle: "Landscape" });
    expect(by("Gutters")).toMatchObject({ targetTitle: "Downspout/Footer/Gutter" });
  });

  /**
   * Two of his steps are two halves of one phase. Both should land on it —
   * they are different questions and both sets belong.
   */
  it("lets two sources point at one target", () => {
    expect(by("Framing labour")?.targetId).toBe("c4");
    expect(by("Framing materials")?.targetId).toBe("c4");
  });

  /**
   * **NO MATCH IS AN ANSWER.** `Heating and cooling` and `HVAC` share
   * nothing a computer can see, and a guess here is worse than a blank the
   * screen asks about.
   */
  it("proposes nothing rather than something wrong", () => {
    expect(by("Heating and cooling")).toMatchObject({ targetId: null, reason: null });
  });

  it("never lets one shared word carry a match", () => {
    const out = proposeMerges(
      [step("s", "Utilities and septic")],
      [step("t", "Windows and Doors (Including Hardware)")],
    );
    expect(out[0].targetId).toBeNull();
  });

  it("leaves out a source step with nothing to give", () => {
    const out = proposeMerges([step("s", "Foundation", 0)], CHART);
    expect(out).toEqual([]);
  });

  it("says nothing about nothing", () => {
    expect(proposeMerges([], CHART)).toEqual([]);
    expect(proposeMerges(HAND, [])).toHaveLength(HAND.length);
    expect(proposeMerges(HAND, []).every((p) => p.targetId === null)).toBe(true);
  });

  /** A title of nothing but stop words must not match every other one. */
  it("does not match two titles that are both meaningless", () => {
    const out = proposeMerges([step("s", "The and")], [step("t", "For the")]);
    expect(out[0].targetId).toBeNull();
  });

  it("carries the source's question count through for the screen to show", () => {
    expect(by("Foundation")?.sourceQuestions).toBe(3);
  });
});

describe("isAlreadyAsked", () => {
  /** Copying twice, or onto itself, must not double a question. */
  it("recognises the same prompt however it is punctuated", () => {
    expect(isAlreadyAsked("Who is doing this one?", ["who is doing this one"])).toBe(true);
    expect(isAlreadyAsked("How wide is the footing?", ["Who is doing this one?"])).toBe(false);
  });

  it("is false against nothing", () => {
    expect(isAlreadyAsked("Any rebar?", [])).toBe(false);
  });
});
