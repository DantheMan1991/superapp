/**
 * A PERSON'S SIDE (docs/modules/fitness.md, F4b; approved from a mockup,
 * 2026-09-28).
 *
 * Some programs do a few exercises on one side only, for a person who leans
 * ("is lateralized") to one side, and give a short self-assessment to find
 * which. The founder's has a handful of tests, each comparing how far the left
 * side goes with how far the right does, a table saying which side each result
 * points to, and a number of them that must agree. His calls: the person
 * answers each test with what they saw ("which side went further?") and the
 * app applies the table, so the reversed tests need no thought; and the tests
 * are read from his PDF, the table's picture included.
 *
 * Until the side is known, and for anybody who never takes the assessment,
 * every exercise does both sides: the program's own default.
 *
 * Pure: the program page, the editor, the assessment and workout mode all
 * speak through it.
 */

import type { SideMeans, SideRule } from "./program";

export type Lean = "left" | "right";
/** What the person saw in one test: which side went further, or neither. */
export type Further = "left" | "right" | "same";

function other(side: Lean): Lean {
  return side === "left" ? "right" : "left";
}

/** Which side one test's answer points to: its table row applied, or null for "same". */
export function testPoints(test: { leftMeans: Lean }, further: Further): Lean | null {
  if (further === "same") return null;
  return further === "left" ? test.leftMeans : other(test.leftMeans);
}

/**
 * The side the tests agree on: the one at least `least` of them point to, or
 * null when neither side gets there. Answers past the tests are ignored; a
 * test left unanswered points nowhere.
 */
export function assessedSide(
  tests: readonly { leftMeans: Lean }[],
  answers: readonly (Further | null)[],
  least: number,
): { side: Lean | null; left: number; right: number } {
  let left = 0;
  let right = 0;
  tests.forEach((test, i) => {
    const answer = answers[i];
    if (!answer) return;
    const points = testPoints(test, answer);
    if (points === "left") left += 1;
    else if (points === "right") right += 1;
  });
  const side = left >= least && left > right ? "left" : right >= least && right > left ? "right" : null;
  return { side, left, right };
}

/** The side an exercise is done on: its rule applied to the person's lean, or null for both sides. */
export function sideFor(rule: SideRule, lean: Lean | null): Lean | null {
  if (rule === "both" || lean === null) return null;
  return rule === "toward" ? lean : other(lean);
}

function capital(side: Lean): string {
  return side === "left" ? "Left" : "Right";
}

/** The side as the screen says it: "Left side only", "Lying on your left side", "Left leg on top". */
export function sideWords(means: SideMeans, side: Lean): string {
  switch (means) {
    case "lying":
      return `Lying on your ${side} side`;
    case "top_leg":
      return `${capital(side)} leg on top`;
    default:
      return `${capital(side)} side only`;
  }
}

/**
 * A rule in words, for the program page and the editor, before anybody's side
 * is known: "Lying on the side you lean toward". Null for both sides.
 */
export function ruleWords(rule: SideRule, means: SideMeans): string | null {
  if (rule === "both") return null;
  const which = rule === "toward" ? "the side you lean toward" : "the side you lean away from";
  switch (means) {
    case "lying":
      return `Lying on ${which}`;
    case "top_leg":
      return `The leg on ${which} on top`;
    default:
      return `Only on ${which}`;
  }
}
