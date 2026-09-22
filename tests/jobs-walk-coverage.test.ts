import { describe, expect, it } from "vitest";
import {
  coverageLines,
  coverageOf,
  coverageReason,
  coveredPhases,
  questionsToSettle,
  type EstimateLineFacts,
} from "../src/packs/jobs/walk-coverage";
import { reckonStep } from "../src/packs/jobs/walk-reckoning";
import type { WalkAnswer, WalkQuestion, WalkStep } from "../src/packs/jobs/walk-math";

/**
 * A PHASE THE ESTIMATE ALREADY HAS (X17, ADR 0108).
 *
 * The takeoff off the model puts drywall on the estimate before the walk
 * starts. These are the rules that let the walk see it: which lines are a
 * phase's, what the gate says about them, what a settled question carries,
 * and how the reckoning counts a phase the walk never priced itself.
 */

function question(id: string, prompt: string, alwaysAsk = false): WalkQuestion {
  return { id, prompt, kind: "text", choices: [], unit: "", notes: "", alwaysAsk, standardAnswer: "" };
}

function step(id: string, title: string, costCode: string, assemblyId: string | null, questions: WalkQuestion[]): WalkStep {
  return { id, title, section: "", costCode, guidance: "", assemblyId, questions };
}

const DRYWALL = step("s-drywall", "Drywall", "09 25 00", "asm-drywall", [
  question("q-who", "Who is doing this one?"),
  question("q-asbestos", "Is there asbestos?", true),
]);
const ROOFING = step("s-roofing", "Roofing", "07 30 00", null, [question("q-roof", "Who is doing this one?")]);
const PAINT = step("s-paint", "Painting", "", null, [question("q-paint", "Who is doing this one?")]);

const NAMES = new Map([["asm-drywall", "Drywall, hang and finish"]]);

const line = (over: Partial<EstimateLineFacts> & { id: string }): EstimateLineFacts => ({
  costCode: "",
  groupName: "",
  description: "",
  costCents: 0,
  basis: "",
  basisDetail: "",
  ...over,
});

const LINES: EstimateLineFacts[] = [
  /** In the drywall assembly's item, off the model. */
  line({ id: "l1", groupName: "Drywall, hang and finish", description: "Sheets", costCents: 139_050, basis: "assembly", basisDetail: "Drywall, hang and finish at 3,708 sf · off the model: Wall Schedule" }),
  line({ id: "l2", groupName: "Drywall, hang and finish", description: "Hang, tape and finish", costCents: 556_200, basis: "assembly", basisDetail: "Drywall, hang and finish at 3,708 sf · off the model: Wall Schedule" }),
  /** On the roofing code, typed by hand — the code is written with different spacing. */
  line({ id: "l3", costCode: "073000", description: "Shingles", costCents: 410_000 }),
  /** A loose line nothing claims. */
  line({ id: "l4", description: "Dumpster", costCents: 60_000 }),
  /** On the drywall code but nothing could price it. */
  line({ id: "l5", costCode: "09 25 00", groupName: "", description: "Basic Wall: Interior", costCents: 0, basis: "none", basisDetail: "off the model: Wall Schedule · Basic Wall: Interior · Area 3,708 sf" }),
];

describe("coverageOf", () => {
  it("claims a line on the phase's code or in the item its assembly makes, and nothing else", () => {
    const drywall = coverageOf(DRYWALL, LINES, NAMES)!;
    expect(drywall.lines.map((l) => l.id)).toEqual(["l1", "l2", "l5"]);
    expect(drywall.costCents).toBe(695_250);
    expect(drywall.unpriced).toBe(1);
    expect(drywall.from).toBe("off the model");

    const roofing = coverageOf(ROOFING, LINES, NAMES)!;
    expect(roofing.lines.map((l) => l.id)).toEqual(["l3"]);
    expect(roofing.from).toBe("");

    /** No code and no pin: the phase claims nothing, whatever is on the estimate. */
    expect(coverageOf(PAINT, LINES, NAMES)).toBeNull();
    /** A pin whose assembly is unknown to the library claims nothing by name. */
    expect(coverageOf({ ...DRYWALL, costCode: "" }, LINES, new Map())).toBeNull();
  });

  it("says how much of it came off the model", () => {
    const mixed = coverageOf(DRYWALL, [LINES[0], line({ id: "l6", costCode: "092500", costCents: 100 })], NAMES)!;
    expect(mixed.from).toBe("1 of 2 off the model");
  });

  it("lists the covered phases in outline order", () => {
    expect(coveredPhases([ROOFING, DRYWALL, PAINT], LINES, NAMES).map((c) => c.title)).toEqual(["Roofing", "Drywall"]);
    expect(coveredPhases([ROOFING, DRYWALL, PAINT], [], NAMES)).toEqual([]);
  });
});

describe("what the gate and the transcript say", () => {
  const covered = coveredPhases([DRYWALL, ROOFING], LINES, NAMES);

  it("puts the money, the line count and the source on one line a phase", () => {
    expect(coverageLines(covered, "$")).toEqual([
      "- Drywall — $6,952.50 in 3 lines, off the model",
      "- Roofing — $4,100.00 in 1 line",
    ]);
    expect(coverageReason(covered[0], "$")).toBe("already on the estimate — $6,952.50 in 3 lines, off the model");
  });

  it("says no prices yet when nothing on the phase is priced", () => {
    const only = coverageOf(DRYWALL, [LINES[4]], NAMES)!;
    expect(coverageLines([only], "$")).toEqual(["- Drywall — no prices yet in 1 line, off the model"]);
  });
});

describe("questionsToSettle", () => {
  it("settles every outstanding question but a must-ask", () => {
    expect(questionsToSettle(DRYWALL, []).map((q) => q.id)).toEqual(["q-who"]);
    const answered: WalkAnswer[] = [
      { questionId: "q-who", stepId: "s-drywall", prompt: "Who is doing this one?", answer: "Sub", skipped: false, skipReason: "", superseded: false, fromStandard: false },
    ];
    expect(questionsToSettle(DRYWALL, answered)).toEqual([]);
  });
});

describe("reckonStep with lines the estimate already has", () => {
  it("counts the phase as priced at what is on the estimate, and says where it came from", () => {
    const r = reckonStep(DRYWALL, [], {
      appliedLines: 0,
      appliedCents: 0,
      zeroLines: 0,
      bid: null,
      onEstimateLines: 2,
      onEstimateCents: 695_250,
      onEstimateZero: 0,
      onEstimateFrom: "off the model",
    });
    expect([r.standing, r.amountCents, r.detail, r.blocking]).toEqual([
      "priced",
      695_250,
      "2 lines already on the estimate, off the model",
      false,
    ]);
  });

  it("is a hole when every one of those lines is unpriced", () => {
    const r = reckonStep(DRYWALL, [], {
      appliedLines: 0,
      appliedCents: 0,
      zeroLines: 0,
      bid: null,
      onEstimateLines: 1,
      onEstimateCents: 0,
      onEstimateZero: 1,
      onEstimateFrom: "off the model",
    });
    expect([r.standing, r.detail, r.blocking]).toEqual(["unpriced", "1 line on the estimate, no prices, off the model", true]);
  });

  it("lets the walk's own lines speak first", () => {
    const r = reckonStep(DRYWALL, [], {
      appliedLines: 1,
      appliedCents: 100,
      zeroLines: 0,
      bid: null,
      onEstimateLines: 2,
      onEstimateCents: 695_250,
    });
    expect([r.standing, r.amountCents, r.detail]).toEqual(["priced", 100, ""]);
  });
});
