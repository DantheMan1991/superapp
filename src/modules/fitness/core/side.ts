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
 *
 * PART 2 (approved from a mockup, 2026-09-29): the tests are taken on the
 * program's own page, one at a time with `Left`, `About the same` or
 * `Right`; the side is saved on the enrollment; and a workout does each
 * one-sided exercise on that side only. Nothing in a session goes back to both
 * sides: retaking the tests is the way to change it (his call).
 */

import { z } from "zod";
import type { SideMeans, SideRule } from "./program";

export type Lean = "left" | "right";
/** What the person saw in one test: which side went further, or neither. */
export type Further = "left" | "right" | "same";

/** The three answers a test takes, in the order the screen offers them. */
export const FURTHER_CHOICES = ["left", "same", "right"] as const satisfies readonly Further[];

/** A test's answer as the enrollment keeps it: by the test's name, so a later edit can be told apart. */
export interface SideAnswer {
  name: string;
  further: Further;
}

/** What the tests screen sends: one answer per test, in the program's order. */
export const sideAnswersSchema = z.object({
  programId: z.string().uuid(),
  answers: z.array(z.enum(["left", "right", "same"])).min(1).max(20),
});

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

/**
 * A saved assessment's counts against the program's tests as they are now,
 * each answer matched to its test by name. Null when a test it answered has
 * since left the program or been renamed: counts would be a guess, so the
 * program page then says only when the tests were taken.
 */
export function savedCounts(
  tests: readonly { name: string; leftMeans: Lean }[],
  answers: readonly SideAnswer[],
  least: number,
): { side: Lean | null; left: number; right: number } | null {
  const key = (name: string) => name.trim().toLowerCase();
  const byName = new Map(answers.map((answer) => [key(answer.name), answer.further]));
  if (answers.length !== tests.length || tests.some((test) => !byName.has(key(test.name)))) return null;
  return assessedSide(
    tests,
    tests.map((test) => byName.get(key(test.name)) ?? null),
    least,
  );
}

/** The side an exercise is done on: its rule applied to the person's lean, or null for both sides. */
export function sideFor(rule: SideRule, lean: Lean | null): Lean | null {
  if (rule === "both" || lean === null) return null;
  return rule === "toward" ? lean : other(lean);
}

/**
 * The one side an exercise is done on in a workout: its rule applied to the
 * person's lean, for an exercise done per side. Null for both sides, which is
 * every exercise until the side is known.
 */
export function onlySideOf(item: { perSide: boolean; sideRule: SideRule }, lean: Lean | null): Lean | null {
  return item.perSide ? sideFor(item.sideRule, lean) : null;
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

/** Where a program's one-sided exercises are: "phase 2", "phases 2 and 4", "phases 2 to 4", "phases 1, 2 and 4". */
export function phasesWords(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `phase ${sorted[0]}`;
  const running = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  if (running && sorted.length > 2) return `phases ${sorted[0]} to ${sorted[sorted.length - 1]}`;
  return `phases ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

/**
 * A one-sided exercise once the side is known, for the program page: "Lying on
 * your left side only, because you lean left." The reason is there because an
 * exercise done AWAY from the lean names the other side.
 */
export function oneSideLine(means: SideMeans, side: Lean, lean: Lean): string {
  const words = sideWords(means, side);
  return `${means === "side" ? words : `${words} only`}, because you lean ${lean}.`;
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
