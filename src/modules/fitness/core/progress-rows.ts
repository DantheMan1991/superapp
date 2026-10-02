import type { ProgressRow, ProgressWindow, TodayCard } from "@/lib/progress-sources/types";
import { countOf } from "./program";

/**
 * WHAT WORKOUTS TELLS HEALTH (docs/modules/fitness.md; the progress slot,
 * docs/modules/health.md H1). Health's Progress page shows, week by week, the
 * days a person worked out and how they felt after; its Today shows today's
 * workout. Workouts answers in numbers and short lines through the slot and
 * never learns Health exists. Pure: the source reads the sessions, this adds
 * them up.
 *
 * A WORKOUT DAY here is a day with at least one set logged, in any program.
 * It is not the program's done day (`core/progress.ts`), which counts only a
 * day that met every exercise's minimum and drives the phase gate: Health
 * shows what the person did, and the program page shows how the program is
 * going.
 */

/** A session with at least one set, as the source reads it. */
export interface WorkedOut {
  localDay: string;
  /** Exercises it logged a set of. */
  exercises: number;
  minutes: number;
  feelBefore: number | null;
  feelAfter: number | null;
  startedAt: Date;
}

const HOME = "/personal/m/fitness";

function inWindow(day: string, window: ProgressWindow): boolean {
  return day >= window.from && day <= window.to;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Workout days per window, and the average feel after a workout. */
export function workoutRows(sessions: readonly WorkedOut[], windows: readonly ProgressWindow[]): ProgressRow[] {
  const days = windows.map((window) => new Set(sessions.filter((s) => inWindow(s.localDay, window)).map((s) => s.localDay)).size);
  const feel = windows.map((window) =>
    mean(sessions.filter((s) => inWindow(s.localDay, window) && s.feelAfter !== null).map((s) => s.feelAfter as number)),
  );
  return [
    { key: "fitness.days", name: "Workout days", values: days, format: "days", better: "up" },
    { key: "fitness.feel", name: "Feel after a workout", values: feel, format: "score", better: "up" },
  ];
}

/** Today's card: what was done, or that nothing has been yet. */
export function workoutToday(sessions: readonly WorkedOut[]): TodayCard {
  if (sessions.length === 0) {
    return { key: "fitness", title: "Workout", icon: "dumbbell", lines: ["Not yet today"], href: HOME };
  }
  const exercises = sessions.reduce((sum, s) => sum + s.exercises, 0);
  const minutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
  const lines = [`Worked out · ${countOf(exercises, "exercise", "exercises")} · ${minutes} min`];
  // How the last session of the day left the person: what they said of it.
  const last = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()).at(-1)!;
  if (last.feelBefore !== null && last.feelAfter !== null) lines.push(`Felt ${last.feelBefore} before, ${last.feelAfter} after`);
  else if (last.feelAfter !== null) lines.push(`Felt ${last.feelAfter} after`);
  else if (last.feelBefore !== null) lines.push(`Felt ${last.feelBefore} before`);
  return { key: "fitness", title: "Workout", icon: "dumbbell", lines, href: HOME };
}
