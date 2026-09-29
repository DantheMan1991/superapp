import { describe, expect, it } from "vitest";
import {
  ADDITIONS_SYSTEM,
  buildAdditionsPrompt,
  mergeAdditions,
  READ_AGAIN_WORDS,
  recordAdditionsTool,
  RECORD_ADDITIONS_TOOL,
} from "../src/modules/fitness/core/read-again";
import { FitnessError, fitnessMessage } from "../src/modules/fitness/core/errors";
import { emptyItem, type ProgramInput } from "../src/modules/fitness/core/program";

/**
 * A PROGRAM READ AGAIN (docs/modules/fitness.md, F4b): what Claude records
 * about the self-assessment and the one-sided exercises, merged into the
 * program the person already follows. An invented program, as every fitness
 * test uses.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function program(): ProgramInput {
  const item = (n: number, name: string, perSide: boolean) => ({
    ...emptyItem(),
    itemId: id(n),
    exerciseId: id(100 + n),
    name,
    perSide,
  });
  return {
    name: "Starter Mobility",
    author: "A. Coach",
    notes: "",
    sessionsPerWeekMin: 3,
    sessionsPerWeekMax: 4,
    effortMin: null,
    effortMax: null,
    breathOutS: null,
    breathInS: null,
    assessment: null,
    phases: [
      { phaseId: id(1000), name: "Weeks 1–2", minDoneDays: 14, notes: "", items: [item(1, "Hip lift", false)] },
      {
        phaseId: id(1001),
        name: "Weeks 3–4",
        minDoneDays: 14,
        notes: "",
        items: [item(2, "Knee sway", true), item(3, "Wall stack", false), item(4, "Side reach", true)],
      },
      { phaseId: id(1002), name: "Weeks 5–6", minDoneDays: 14, notes: "", items: [item(5, "Side reach", true)] },
    ],
  };
}

const answer = {
  assessment: {
    videoUrl: "https://www.youtube.com/watch?v=fBViIToMhKA",
    least: 2,
    tests: [
      { name: "Trunk turn", question: "Which side went further?", leftMeans: "left" },
      { name: "Arm sweep", question: "", leftMeans: "right" },
      // No direction: dropped, never guessed.
      { name: "Reach up", question: "Which side went further?", leftMeans: null },
    ],
    notes: "Do the one-sided exercises on the side the tests point to.",
  },
  sideRules: [
    { phase: "weeks 3–4", exercise: "  knee SWAY ", sideRule: "toward", sideMeans: "lying" },
    // Named twice in the program: only its phase can say which.
    { phase: "Weeks 5–6", exercise: "Side reach", sideRule: "away", sideMeans: "top_leg" },
    // Not per side: takes no rule.
    { phase: "Weeks 3–4", exercise: "Wall stack", sideRule: "toward", sideMeans: "side" },
    // Not in the program at all.
    { phase: "Weeks 7–8", exercise: "Heel slide", sideRule: "toward", sideMeans: "side" },
    // Both sides is no rule to record.
    { phase: "Weeks 1–2", exercise: "Hip lift", sideRule: "both", sideMeans: "side" },
  ],
};

describe("merging what was read into the program", () => {
  it("puts each rule on the exercise it names, by phase and name, case and spacing aside", () => {
    const { program: merged, found } = mergeAdditions(program(), answer);
    const [p1, p2, p3] = merged.phases;
    expect(p2.items[0]).toMatchObject({ name: "Knee sway", sideRule: "toward", sideMeans: "lying" });
    // The phase decides between two exercises of the same name.
    expect(p3.items[0]).toMatchObject({ sideRule: "away", sideMeans: "top_leg" });
    expect(p2.items[2]).toMatchObject({ name: "Side reach", sideRule: "both" });
    // Not per side, and both sides: untouched.
    expect(p2.items[1]).toMatchObject({ name: "Wall stack", sideRule: "both" });
    expect(p1.items[0]).toMatchObject({ sideRule: "both" });
    expect(found).toEqual({ tests: 2, sideRules: 2, unmatched: ["Wall stack", "Heel slide"] });
    // Every id kept: the save updates the same rows, and the workouts stay.
    expect(merged.phases.flatMap((phase) => phase.items.map((item) => item.itemId))).toEqual([
      id(1),
      id(2),
      id(3),
      id(4),
      id(5),
    ]);
  });

  it("matches by the exercise's name alone when only one exercise has it", () => {
    const { program: merged, found } = mergeAdditions(program(), {
      assessment: null,
      sideRules: [{ phase: "Phase two", exercise: "Knee sway", sideRule: "away", sideMeans: "side" }],
    });
    expect(merged.phases[1].items[0]).toMatchObject({ sideRule: "away", sideMeans: "side" });
    expect(found.unmatched).toEqual([]);
    // A name two exercises share, under a phase that does not exist: nobody's.
    const twice = mergeAdditions(program(), {
      assessment: null,
      sideRules: [{ phase: "Phase nine", exercise: "Side reach", sideRule: "toward", sideMeans: "side" }],
    });
    expect(twice.found).toEqual({ tests: 0, sideRules: 0, unmatched: ["Side reach"] });
  });

  it("matches a name answered with the prompt's per-side note on it, which the founder's read did", () => {
    // Every one-sided exercise of his program came back as "Name (per side)"
    // and matched nothing, the prompt's own note copied into the name.
    const { program: merged, found } = mergeAdditions(program(), {
      assessment: null,
      sideRules: [
        { phase: "Weeks 3–4", exercise: "Knee sway (per side)", sideRule: "toward", sideMeans: "lying" },
        { phase: "Weeks 5–6", exercise: "Side reach [per side]", sideRule: "away", sideMeans: "top_leg" },
        { phase: "Weeks 7–8", exercise: "Heel slide (Per Side) ", sideRule: "away", sideMeans: "side" },
      ],
    });
    expect(merged.phases[1].items[0]).toMatchObject({ name: "Knee sway", sideRule: "toward", sideMeans: "lying" });
    expect(merged.phases[2].items[0]).toMatchObject({ name: "Side reach", sideRule: "away", sideMeans: "top_leg" });
    // What is reported is the name, not the note.
    expect(found).toEqual({ tests: 0, sideRules: 2, unmatched: ["Heel slide"] });
    // A bracket inside a name is part of it.
    const named = program();
    named.phases[1].items[0] = { ...named.phases[1].items[0], name: "Knee sway (band)" };
    const kept = mergeAdditions(named, {
      assessment: null,
      sideRules: [{ phase: "Weeks 3–4", exercise: "Knee sway", sideRule: "toward", sideMeans: "side" }],
    });
    expect(kept.found.unmatched).toEqual(["Knee sway"]);
  });

  it("takes the self-assessment read, a test without a direction dropped, and its video", () => {
    const { program: merged } = mergeAdditions(program(), answer);
    expect(merged.assessment).toEqual({
      video: { id: "fBViIToMhKA", startS: null, endS: null, label: null, embeddable: null },
      least: 2,
      tests: [
        { name: "Trunk turn", question: "Which side went further?", leftMeans: "left" },
        { name: "Arm sweep", question: "Which side went further?", leftMeans: "right" },
      ],
      notes: "Do the one-sided exercises on the side the tests point to.",
    });
  });

  it("keeps the program's own self-assessment when none is read, and survives an answer that is not one", () => {
    const withOne = mergeAdditions(program(), answer).program;
    const again = mergeAdditions(withOne, { assessment: null, sideRules: [] });
    expect(again.program.assessment).toEqual(withOne.assessment);
    expect(again.found).toEqual({ tests: 0, sideRules: 0, unmatched: [] });
    expect(mergeAdditions(program(), null).found).toEqual({ tests: 0, sideRules: 0, unmatched: [] });
    expect(mergeAdditions(program(), "nonsense").program.phases).toHaveLength(3);
  });
});

describe("when it fails", () => {
  it("says nothing was changed, and never gives the import's advice to build the program by hand", () => {
    for (const words of Object.values(READ_AGAIN_WORDS)) {
      expect(words).toContain("Nothing was changed.");
      expect(words).not.toMatch(/by hand|import/i);
    }
    // The words ride on the error, whose code the action and the tests still read.
    expect(fitnessMessage(new FitnessError("NO_TEXT", READ_AGAIN_WORDS.NO_TEXT))).toBe(READ_AGAIN_WORDS.NO_TEXT);
    expect(fitnessMessage(new FitnessError("TOO_LONG", READ_AGAIN_WORDS.TOO_LONG))).toBe(READ_AGAIN_WORDS.TOO_LONG);
    // The import keeps its own.
    expect(fitnessMessage(new FitnessError("NO_TEXT"))).toContain("Build the program by hand instead.");
  });
});

describe("asking for it", () => {
  it("lists the program as the app has it, so the answer names its exercises", () => {
    const prompt = buildAdditionsPrompt(
      { fileName: "starter.pdf", pageCount: 2, pages: [{ n: 1, text: "Tests", links: [] }], pictures: [{ n: 1, jpeg: "AAAA" }] },
      program(),
    );
    expect(prompt).toContain("Weeks 3–4:\n- Knee sway [per side]\n- Wall stack\n- Side reach [per side]");
    expect(ADDITIONS_SYSTEM).toContain("leaving out the [per side] note");
    expect(prompt).toContain('<page number="1">');
    expect(prompt).toContain("Pictures of page 1 follow");
    expect(prompt).toContain(RECORD_ADDITIONS_TOOL);
  });

  it("asks for the assessment and every rule, each field required", () => {
    expect(recordAdditionsTool.input_schema.required).toEqual(["assessment", "sideRules"]);
    const rule = recordAdditionsTool.input_schema.properties.sideRules.items;
    expect(rule.required).toEqual(["phase", "exercise", "sideRule", "sideMeans"]);
  });
});
