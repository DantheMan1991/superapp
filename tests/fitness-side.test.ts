import { describe, expect, it } from "vitest";
import { assessedSide, ruleWords, sideFor, sideWords, testPoints } from "../src/modules/fitness/core/side";

/**
 * A PERSON'S SIDE (docs/modules/fitness.md, F4b): which side a test's answer
 * points to, the side the tests agree on, and how a one-sided exercise says
 * its side. An invented assessment, as every fitness test uses: five tests,
 * two of them reversed, three to agree.
 */

const tests = [
  { name: "Trunk turn", leftMeans: "left" as const },
  { name: "Arm sweep", leftMeans: "right" as const },
  { name: "Reach up", leftMeans: "left" as const },
  { name: "Hip swing", leftMeans: "left" as const },
  { name: "Knee fall", leftMeans: "right" as const },
];

describe("one test's answer", () => {
  it("points the way the table says: straight for most, reversed for the rest", () => {
    expect(testPoints(tests[0], "left")).toBe("left");
    expect(testPoints(tests[0], "right")).toBe("right");
    expect(testPoints(tests[1], "left")).toBe("right");
    expect(testPoints(tests[1], "right")).toBe("left");
  });

  it("points nowhere when neither side went further", () => {
    expect(testPoints(tests[0], "same")).toBeNull();
    expect(testPoints(tests[1], "same")).toBeNull();
  });
});

describe("the side the tests agree on", () => {
  it("is the side at least the program's number point to, whichever way each test counts", () => {
    // What was seen: left, right, left, left, right. The reversed tests' "right"
    // and the straight tests' "left" all point left: five of five.
    expect(assessedSide(tests, ["left", "right", "left", "left", "right"], 3)).toEqual({
      side: "left",
      left: 5,
      right: 0,
    });
    // The same "left" seen on every test: the two reversed ones point right.
    expect(assessedSide(tests, ["left", "left", "left", "left", "left"], 3)).toEqual({
      side: "left",
      left: 3,
      right: 2,
    });
    // Seen: left (L), right on a reversed test (L), left (L), right (R), left on
    // a reversed test (R). Three left, two right: the program's three is met.
    expect(assessedSide(tests, ["left", "right", "left", "right", "left"], 3)).toEqual({
      side: "left",
      left: 3,
      right: 2,
    });
    expect(assessedSide(tests, ["right", "left", "right", "right", "left"], 3)).toMatchObject({ side: "right" });
  });

  it("is no side when neither gets there: both sides, the program's default", () => {
    expect(assessedSide(tests, ["left", "same", "right", "same", "same"], 3)).toEqual({
      side: null,
      left: 1,
      right: 1,
    });
    // Unanswered tests point nowhere; answers past the tests are ignored.
    expect(assessedSide(tests, ["left", null], 3)).toMatchObject({ side: null, left: 1 });
    expect(assessedSide(tests.slice(0, 1), ["left", "left", "left"], 1)).toEqual({ side: "left", left: 1, right: 0 });
  });
});

describe("a one-sided exercise", () => {
  it("is done on the side the person leans toward, or the other, and on both until the side is known", () => {
    expect(sideFor("toward", "left")).toBe("left");
    expect(sideFor("away", "left")).toBe("right");
    expect(sideFor("away", "right")).toBe("left");
    expect(sideFor("both", "left")).toBeNull();
    expect(sideFor("toward", null)).toBeNull();
  });

  it("says its side the way the exercise is done", () => {
    expect(sideWords("side", "left")).toBe("Left side only");
    expect(sideWords("lying", "right")).toBe("Lying on your right side");
    expect(sideWords("top_leg", "left")).toBe("Left leg on top");
  });

  it("says its rule before anybody's side is known, and nothing for both sides", () => {
    expect(ruleWords("toward", "lying")).toBe("Lying on the side you lean toward");
    expect(ruleWords("away", "lying")).toBe("Lying on the side you lean away from");
    expect(ruleWords("toward", "top_leg")).toBe("The leg on the side you lean toward on top");
    expect(ruleWords("away", "side")).toBe("Only on the side you lean away from");
    expect(ruleWords("both", "lying")).toBeNull();
  });
});
