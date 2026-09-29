import { z } from "zod";
import type { FitnessUnitValue } from "./program";

/**
 * AN EXERCISE THAT GETS HARDER IN STEPS (docs/modules/fitness.md, F4c;
 * approved from a mockup, 2026-09-29).
 *
 * Some exercises are a ladder: a first level, and the next once a mark is
 * made. The founder's program gives the mark in its words and shows the
 * levels only in the exercise's video, so the person names the levels in the
 * editor, each with the part of the video that shows it. His calls: the app
 * suggests moving up after the FIRST session that makes the mark at the
 * level, right after the exercise in a workout and on the program page; the
 * person decides; and a level can be gone back to.
 *
 * THE MARK is `sets` sets of at least `target` (on each side, for an exercise
 * done per side), with the effort no higher than the program's own top and
 * nothing hurting: good sets that did not take too much, in terms the app can
 * check. An effort or a hurt left unanswered makes no mark: the app cannot tell.
 *
 * Pure: the editor, the program page, workout mode and the save all use it.
 */

export const LEVELS_LIMIT = 20;

export const progressionSchema = z.object({
  levels: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        startS: z.number().int().min(0).max(86_400).nullable(),
        endS: z.number().int().min(1).max(86_400).nullable(),
      }),
    )
    .min(2)
    .max(LEVELS_LIMIT),
  sets: z.number().int().min(1).max(20),
  target: z.number().int().min(1).max(1000),
});
export type Progression = z.infer<typeof progressionSchema>;

/** A new exercise's levels: two to start, and its own prescription's top as the mark. */
export function emptyProgression(item: { setsMin: number; targetMin: number; targetMax: number | null }): Progression {
  return {
    levels: [
      { name: "Level 1", startS: null, endS: null },
      { name: "Level 2", startS: null, endS: null },
    ],
    sets: item.setsMin,
    target: item.targetMax ?? item.targetMin,
  };
}

/** The level the person is on for an item: saved, or the first; never past the last. */
export function levelOf(saved: Record<string, number> | null | undefined, itemId: string, count: number): number {
  const at = saved?.[itemId];
  if (typeof at !== "number" || !Number.isInteger(at) || at < 0) return 0;
  return Math.min(at, Math.max(0, count - 1));
}

/** "Progression 2 of 4". */
export function levelWords(progression: Progression, index: number): string {
  return `${progression.levels[index]?.name ?? `Level ${index + 1}`} of ${progression.levels.length}`;
}

/** "2 sets of 15 reps, each side": the mark, as the screens say it. */
export function markWords(progression: Pick<Progression, "sets" | "target">, unit: FitnessUnitValue, perSide: boolean): string {
  const unitWord = { reps: "reps", breaths: "breaths", rolls: "rolls", seconds: "seconds" }[unit];
  return `${progression.sets} ${progression.sets === 1 ? "set" : "sets"} of ${progression.target} ${unitWord}${perSide ? ", each side" : ""}`;
}

/**
 * Whether one go at an exercise made its level's mark. `sets` are the sets
 * done, each with its side (null for an exercise done on both at once); a set
 * counts when it reached the target, and for an exercise done per side a set
 * counts once both its sides did.
 */
export function markMade(
  mark: Pick<Progression, "sets" | "target">,
  done: {
    perSide: boolean;
    sets: readonly { side: "left" | "right" | null; count: number }[];
    effort: number | null;
    hurt: "none" | "pinch" | "yes" | null;
  },
  effortTop: number | null,
): boolean {
  const good = done.sets.filter((set) => set.count >= mark.target);
  const full = done.perSide
    ? Math.min(good.filter((set) => set.side === "right").length, good.filter((set) => set.side === "left").length)
    : good.length;
  if (full < mark.sets) return false;
  if (done.hurt !== "none") return false;
  if (effortTop === null) return true;
  return done.effort !== null && done.effort <= effortTop;
}

/** What the mark made says, after the exercise and on the program page. */
export function madeWords(mark: Pick<Progression, "sets" | "target">, levelName: string, effort: number | null): string {
  return `${mark.sets} × ${mark.target} at ${levelName}${effort !== null ? `, effort ${effort}` : ""}, nothing hurt.`;
}

/** A move from one level to another: the program's own number of levels bounds it. */
export const levelMoveSchema = z.object({
  programId: z.string().uuid(),
  itemId: z.string().uuid(),
  level: z.number().int().min(0).max(LEVELS_LIMIT - 1),
});
