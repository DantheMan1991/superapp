import { z } from "zod";
import { FITNESS_UNITS, type FitnessUnitValue, type SideMeans } from "./program";

/**
 * WORKOUT MODE'S PURE HALF (docs/modules/fitness.md, F2a).
 *
 * A session is a DOCUMENT the phone keeps: made when the person taps Start,
 * changed by every set they finish, and sent whole to `saveSession`, which
 * makes the database match it. The phone is where the truth is while a
 * workout is going, because it is the one thing in the room with the person,
 * and a basement gym has no signal; the server is where it ends up.
 *
 * WHERE THE SESSION IS, IS WORKED OUT FROM WHAT IT HOLDS (`nextStep`), never
 * kept beside it: a phone that reloads, or a tab closed and opened again,
 * lands on exactly the set it was on, because there is nothing else to be
 * out of step with.
 *
 * Every change is a pure function from one document to the next, taking the
 * ids and the time it needs as arguments, so the whole of a session can be
 * walked in a test without a clock or a random number.
 */

export const SIDES = ["left", "right"] as const;
export type Side = (typeof SIDES)[number];

export const HURTS = ["none", "pinch", "yes"] as const;
export type Hurt = (typeof HURTS)[number];

/**
 * The order a per-side exercise's sides are done in. The founder's program
 * sets none, and right first is the common default. An exercise the program
 * does on one side for someone who leans (F4b) has no order: it is done on
 * that side only (`PlanItem.onlySide`).
 */
export const SIDE_ORDER: readonly Side[] = ["right", "left"];

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });

export const sessionSetSchema = z.object({
  id: uuid,
  /** 1-based. Both sides of a per-side set share it. */
  number: z.number().int().min(1).max(20),
  side: z.enum(SIDES).nullable(),
  /** The least the program asks: the bottom of "5–8 breaths". */
  target: z.number().int().min(1).max(1000),
  count: z.number().int().min(0).max(1000),
  doneAt: instant,
});

export const sessionExerciseSchema = z.object({
  id: uuid,
  /** Null when the program's exercise has since been edited away. */
  itemId: uuid.nullable(),
  exerciseId: uuid.nullable(),
  position: z.number().int().min(0).max(200),
  name: z.string().trim().min(1).max(120),
  unit: z.enum(FITNESS_UNITS),
  perSide: z.boolean(),
  /**
   * The one side a per-side exercise is done on, for a person whose side is
   * known (F4b): such an exercise is logged as not `perSide`, each set with
   * this side, so a set counts once. The phone's alone, like `plannedSets`:
   * the server keeps each set's side, which says the same.
   */
  onlySide: z.enum(SIDES).nullable().optional(),
  /** The level it is done at, 0-based, for an exercise with levels (F4c). */
  level: z.number().int().min(0).max(19).nullable().optional(),
  /** "Move up" chosen after it (F4c): the server moves the level on, once. */
  levelUp: z.boolean().optional(),
  /**
   * How many sets this exercise is being done for: the program's minimum,
   * raised by "one more set" up to its maximum. The phone's alone; the server
   * keeps the sets done, not the plan.
   */
  plannedSets: z.number().int().min(1).max(20),
  effort: z.number().int().min(1).max(10).nullable(),
  cuesFelt: z.array(z.string().trim().max(240)).max(20),
  hurt: z.enum(HURTS).nullable(),
  hurtNote: z.string().trim().max(500),
  skipped: z.boolean(),
  finishedAt: instant.nullable(),
  sets: z.array(sessionSetSchema).max(80),
});

/**
 * What a session sets out to do for one item (F2c, core/day.ts): `sets` now
 * (0 when the day's earlier sessions already did them), and the most "one
 * more set" may reach without taking the day past the program's maximum.
 */
export const sessionAimSchema = z.object({
  itemId: uuid,
  sets: z.number().int().min(0).max(20),
  max: z.number().int().min(0).max(20),
});

export const sessionDocSchema = z.object({
  id: uuid,
  programId: uuid,
  phaseId: uuid.nullable(),
  phaseName: z.string().trim().max(80),
  /** The person's own calendar day, as the phone knows it: `YYYY-MM-DD`. */
  localDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: instant,
  finishedAt: instant.nullable(),
  feelBefore: z.number().int().min(0).max(10).nullable(),
  feelAfter: z.number().int().min(0).max(10).nullable(),
  note: z.string().trim().max(2000),
  /** Counts the phone's changes; the server keeps the highest it has seen. */
  revision: z.number().int().min(1).max(1_000_000),
  exercises: z.array(sessionExerciseSchema).max(60),
  /**
   * The session's own plan, one per item, when it was started as part of a
   * split day (F2c): the phone's alone, like `plannedSets`. A session without
   * one (every session before F2c) aims at each item's minimum.
   */
  aim: z.array(sessionAimSchema).max(60).optional(),
});

export type SessionSet = z.infer<typeof sessionSetSchema>;
export type SessionExercise = z.infer<typeof sessionExerciseSchema>;
export type SessionDoc = z.infer<typeof sessionDocSchema>;
export type SessionAim = z.infer<typeof sessionAimSchema>;

/* -- the plan: what the phase asks for today -------------------------------- */

export interface PlanVideo {
  id: string;
  startS: number | null;
  endS: number | null;
  embeddable: boolean | null;
}

export interface PlanItem {
  itemId: string;
  exerciseId: string;
  name: string;
  purpose: string;
  cues: string[];
  unit: FitnessUnitValue;
  perSide: boolean;
  optional: boolean;
  setsMin: number;
  setsMax: number | null;
  targetMin: number;
  targetMax: number | null;
  notes: string;
  video: PlanVideo | null;
  /**
   * The one side this exercise is done on today (F4b): its rule applied to
   * the person's side. Such an item is not `perSide`, so its sets count once
   * and its words drop "each side". Absent for both sides.
   */
  onlySide?: Side | null;
  /** How that side is said: the side itself, the side lain on, or the leg on top. */
  sideMeans?: SideMeans;
  /**
   * The level it is done at today, for an exercise with levels (F4c): which,
   * its name, the next level's name (null on the last), and the mark for
   * moving up. Absent for everything else.
   */
  level?: {
    index: number;
    count: number;
    name: string;
    next: string | null;
    mark: { sets: number; target: number };
  };
}

export interface SessionPlan {
  programId: string;
  programName: string;
  phaseId: string;
  phaseName: string;
  /** 0-based. */
  phaseIndex: number;
  phaseCount: number;
  /** Every phase of the program, in order: a session open for another phase is offered by name. */
  phases: { id: string; name: string }[];
  /** The pacer's pace (`breathPace`). */
  breath: { outS: number; inS: number };
  /** The program's effort zone, shaded on the scale after each exercise. */
  effort: { min: number; max: number } | null;
  /** The person's side, from the program's self-assessment (F4b). Absent or null until it is known. */
  lean?: Side | null;
  items: PlanItem[];
}

/* -- where the session is ----------------------------------------------------- */

export type Step =
  | { kind: "set"; itemIndex: number; number: number; side: Side | null }
  | { kind: "check"; itemIndex: number }
  | { kind: "finish" };

/** The sides each set is done on: both, in order, for a per-side exercise. */
export function sidesFor(perSide: boolean): readonly (Side | null)[] {
  return perSide ? SIDE_ORDER : [null];
}

/** The sides each set of an item or a logged exercise is done on: its one side, when it has one (F4b). */
export function sidesOf(exercise: { perSide: boolean; onlySide?: Side | null }): readonly (Side | null)[] {
  return exercise.onlySide ? [exercise.onlySide] : sidesFor(exercise.perSide);
}

/** The exercise the session logged for a plan item, if it has started it. */
export function loggedFor(doc: SessionDoc, item: PlanItem): SessionExercise | undefined {
  return doc.exercises.find((exercise) => exercise.itemId === item.itemId);
}

/**
 * What the session aims at for an item: its own aim when it has one (a split
 * day, F2c), else the program's minimum, with "one more set" up to its
 * maximum.
 */
export function plannedFor(doc: SessionDoc, item: PlanItem): { sets: number; max: number } {
  const aim = doc.aim?.find((a) => a.itemId === item.itemId);
  if (aim) return { sets: aim.sets, max: Math.max(aim.sets, aim.max) };
  return { sets: item.setsMin, max: item.setsMax ?? item.setsMin };
}

/**
 * A SET IS A FULL SET: one of "1 × 15 rolls per side" is both sides, so a
 * per-side exercise's sets count once each side has one. What a session's
 * summary says and what a day adds up (core/day.ts) both count this way.
 */
export function fullSets(perSide: boolean, sides: readonly (Side | null)[]): number {
  if (!perSide) return sides.length;
  let right = 0;
  let left = 0;
  for (const side of sides) {
    if (side === "right") right += 1;
    else if (side === "left") left += 1;
  }
  return Math.min(right, left);
}

/**
 * THE NEXT THING TO DO. Down the phase in order: an item not started yet is
 * its first set, unless the session aims at none of it (the day's earlier
 * sessions did them); one started and short of its planned sets is its next
 * set (right side, then left); one with every set done is the three taps
 * after it; one finished or skipped is behind us. Past the last, the finish.
 */
export function nextStep(plan: SessionPlan, doc: SessionDoc): Step {
  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i];
    const logged = loggedFor(doc, item);
    if (!logged) {
      if (plannedFor(doc, item).sets === 0) continue;
      return { kind: "set", itemIndex: i, number: 1, side: sidesOf(item)[0] };
    }
    if (logged.skipped || logged.finishedAt) continue;
    const sides = sidesOf(logged);
    const done = logged.sets.length;
    if (done < logged.plannedSets * sides.length) {
      return {
        kind: "set",
        itemIndex: i,
        number: Math.floor(done / sides.length) + 1,
        side: sides[done % sides.length],
      };
    }
    return { kind: "check", itemIndex: i };
  }
  return { kind: "finish" };
}

/* -- the changes ---------------------------------------------------------------- */

/** The person's own calendar day for an instant, on this device's clock. */
export function localDayOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Start: the document is made when the person taps Start on the feel check.
 * `aim` is the session's own plan on a split day (core/day.ts `aimFor`).
 */
export function beginSession(
  plan: SessionPlan,
  input: { id: string; now: Date; feelBefore: number | null; aim?: SessionAim[] },
): SessionDoc {
  return {
    id: input.id,
    programId: plan.programId,
    phaseId: plan.phaseId,
    phaseName: plan.phaseName,
    localDay: localDayOf(input.now),
    startedAt: input.now.toISOString(),
    finishedAt: null,
    feelBefore: input.feelBefore,
    feelAfter: null,
    note: "",
    revision: 1,
    exercises: [],
    ...(input.aim ? { aim: input.aim } : {}),
  };
}

function bump(doc: SessionDoc, exercises: SessionExercise[]): SessionDoc {
  return { ...doc, revision: doc.revision + 1, exercises };
}

function startExercise(plan: SessionPlan, doc: SessionDoc, itemIndex: number, id: string): SessionExercise {
  const item = plan.items[itemIndex];
  return {
    id,
    itemId: item.itemId,
    exerciseId: item.exerciseId,
    position: itemIndex,
    name: item.name,
    unit: item.unit,
    perSide: item.perSide,
    // Only when there is one: every document before F4b, and every exercise
    // done on both sides, looks exactly as it did.
    ...(item.onlySide ? { onlySide: item.onlySide } : {}),
    // And the level, for an exercise with levels (F4c).
    ...(item.level ? { level: item.level.index } : {}),
    // At least one: an item is only started for a set it has, or to skip it.
    plannedSets: Math.max(1, plannedFor(doc, item).sets),
    effort: null,
    cuesFelt: [],
    hurt: null,
    hurtNote: "",
    skipped: false,
    finishedAt: null,
    sets: [],
  };
}

/** The exercise for an item, started if it is not yet; and the list with it in. */
function withExercise(
  doc: SessionDoc,
  plan: SessionPlan,
  itemIndex: number,
  newId: string,
): { exercises: SessionExercise[]; exercise: SessionExercise } {
  const existing = loggedFor(doc, plan.items[itemIndex]);
  if (existing) return { exercises: doc.exercises, exercise: existing };
  const exercise = startExercise(plan, doc, itemIndex, newId);
  return { exercises: [...doc.exercises, exercise], exercise };
}

function replace(exercises: SessionExercise[], next: SessionExercise): SessionExercise[] {
  return exercises.map((exercise) => (exercise.id === next.id ? next : exercise));
}

/**
 * A set done: the step `nextStep` said, with the count the pacer kept or the
 * person confirmed. Refused (the document comes back unchanged) unless the
 * step really is that set, so a double tap cannot log a set twice.
 */
export function recordSet(
  plan: SessionPlan,
  doc: SessionDoc,
  input: { itemIndex: number; count: number; setId: string; exerciseId: string; now: Date },
): SessionDoc {
  const step = nextStep(plan, doc);
  if (step.kind !== "set" || step.itemIndex !== input.itemIndex) return doc;
  const item = plan.items[input.itemIndex];
  const { exercises, exercise } = withExercise(doc, plan, input.itemIndex, input.exerciseId);
  const set: SessionSet = {
    id: input.setId,
    number: step.number,
    side: step.side,
    target: item.targetMin,
    count: Math.max(0, Math.min(1000, Math.round(input.count))),
    doneAt: input.now.toISOString(),
  };
  return bump(doc, replace(exercises, { ...exercise, sets: [...exercise.sets, set] }));
}

/**
 * One more set than planned, while the program's maximum allows: for the day,
 * on a split day, so the morning's sets and the evening's together stay
 * within it.
 */
export function oneMoreSet(plan: SessionPlan, doc: SessionDoc, itemIndex: number): SessionDoc {
  const item = plan.items[itemIndex];
  const logged = loggedFor(doc, item);
  if (!logged || logged.finishedAt || logged.skipped) return doc;
  if (logged.plannedSets >= plannedFor(doc, item).max) return doc;
  return bump(doc, replace(doc.exercises, { ...logged, plannedSets: logged.plannedSets + 1 }));
}

/** Whether "one more set" is on offer for an item. */
export function canAddSet(plan: SessionPlan, doc: SessionDoc, itemIndex: number): boolean {
  const item = plan.items[itemIndex];
  const logged = loggedFor(doc, item);
  return !!logged && logged.plannedSets < plannedFor(doc, item).max;
}

/**
 * The three taps after an exercise, which finish it; and, for an exercise
 * with levels whose mark was made, the choice to move up (F4c), kept only
 * when it is a move up from the level the exercise was done at.
 */
export function finishExercise(
  plan: SessionPlan,
  doc: SessionDoc,
  input: {
    itemIndex: number;
    effort: number | null;
    cuesFelt: string[];
    hurt: Hurt | null;
    hurtNote: string;
    now: Date;
    levelUp?: boolean;
  },
): SessionDoc {
  const item = plan.items[input.itemIndex];
  const logged = loggedFor(doc, item);
  if (!logged || logged.finishedAt) return doc;
  const levelUp = input.levelUp === true && logged.level != null && item.level?.next != null;
  return bump(
    doc,
    replace(doc.exercises, {
      ...logged,
      effort: input.effort,
      cuesFelt: input.cuesFelt,
      hurt: input.hurt,
      hurtNote: input.hurt && input.hurt !== "none" ? input.hurtNote.trim().slice(0, 500) : "",
      finishedAt: input.now.toISOString(),
      ...(levelUp ? { levelUp: true } : {}),
    }),
  );
}

/** Skip an exercise, done or not: an optional one, or one that cannot be done today. */
export function skipExercise(
  plan: SessionPlan,
  doc: SessionDoc,
  input: { itemIndex: number; exerciseId: string; now: Date },
): SessionDoc {
  const { exercises, exercise } = withExercise(doc, plan, input.itemIndex, input.exerciseId);
  if (exercise.finishedAt) return doc;
  return bump(
    doc,
    replace(exercises, { ...exercise, skipped: true, finishedAt: input.now.toISOString() }),
  );
}

/** The finish: how the body feels now, and the session closed. */
export function finishSession(
  doc: SessionDoc,
  input: { feelAfter: number | null; now: Date },
): SessionDoc {
  if (doc.finishedAt) return doc;
  return {
    ...doc,
    revision: doc.revision + 1,
    feelAfter: input.feelAfter,
    finishedAt: input.now.toISOString(),
  };
}

/* -- what it adds up to --------------------------------------------------------- */

export interface SessionSummary {
  /** Exercises with at least one set done. */
  exercises: number;
  /** Full sets (`fullSets`): one set of a per-side exercise is both sides. */
  sets: number;
  /** Start to finish; while it is still going, start to the last set. */
  minutes: number;
  feelBefore: number | null;
  feelAfter: number | null;
}

/** The last thing done in a session: its finish, else its latest set, else its start. */
export function lastActivity(doc: SessionDoc): string {
  if (doc.finishedAt) return doc.finishedAt;
  return doc.exercises
    .flatMap((exercise) => exercise.sets.map((set) => set.doneAt))
    .reduce((latest, at) => (at > latest ? at : latest), doc.startedAt);
}

/** Pure, with no clock: a render may call it (the lint's purity rule), and a test can. */
export function sessionSummary(doc: SessionDoc): SessionSummary {
  const done = doc.exercises.filter((exercise) => exercise.sets.length > 0);
  const end = new Date(lastActivity(doc));
  return {
    exercises: done.length,
    sets: done.reduce((n, exercise) => n + fullSets(exercise.perSide, exercise.sets.map((set) => set.side)), 0),
    minutes: Math.max(0, Math.round((end.getTime() - new Date(doc.startedAt).getTime()) / 60_000)),
    feelBefore: doc.feelBefore,
    feelAfter: doc.feelAfter,
  };
}

/** "Right side", "Left side", or nothing for an exercise done on both at once. */
export function sideWords(side: Side | null): string | null {
  return side === "right" ? "Right side" : side === "left" ? "Left side" : null;
}
