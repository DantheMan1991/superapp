import { describe, expect, it } from "vitest";
import {
  NO_FACTS,
  reckonStep,
  reckonWalk,
  walkIsCovered,
  type StepFacts,
} from "../src/packs/jobs/walk-reckoning";
import type { WalkAnswer, WalkQuestion, WalkStep } from "../src/packs/jobs/walk-math";

/**
 * WHAT THE WHOLE BID COMES TO, AND WHAT IS STOPPING IT (X4, ADR 0098).
 *
 * The rule the rest of this file exists to protect: **a phase out for bid
 * contributes nothing to the total.** Everything else is bookkeeping.
 */

function q(over: Partial<WalkQuestion> & { id: string }): WalkQuestion {
  return {
    prompt: "Who is doing this one?",
    kind: "choice",
    choices: ["In-house", "Bidding it out", "By others", "Not on this job"],
    unit: "",
    notes: "",
    alwaysAsk: false,
    ...over,
  };
}

function step(over: Partial<WalkStep> & { id: string }): WalkStep {
  return {
    title: "Electrical",
    section: "",
    costCode: "5200",
    guidance: "",
    assemblyId: null,
    questions: [q({ id: `${over.id}-who` })],
    ...over,
  };
}

function said(stepId: string, questionId: string | null, answer: string): WalkAnswer {
  return {
    questionId,
    stepId,
    prompt: "?",
    answer,
    skipped: false,
    skipReason: "",
    superseded: false,
  };
}

function skipped(stepId: string, questionId: string): WalkAnswer {
  return {
    questionId,
    stepId,
    prompt: "?",
    answer: "",
    skipped: true,
    skipReason: "later",
    superseded: false,
  };
}

/** The same answer, asked again and therefore no longer standing. */
function stale(a: WalkAnswer): WalkAnswer {
  return { ...a, superseded: true };
}

const PRICED: StepFacts = {
  appliedLines: 2,
  appliedCents: 18_400_00,
  zeroLines: 0,
  bid: null,
};

function bid(over: Partial<NonNullable<StepFacts["bid"]>> = {}): StepFacts {
  return {
    appliedLines: 0,
    appliedCents: 0,
    zeroLines: 0,
    bid: {
      asked: 3,
      back: 1,
      awarded: false,
      lowestCents: 18_400_00,
      highestCents: 18_400_00,
      ...over,
    },
  };
}

describe("one phase", () => {
  it("is priced when lines from it reached the estimate", () => {
    const s = step({ id: "a" });
    const out = reckonStep(s, [said("a", "a-who", "In-house")], PRICED);
    expect(out.standing).toBe("priced");
    expect(out.amountCents).toBe(18_400_00);
    expect(out.blocking).toBe(false);
  });

  /**
   * **A LINE AT ZERO IS NOT A PRICE**, and this is the case that found it: the
   * dev tenant's own first walk put three lines of `Cast-in-place concrete` on
   * an estimate, every one of them `basis: none` at nothing, and the first
   * draft of this file called the phase priced and coloured it green.
   */
  it("refuses to call a phase priced when its lines carry no money", () => {
    const s = step({ id: "a" });
    const allZero: StepFacts = {
      appliedLines: 3,
      appliedCents: 0,
      zeroLines: 3,
      bid: null,
    };
    const out = reckonStep(s, [said("a", "a-who", "In-house")], allZero);
    expect(out.standing).toBe("unpriced");
    expect(out.detail).toBe("3 lines on the estimate, no prices");
    expect(out.blocking).toBe(true);
  });

  /**
   * **A ZERO SOMEBODY MEANT IS NOT A HOLE.** The founder's price sheet is full
   * of them and they are the exclusions. `zeroLines` counts only what the WALK
   * could not price, so a phase deliberately carried at nothing is priced and
   * blocks nothing — see `walk-reckoning-ops.ts` for where that is decided.
   */
  it("is priced when a phase was deliberately carried at nothing", () => {
    const meant: StepFacts = {
      appliedLines: 2,
      appliedCents: 0,
      zeroLines: 0,
      bid: null,
    };
    const out = reckonStep(step({ id: "a" }), [said("a", "a-who", "By others")], meant);
    expect(out.standing).toBe("priced");
    expect(out.blocking).toBe(false);
    expect(out.amountCents).toBe(0);
  });

  it("flags the one line in a phase that never got a number", () => {
    const s = step({ id: "a" });
    const partly: StepFacts = {
      appliedLines: 3,
      appliedCents: 9_000_00,
      zeroLines: 1,
      bid: null,
    };
    const out = reckonStep(s, [said("a", "a-who", "In-house")], partly);
    expect(out.standing).toBe("unpriced");
    expect(out.detail).toBe("1 of 3 lines have no price");
    /** What IS priced still shows, so the figure is not lost. */
    expect(out.amountCents).toBe(9_000_00);
  });

  it("is out for bid while subcontractors have it and nobody is chosen", () => {
    const s = step({ id: "a" });
    const out = reckonStep(s, [said("a", "a-who", "Bidding it out")], bid());
    expect(out.standing).toBe("out_for_bid");
    expect(out.detail).toBe("3 asked · 1 back");
    expect(out.blocking).toBe(true);
    /** THE RULE. A price nobody has chosen is not a number yet. */
    expect(out.amountCents).toBe(0);
  });

  /**
   * The most easily missed hole in the whole tool: the asking is done, the
   * decision is made, and the number is still not on the estimate.
   */
  it("flags a bid chosen and never put on", () => {
    const out = reckonStep(step({ id: "a" }), [], bid({ awarded: true, back: 3 }));
    expect(out.standing).toBe("unpriced");
    expect(out.detail).toBe("a bid chosen, not on the estimate yet");
    expect(out.blocking).toBe(true);
    expect(out.amountCents).toBe(0);
  });

  it("is by others when somebody else's contract pays, and blocks nothing", () => {
    for (const answer of ["By others", "Not on this job", "by others."]) {
      const out = reckonStep(step({ id: "a" }), [said("a", "a-who", answer)], NO_FACTS);
      expect(out.standing, answer).toBe("by_others");
      expect(out.blocking, answer).toBe(false);
      expect(out.detail, answer).toBe("in the exclusions");
    }
  });

  it("is open while it still has questions, and says how many must be asked", () => {
    const s = step({
      id: "a",
      questions: [q({ id: "a-who" }), q({ id: "a-rock", alwaysAsk: true }), q({ id: "a-lf" })],
    });
    const out = reckonStep(s, [said("a", "a-who", "In-house")], NO_FACTS);
    expect(out.standing).toBe("open");
    expect(out.detail).toBe("2 still to ask, 1 of them always");
    expect(out.blocking).toBe(true);
  });

  it("is unpriced when every question is settled and nothing came of it", () => {
    const out = reckonStep(step({ id: "a" }), [said("a", "a-who", "In-house")], NO_FACTS);
    expect(out.standing).toBe("unpriced");
    expect(out.detail).toBe("answered, nothing priced");
    expect(out.blocking).toBe(true);
  });

  it("names the case where they meant to bid it out and nobody was asked", () => {
    const out = reckonStep(step({ id: "a" }), [said("a", "a-who", "Bidding it out")], NO_FACTS);
    expect(out.standing).toBe("unpriced");
    expect(out.detail).toBe("bidding it out, nobody asked");
  });

  it("names an allowance nobody put a figure to, skipped or waffled", () => {
    const s = step({
      id: "a",
      title: "Cabinets and countertops",
      questions: [q({ id: "a-who" }), q({ id: "a-allow", kind: "money", choices: [] })],
    });
    const settled = [said("a", "a-who", "In-house")];
    expect(
      reckonStep(s, [...settled, skipped("a", "a-allow")], NO_FACTS).detail,
    ).toBe("allowance never set");
    expect(
      reckonStep(s, [...settled, said("a", "a-allow", "we will price it later")], NO_FACTS)
        .detail,
    ).toBe("allowance never set");
    /** A real figure is a real answer. */
    expect(
      reckonStep(s, [...settled, said("a", "a-allow", "$24,000")], NO_FACTS).detail,
    ).toBe("answered, nothing priced");
  });

  it("says nothing about a step that asks nothing", () => {
    const out = reckonStep(step({ id: "a", questions: [] }), [], NO_FACTS);
    expect(out.standing).toBe("nothing_asked");
    expect(out.blocking).toBe(false);
  });

  /**
   * **FACTS BEAT INTENTIONS.** Lines really on the estimate beat a bid that
   * went out, which beats what somebody said they were going to do.
   */
  it("prefers what happened to what was said", () => {
    const s = step({ id: "a" });
    const byOthers = [said("a", "a-who", "By others")];
    expect(reckonStep(s, byOthers, PRICED).standing).toBe("priced");
    expect(reckonStep(s, byOthers, bid()).standing).toBe("out_for_bid");
    expect(reckonStep(s, byOthers, NO_FACTS).standing).toBe("by_others");
  });

  /**
   * **A MISREADING CAN ONLY MAKE THIS MORE CAUTIOUS.** Reword the starter's
   * choices and the classification is lost — what comes back is `unpriced`,
   * which blocks. Never the other way round.
   */
  it("falls back to a blocking standing when the words are not the starter's", () => {
    const out = reckonStep(
      step({ id: "a" }),
      [said("a", "a-who", "the homeowner's own guy is doing it")],
      NO_FACTS,
    );
    expect(out.standing).toBe("unpriced");
    expect(out.blocking).toBe(true);
  });

  /**
   * **ASKING AGAIN RE-OPENS THE PHASE.** A superseded answer stops counting
   * everywhere, which is the whole mechanism behind going back to a step: no
   * flag saying "somebody is revisiting", just a row that no longer stands.
   */
  it("goes back to open when the answer that settled it was superseded", () => {
    const s = step({ id: "a" });
    const original = said("a", "a-who", "By others");
    expect(reckonStep(s, [original], NO_FACTS).standing).toBe("by_others");
    expect(reckonStep(s, [stale(original)], NO_FACTS).standing).toBe("open");
  });

  it("reads the answer that stands, not the one that was replaced", () => {
    const s = step({
      id: "a",
      questions: [q({ id: "a-who" }), q({ id: "a-allow", kind: "money", choices: [] })],
    });
    const settled = [said("a", "a-who", "In-house")];
    /** Blank first, a figure on the second ask: the figure is what counts. */
    const out = reckonStep(
      s,
      [...settled, stale(skipped("a", "a-allow")), said("a", "a-allow", "$24,000")],
      NO_FACTS,
    );
    expect(out.detail).toBe("answered, nothing priced");
  });

  it("reads only its own step's answers", () => {
    const out = reckonStep(
      step({ id: "a" }),
      [said("b", "b-who", "By others"), said("a", "a-who", "In-house")],
      NO_FACTS,
    );
    expect(out.standing).toBe("unpriced");
  });
});

describe("the whole bid", () => {
  const steps = [
    step({ id: "1", title: "Foundation", costCode: "2000" }),
    step({ id: "2", title: "Electrical", costCode: "5200" }),
    step({ id: "3", title: "Gutters", costCode: "4300" }),
    step({ id: "4", title: "Masonry", costCode: "4200" }),
    step({ id: "5", title: "Roofing", costCode: "4000" }),
  ];
  const answers = [
    said("1", "1-who", "In-house"),
    said("2", "2-who", "Bidding it out"),
    said("3", "3-who", "By others"),
    said("4", "4-who", "In-house"),
  ];
  const facts = new Map<string, StepFacts>([
    ["1", PRICED],
    ["2", bid()],
    ["5", bid({ asked: 2, back: 2 })],
  ]);

  it("counts every standing and totals only what is on the estimate", () => {
    const out = reckonWalk(steps, answers, facts);
    expect(out.priced).toBe(1);
    expect(out.outForBid).toBe(2);
    expect(out.byOthers).toBe(1);
    expect(out.unpriced).toBe(1);
    expect(out.open).toBe(0);
    /** One priced phase, and not a cent of the two out for bid. */
    expect(out.pricedCents).toBe(18_400_00);
    expect(out.ready).toBe(false);
  });

  it("puts the holes before what is merely waiting, outline order within each", () => {
    const out = reckonWalk(steps, answers, facts);
    expect(out.blocking.map((b) => b.title)).toEqual([
      "Masonry",
      "Electrical",
      "Roofing",
    ]);
  });

  it("is ready only when nothing at all is in the way", () => {
    const priced = new Map(steps.map((s) => [s.id, PRICED]));
    const out = reckonWalk(steps, answers, priced);
    expect(out.blocking).toEqual([]);
    expect(out.ready).toBe(true);
    expect(out.pricedCents).toBe(18_400_00 * 5);
  });

  it("is not ready just because a phase is excluded", () => {
    const out = reckonWalk([steps[2]], [said("3", "3-who", "By others")], new Map());
    expect(out.ready).toBe(true);
    expect(out.byOthers).toBe(1);
    expect(out.pricedCents).toBe(0);
  });

  it("says nothing is ready about an outline with no steps", () => {
    const out = reckonWalk([], [], new Map());
    expect(out.ready).toBe(true);
    expect(out.steps).toEqual([]);
    expect(out.pricedCents).toBe(0);
  });
});

/**
 * **COVERED IS NOT READY**, and keeping them apart is the point of the slice.
 * A walk can be out of questions while the bid is still full of holes — which
 * is the exact state that used to say "that is the whole walk" and nothing
 * else.
 */
describe("walkIsCovered", () => {
  const steps = [step({ id: "1" }), step({ id: "2" })];

  it("is true once every question is settled, holes and all", () => {
    const answers = [said("1", "1-who", "In-house"), said("2", "2-who", "In-house")];
    expect(walkIsCovered(steps, answers)).toBe(true);
    expect(reckonWalk(steps, answers, new Map()).ready).toBe(false);
  });

  it("is false while anything is outstanding", () => {
    expect(walkIsCovered(steps, [said("1", "1-who", "In-house")])).toBe(false);
  });
});
