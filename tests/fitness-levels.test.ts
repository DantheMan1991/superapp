import { describe, expect, it } from "vitest";
import {
  emptyProgression,
  levelOf,
  levelWords,
  madeWords,
  markMade,
  markWords,
  progressionSchema,
  type Progression,
} from "../src/modules/fitness/core/levels";

/**
 * AN EXERCISE THAT GETS HARDER IN STEPS (docs/modules/fitness.md, F4c): the
 * person's level, and when a go at it makes the mark for moving up. An
 * invented ladder, as every fitness test uses.
 */

const ladder: Progression = {
  levels: [
    { name: "Step 1", startS: 10, endS: 40 },
    { name: "Step 2", startS: 41, endS: 80 },
    { name: "Step 3", startS: null, endS: null },
  ],
  sets: 2,
  target: 12,
};

const set = (side: "left" | "right" | null, count: number) => ({ side, count });

describe("a ladder of levels", () => {
  it("takes two to twenty named levels and a mark, and starts a new one from the exercise's own top", () => {
    expect(progressionSchema.safeParse(ladder).success).toBe(true);
    expect(progressionSchema.safeParse({ ...ladder, levels: ladder.levels.slice(0, 1) }).success).toBe(false);
    expect(progressionSchema.safeParse({ ...ladder, sets: 0 }).success).toBe(false);
    expect(progressionSchema.safeParse({ ...ladder, levels: [{ name: " ", startS: null, endS: null }, ladder.levels[1]] }).success).toBe(false);
    expect(emptyProgression({ setsMin: 2, targetMin: 6, targetMax: 15 })).toEqual({
      levels: [
        { name: "Level 1", startS: null, endS: null },
        { name: "Level 2", startS: null, endS: null },
      ],
      sets: 2,
      target: 15,
    });
    expect(emptyProgression({ setsMin: 1, targetMin: 8, targetMax: null }).target).toBe(8);
  });

  it("puts the person on their saved level, the first until one is saved, never past the last", () => {
    expect(levelOf(null, "item", 3)).toBe(0);
    expect(levelOf({ other: 2 }, "item", 3)).toBe(0);
    expect(levelOf({ item: 1 }, "item", 3)).toBe(1);
    // A level the program no longer has (a level removed in the editor): its last.
    expect(levelOf({ item: 7 }, "item", 3)).toBe(2);
    expect(levelOf({ item: -1 }, "item", 3)).toBe(0);
    expect(levelOf({ item: 1.5 }, "item", 3)).toBe(0);
  });

  it("says the level, the mark and a mark made", () => {
    expect(levelWords(ladder, 1)).toBe("Step 2 of 3");
    expect(markWords(ladder, "reps", true)).toBe("2 sets of 12 reps, each side");
    expect(markWords({ sets: 1, target: 30 }, "seconds", false)).toBe("1 set of 30 seconds");
    expect(madeWords(ladder, "Step 1", 3)).toBe("2 × 12 at Step 1, effort 3, nothing hurt.");
    expect(madeWords(ladder, "Step 1", null)).toBe("2 × 12 at Step 1, nothing hurt.");
  });
});

describe("the mark for moving up", () => {
  const good = { perSide: true, effort: 4, hurt: "none" as const };

  it("is made by the mark's sets at the target on both sides, effort at most the program's, nothing hurt", () => {
    const sets = [set("right", 12), set("left", 13), set("right", 12), set("left", 12)];
    expect(markMade(ladder, { ...good, sets }, 5)).toBe(true);
    // One side short on a set: one full set, not two.
    expect(markMade(ladder, { ...good, sets: [set("right", 12), set("left", 11), set("right", 12), set("left", 12)] }, 5)).toBe(false);
    // A third set makes up for a short one.
    expect(
      markMade(ladder, { ...good, sets: [set("right", 12), set("left", 11), set("right", 12), set("left", 12), set("right", 12), set("left", 12)] }, 5),
    ).toBe(true);
    expect(markMade(ladder, { ...good, sets: sets.slice(0, 2) }, 5)).toBe(false);
  });

  it("counts an exercise done on both sides at once, or on one side only, set by set", () => {
    expect(markMade(ladder, { ...good, perSide: false, sets: [set(null, 12), set(null, 15)] }, 5)).toBe(true);
    expect(markMade(ladder, { ...good, perSide: false, sets: [set("left", 12), set("left", 12)] }, 5)).toBe(true);
  });

  it("is not made when it took too much, something hurt, or either answer was left out", () => {
    const sets = [set("right", 12), set("left", 12), set("right", 12), set("left", 12)];
    expect(markMade(ladder, { ...good, sets, effort: 6 }, 5)).toBe(false);
    expect(markMade(ladder, { ...good, sets, effort: null }, 5)).toBe(false);
    expect(markMade(ladder, { ...good, sets, hurt: "pinch" }, 5)).toBe(false);
    expect(markMade(ladder, { ...good, sets, hurt: null }, 5)).toBe(false);
    // A program with no effort of its own asks only the sets and the hurt.
    expect(markMade(ladder, { ...good, sets, effort: null }, null)).toBe(true);
  });
});
