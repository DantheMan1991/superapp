import { z } from "zod";
import { progressionSchema } from "./levels";

/**
 * A PROGRAM AS IT TRAVELS: from Claude's draft to the review screen, from the
 * editor to the save, and back out of the database to be edited again. One
 * shape for all of it, so the draft an import stores IS what the editor opens,
 * and the save accepts exactly what the editor sends.
 *
 * Ids are carried when a row already exists — an edit keeps every row's id
 * (src/db/schema/fitness.ts explains why) — and are null for anything new.
 * Pure: the client runs `programProblems` as the person types, and the server
 * runs the same function again before it writes.
 */

export const FITNESS_UNITS = ["reps", "breaths", "rolls", "seconds"] as const;
export type FitnessUnitValue = (typeof FITNESS_UNITS)[number];

/** Which side an exercise is done on once the person's side is known (F4b; core/side.ts). */
export const SIDE_RULES = ["both", "toward", "away"] as const;
export type SideRule = (typeof SIDE_RULES)[number];

/** What "the side" is for the words: the side, the side lain on, or the leg on top. */
export const SIDE_MEANS = ["side", "lying", "top_leg"] as const;
export type SideMeans = (typeof SIDE_MEANS)[number];

/** How each unit reads after a number: "8 breaths", "1 roll". */
export const UNIT_WORDS: Record<FitnessUnitValue, { one: string; many: string }> = {
  reps: { one: "rep", many: "reps" },
  breaths: { one: "breath", many: "breaths" },
  rolls: { one: "roll", many: "rolls" },
  seconds: { one: "second", many: "seconds" },
};

const id = z.string().uuid().nullable();
const count = (max: number) => z.number().int().min(1).max(max);

export const videoInputSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  startS: z.number().int().min(0).max(86_400).nullable(),
  endS: z.number().int().min(1).max(86_400).nullable(),
  label: z.string().trim().max(60).nullable(),
  embeddable: z.boolean().nullable(),
});

export const itemInputSchema = z.object({
  itemId: id,
  exerciseId: id,
  name: z.string().trim().max(120),
  purpose: z.string().trim().max(1000),
  cues: z.array(z.string().trim().max(240)).max(20),
  unit: z.enum(FITNESS_UNITS),
  videos: z.array(videoInputSchema).max(6),
  setsMin: count(20),
  setsMax: count(20).nullable(),
  targetMin: count(1000),
  targetMax: count(1000).nullable(),
  perSide: z.boolean(),
  optional: z.boolean(),
  notes: z.string().trim().max(1000),
  /** `default`s so a draft stored before F4b still opens. */
  sideRule: z.enum(SIDE_RULES).default("both"),
  sideMeans: z.enum(SIDE_MEANS).default("side"),
  /** Its levels and the mark for moving up (F4c, core/levels.ts); null without. */
  progression: progressionSchema.nullable().default(null),
});

export const phaseInputSchema = z.object({
  phaseId: id,
  name: z.string().trim().max(80),
  minDoneDays: z.number().int().min(1).max(365).nullable(),
  notes: z.string().trim().max(1000),
  items: z.array(itemInputSchema).max(40),
});

/** One test of a side self-assessment (F4b; `FitnessAssessment` in the schema says what each field means). */
export const assessmentTestSchema = z.object({
  name: z.string().trim().max(80),
  /** What the person is asked: "Which side went further?" */
  question: z.string().trim().max(160),
  /** Which side the test points to when the LEFT side went further. */
  leftMeans: z.enum(["left", "right"]),
});

export const assessmentInputSchema = z.object({
  video: videoInputSchema.nullable(),
  least: z.number().int().min(1).max(20),
  tests: z.array(assessmentTestSchema).max(20),
  notes: z.string().trim().max(1000),
});

/** The question a test asks when the book gives none: the founder's program compares ranges. */
export const DEFAULT_TEST_QUESTION = "Which side went further?";

export const programInputSchema = z.object({
  name: z.string().trim().max(120),
  author: z.string().trim().max(120),
  notes: z.string().trim().max(3000),
  sessionsPerWeekMin: count(14).nullable(),
  sessionsPerWeekMax: count(14).nullable(),
  effortMin: count(10).nullable(),
  effortMax: count(10).nullable(),
  /**
   * The breathing pace the program asks for, in whole seconds. `default(null)`
   * so a draft stored before F2 still opens.
   */
  breathOutS: count(30).nullable().default(null),
  breathInS: count(30).nullable().default(null),
  /** The side self-assessment, when the program has one (F4b). `default(null)` for drafts stored before it. */
  assessment: assessmentInputSchema.nullable().default(null),
  phases: z.array(phaseInputSchema).max(24),
});

/**
 * The pacer's pace when a program gives none: five seconds out, five in, the
 * founder's program's own and a common one for this kind of work.
 */
export const DEFAULT_BREATH = { outS: 5, inS: 5 } as const;

/** The pace workout mode's pacer keeps: the program's own, or the default. */
export function breathPace(program: { breathOutS: number | null; breathInS: number | null }): {
  outS: number;
  inS: number;
} {
  return {
    outS: program.breathOutS ?? DEFAULT_BREATH.outS,
    inS: program.breathInS ?? DEFAULT_BREATH.inS,
  };
}

export type VideoInput = z.infer<typeof videoInputSchema>;
export type AssessmentInput = z.infer<typeof assessmentInputSchema>;
export type ItemInput = z.infer<typeof itemInputSchema>;
export type PhaseInput = z.infer<typeof phaseInputSchema>;
export type ProgramInput = z.infer<typeof programInputSchema>;

/**
 * WHAT STOPS A SAVE, in words the editor shows beside the thing to fix. The
 * shape is the schema's job; this is everything a person can get wrong while
 * the shape is still fine — and the database's CHECKs refuse the same things,
 * so a problem missed here fails loudly there rather than landing.
 */
export function programProblems(program: ProgramInput): string[] {
  const problems: string[] = [];
  if (program.name.trim() === "") problems.push("Give the program a name.");
  if (program.phases.length === 0) problems.push("Add at least one phase.");
  rangeProblem(
    problems,
    "Sessions a week",
    program.sessionsPerWeekMin,
    program.sessionsPerWeekMax,
  );
  rangeProblem(problems, "Effort", program.effortMin, program.effortMax);
  program.phases.forEach((phase, p) => {
    const phaseName = phase.name.trim() || `Phase ${p + 1}`;
    if (phase.name.trim() === "") problems.push(`Phase ${p + 1} needs a name.`);
    if (phase.items.length === 0) problems.push(`${phaseName} has no exercises.`);
    phase.items.forEach((item, i) => {
      const where = `${phaseName}, exercise ${i + 1}`;
      if (item.name.trim() === "") problems.push(`${where} needs a name.`);
      rangeProblem(problems, `${where}: sets`, item.setsMin, item.setsMax);
      rangeProblem(problems, `${where}: count`, item.targetMin, item.targetMax);
      item.videos.forEach((video) => {
        if (video.startS != null && video.endS != null && video.endS <= video.startS) {
          problems.push(`${where}: a video's end must come after its start.`);
        }
      });
      if (item.sideRule !== "both" && !item.perSide) {
        problems.push(`${where}: only an exercise done per side can be done on one side.`);
      }
      item.progression?.levels.forEach((level, l) => {
        if (level.name.trim() === "") problems.push(`${where}: level ${l + 1} needs a name.`);
        if (level.startS != null && level.endS != null && level.endS <= level.startS) {
          problems.push(`${where}: level ${l + 1}'s end must come after its start.`);
        }
      });
    });
  });
  const assessment = program.assessment;
  if (assessment) {
    if (assessment.tests.length === 0) problems.push("The self-assessment needs at least one test.");
    assessment.tests.forEach((test, t) => {
      if (test.name.trim() === "") problems.push(`Self-assessment, test ${t + 1} needs a name.`);
    });
    if (assessment.tests.length > 0 && assessment.least > assessment.tests.length) {
      problems.push(
        `The self-assessment asks for ${assessment.least} tests to agree but has ${countOf(assessment.tests.length, "test", "tests")}.`,
      );
    }
    const video = assessment.video;
    if (video && video.startS != null && video.endS != null && video.endS <= video.startS) {
      problems.push("The self-assessment's video must end after its start.");
    }
  }
  return problems;
}

/** "from" and "to" with "to" optional: a range is at least its own floor. */
function rangeProblem(
  problems: string[],
  label: string,
  min: number | null,
  max: number | null,
): void {
  if (max != null && min == null) problems.push(`${label}: fill in the first number too.`);
  if (max != null && min != null && max < min) {
    problems.push(`${label}: the second number cannot be smaller than the first.`);
  }
}

/**
 * The prescription as the program writes it: "2 × 8 breaths per side",
 * "2–3 × 8–10 reps", "1 × 15 rolls".
 */
export function prescription(item: {
  setsMin: number;
  setsMax: number | null;
  targetMin: number;
  targetMax: number | null;
  unit: FitnessUnitValue;
  perSide: boolean;
}): string {
  const sets = range(item.setsMin, item.setsMax);
  const target = range(item.targetMin, item.targetMax);
  const plural = (item.targetMax ?? item.targetMin) === 1 ? "one" : "many";
  const unit = UNIT_WORDS[item.unit][plural];
  return `${sets} × ${target} ${unit}${item.perSide ? " per side" : ""}`;
}

function range(min: number, max: number | null): string {
  return max != null && max !== min ? `${min}–${max}` : String(min);
}

/** "1 page", "59 pages": a count with its noun. A one-page program sheet is a real PDF. */
export function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A program with nothing in it but one empty phase: the "build one by hand" start. */
export function emptyProgram(): ProgramInput {
  return {
    name: "",
    author: "",
    notes: "",
    sessionsPerWeekMin: null,
    sessionsPerWeekMax: null,
    effortMin: null,
    effortMax: null,
    breathOutS: null,
    breathInS: null,
    assessment: null,
    phases: [emptyPhase(0)],
  };
}

/** A self-assessment with nothing in it yet but one test: the editor's "Add a self-assessment". */
export function emptyAssessment(): AssessmentInput {
  return { video: null, least: 1, tests: [{ name: "", question: DEFAULT_TEST_QUESTION, leftMeans: "left" }], notes: "" };
}

export function emptyPhase(index: number): PhaseInput {
  return {
    phaseId: null,
    name: `Phase ${index + 1}`,
    minDoneDays: null,
    notes: "",
    items: [emptyItem()],
  };
}

export function emptyItem(): ItemInput {
  return {
    itemId: null,
    exerciseId: null,
    name: "",
    purpose: "",
    cues: [],
    unit: "reps",
    videos: [],
    setsMin: 1,
    setsMax: null,
    targetMin: 10,
    targetMax: null,
    perSide: false,
    optional: false,
    notes: "",
    sideRule: "both",
    sideMeans: "side",
    progression: null,
  };
}
