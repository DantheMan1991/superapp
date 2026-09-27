import { z } from "zod";
import { FITNESS_UNITS, type FitnessUnitValue } from "./program";

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
 * sets none, and right first is the common default. F4 (the program's own
 * left-or-right assessment) is where this becomes the person's.
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
});

export type SessionSet = z.infer<typeof sessionSetSchema>;
export type SessionExercise = z.infer<typeof sessionExerciseSchema>;
export type SessionDoc = z.infer<typeof sessionDocSchema>;

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

/** The exercise the session logged for a plan item, if it has started it. */
export function loggedFor(doc: SessionDoc, item: PlanItem): SessionExercise | undefined {
  return doc.exercises.find((exercise) => exercise.itemId === item.itemId);
}

/**
 * THE NEXT THING TO DO. Down the phase in order: an item not started yet is
 * its first set; one started and short of its planned sets is its next set
 * (right side, then left); one with every set done is the three taps after
 * it; one finished or skipped is behind us. Past the last, the finish.
 */
export function nextStep(plan: SessionPlan, doc: SessionDoc): Step {
  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i];
    const logged = loggedFor(doc, item);
    if (!logged) return { kind: "set", itemIndex: i, number: 1, side: sidesFor(item.perSide)[0] };
    if (logged.skipped || logged.finishedAt) continue;
    const sides = sidesFor(logged.perSide);
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

/** Start: the document is made when the person taps Start on the feel check. */
export function beginSession(
  plan: SessionPlan,
  input: { id: string; now: Date; feelBefore: number | null },
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
  };
}

function bump(doc: SessionDoc, exercises: SessionExercise[]): SessionDoc {
  return { ...doc, revision: doc.revision + 1, exercises };
}

function startExercise(plan: SessionPlan, itemIndex: number, id: string): SessionExercise {
  const item = plan.items[itemIndex];
  return {
    id,
    itemId: item.itemId,
    exerciseId: item.exerciseId,
    position: itemIndex,
    name: item.name,
    unit: item.unit,
    perSide: item.perSide,
    plannedSets: item.setsMin,
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
  const exercise = startExercise(plan, itemIndex, newId);
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

/** One more set than the minimum, while the program's maximum allows. */
export function oneMoreSet(plan: SessionPlan, doc: SessionDoc, itemIndex: number): SessionDoc {
  const item = plan.items[itemIndex];
  const logged = loggedFor(doc, item);
  if (!logged || logged.finishedAt || logged.skipped) return doc;
  if (logged.plannedSets >= (item.setsMax ?? item.setsMin)) return doc;
  return bump(doc, replace(doc.exercises, { ...logged, plannedSets: logged.plannedSets + 1 }));
}

/** Whether "one more set" is on offer for an item. */
export function canAddSet(plan: SessionPlan, doc: SessionDoc, itemIndex: number): boolean {
  const item = plan.items[itemIndex];
  const logged = loggedFor(doc, item);
  return !!logged && logged.plannedSets < (item.setsMax ?? item.setsMin);
}

/** The three taps after an exercise, which finish it. */
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
  },
): SessionDoc {
  const logged = loggedFor(doc, plan.items[input.itemIndex]);
  if (!logged || logged.finishedAt) return doc;
  return bump(
    doc,
    replace(doc.exercises, {
      ...logged,
      effort: input.effort,
      cuesFelt: input.cuesFelt,
      hurt: input.hurt,
      hurtNote: input.hurt && input.hurt !== "none" ? input.hurtNote.trim().slice(0, 500) : "",
      finishedAt: input.now.toISOString(),
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
    sets: done.reduce((n, exercise) => n + exercise.sets.length, 0),
    minutes: Math.max(0, Math.round((end.getTime() - new Date(doc.startedAt).getTime()) / 60_000)),
    feelBefore: doc.feelBefore,
    feelAfter: doc.feelAfter,
  };
}

/** "Right side", "Left side", or nothing for an exercise done on both at once. */
export function sideWords(side: Side | null): string | null {
  return side === "right" ? "Right side" : side === "left" ? "Left side" : null;
}
