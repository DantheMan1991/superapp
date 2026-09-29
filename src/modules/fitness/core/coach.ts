/**
 * WHAT THE COACH SAYS (docs/modules/fitness.md, F2b; ADR 0114).
 *
 * The rule: the voice says what the screen would tell you if you could see it,
 * at the moments you cannot. You cannot see it during a set (face on the
 * floor), between sets (the next one counts down and starts itself), or when a
 * timed set ends on its own. You can see it at the feel checks and after each
 * exercise, where you are tapping anyway, so it says nothing there beyond
 * "Exercise done."
 *
 *   a set appears      what it is: the exercise and its prescription on the
 *                      first set, then "Set 2 of 3. Right side." or "Now the
 *                      left side." A one-sided exercise (F4b) says its side
 *                      every set, "Lying on your left side.", and never the
 *                      other. A set counted in reps or rolls has no timer
 *                      to say a cue halfway through, so its cue comes here.
 *   a breath set       the cue as the middle breath starts; "Last one." as
 *                      the last one starts. The tones still mark every turn.
 *   a hold             the cue halfway; "Ten seconds left." in a long one.
 *   the check appears  "Exercise done."
 *
 * The lines carry their priority and key for the one voice
 * (`@/lib/speech/queue-policy`): what happens next is `normal` and keyed
 * `step`, so a newer step replaces an unsaid older one; a count is `normal`,
 * keyed `count`, so it cuts off a cue; a cue is `low` and waits its turn, or
 * goes unsaid. Pure: every word a person hears is tested here, because none of
 * it can be checked by looking at a screen.
 */

import { forSpeech } from "@/lib/speech/say";
import type { VoiceLine } from "@/lib/speech/queue-policy";
import { UNIT_WORDS } from "./program";
import { sideWords as oneSideWords } from "./side";
import {
  finishExercise,
  loggedFor,
  nextStep,
  plannedFor,
  recordSet,
  SIDE_ORDER,
  type PlanItem,
  type SessionDoc,
  type SessionPlan,
  type Step,
} from "./session";

/** The check shown (and said) for a set: one of the exercise's cues, changing each set. */
export function cueFor(item: PlanItem, setsDone: number): string | null {
  return item.cues.length > 0 ? item.cues[setsDone % item.cues.length] : null;
}

function spokenRange(min: number, max: number | null): string {
  return max != null && max !== min ? `${min} to ${max}` : String(min);
}

/** "2 sets of 5 to 8 breaths, each side", "1 set of 15 rolls": the prescription, said. */
export function spokenPrescription(item: {
  setsMin: number;
  setsMax: number | null;
  targetMin: number;
  targetMax: number | null;
  unit: PlanItem["unit"];
  perSide: boolean;
}): string {
  const oneSet = item.setsMin === 1 && (item.setsMax == null || item.setsMax === 1);
  const sets = `${spokenRange(item.setsMin, item.setsMax)} ${oneSet ? "set" : "sets"}`;
  const top = item.targetMax ?? item.targetMin;
  const unit = UNIT_WORDS[item.unit][top === 1 ? "one" : "many"];
  return `${sets} of ${spokenRange(item.targetMin, item.targetMax)} ${unit}${item.perSide ? ", each side" : ""}`;
}

function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function sideName(side: "left" | "right"): string {
  return side === "right" ? "Right side" : "Left side";
}

/** The line for a set as its screen appears. */
export function setIntro(plan: SessionPlan, doc: SessionDoc, step: Extract<Step, { kind: "set" }>): VoiceLine {
  const item = plan.items[step.itemIndex];
  const logged = loggedFor(doc, item);
  const done = logged?.sets.length ?? 0;
  const planned = logged?.plannedSets ?? plannedFor(doc, item).sets;
  const parts: string[] = [];
  // One side only (F4b): said every set, the way the program names it, and
  // there is no other side to turn to. As the exercise was started: one begun
  // on both sides before the side was saved finishes on both.
  const onlySide = logged ? (logged.onlySide ?? null) : (item.onlySide ?? null);
  const only = onlySide ? oneSideWords(item.sideMeans ?? "side", onlySide) : null;
  if (done === 0) {
    const aimed = plannedFor(doc, item).sets;
    // A split day's share (F2c) says this session's sets: "1 set of 8 breaths".
    // An exercise with levels (F4c) says which, after its name.
    parts.push(item.name);
    if (item.level) parts.push(item.level.name);
    parts.push(spokenPrescription(aimed === item.setsMin ? item : { ...item, setsMin: aimed, setsMax: null }));
    if (only) parts.push(only);
    else if (step.side) parts.push(`${sideName(step.side)} first`);
  } else if (!only && step.side && step.side !== SIDE_ORDER[0]) {
    parts.push(`Now the ${step.side} side`);
  } else {
    parts.push(`Set ${step.number} of ${Math.max(planned, step.number)}`);
    if (only) parts.push(only);
    else if (step.side) parts.push(sideName(step.side));
  }
  // Reps and rolls have no timer to say a cue halfway through.
  const cue = item.unit === "reps" || item.unit === "rolls" ? cueFor(item, done) : null;
  if (cue) parts.push(cue);
  return { text: forSpeech(parts.map(sentence).join(" ")), priority: "normal", key: "step" };
}

const LAST_ONE = "Last one.";
const TEN_SECONDS_LEFT = "Ten seconds left.";

/** A cue, as it is said during a set. */
function spokenCue(cue: string): string {
  return forSpeech(sentence(cue));
}

/**
 * As breath `n` of a set begins (1-based; `max` is the top of the range, where
 * the pacer stops): the cue at the middle breath, "Last one." at the last.
 */
export function breathLine(n: number, max: number, cue: string | null): VoiceLine | null {
  if (max > 1 && n === max) return { text: LAST_ONE, priority: "normal", key: "count" };
  if (cue && max >= 3 && n === Math.floor(max / 2) + 1) {
    return { text: spokenCue(cue), priority: "low", key: "cue" };
  }
  return null;
}

/** After `elapsed` seconds of a hold of `max`: the cue halfway, and ten seconds' warning in a long one. */
export function holdLine(elapsed: number, max: number, cue: string | null): VoiceLine | null {
  if (max >= 30 && max - elapsed === 10) return { text: TEN_SECONDS_LEFT, priority: "normal", key: "count" };
  if (cue && max >= 10 && elapsed === Math.floor(max / 2)) {
    return { text: spokenCue(cue), priority: "low", key: "cue" };
  }
  return null;
}

/** As the check after an exercise appears. */
export const EXERCISE_DONE: VoiceLine = { text: "Exercise done.", priority: "normal", key: "step" };

/**
 * EVERY LINE A SESSION CAN SAY FROM HERE (F2d, ADR 0115): what the coach's
 * recordings are fetched for, before they are needed. The session is walked
 * to its end the way it will most likely go, every set done at its target:
 * each set's line as it appears, each timed set's cue, and the three lines
 * any set may say. A line the walk did not foresee (a set added with "One
 * more set") is recorded when it is first said, and said by the device if
 * the recording is late.
 *
 * In the order they will be needed, the three that wait for a set's end last,
 * because the phone fetches the first few on their own (`clips.ts`) so the
 * first line is ready soonest.
 *
 * Pure, and built from the same functions the screen speaks with, so a word
 * changed there is a word fetched here.
 */
export function sessionLines(plan: SessionPlan, doc: SessionDoc): string[] {
  const lines: string[] = [];
  const now = new Date(0);
  let walk = doc;
  // A phase is a handful of exercises of a few sets each; the bound is a
  // guard against a plan that never finishes, not a limit anyone reaches.
  for (let i = 0; i < 500; i++) {
    const step = nextStep(plan, walk);
    if (step.kind === "finish") break;
    if (step.kind === "check") {
      walk = finishExercise(plan, walk, {
        itemIndex: step.itemIndex,
        effort: null,
        cuesFelt: [],
        hurt: null,
        hurtNote: "",
        now,
      });
      continue;
    }
    const item = plan.items[step.itemIndex];
    lines.push(setIntro(plan, walk, step).text);
    // A breath or a hold says its cue during the set; reps and rolls said
    // theirs with the set's line.
    const cue = item.unit === "reps" || item.unit === "rolls" ? null : cueFor(item, loggedFor(walk, item)?.sets.length ?? 0);
    if (cue) lines.push(spokenCue(cue));
    const next = recordSet(plan, walk, {
      itemIndex: step.itemIndex,
      count: item.targetMin,
      setId: `walk-${i}`,
      exerciseId: `walk-${step.itemIndex}`,
      now,
    });
    if (next === walk) break;
    walk = next;
  }
  lines.push(LAST_ONE, TEN_SECONDS_LEFT, EXERCISE_DONE.text);
  return [...new Set(lines.map((line) => line.trim()))];
}
