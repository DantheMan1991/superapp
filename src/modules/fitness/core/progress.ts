/**
 * PROGRESS AND THE GATE (docs/modules/fitness.md, F3; the founder approved it
 * from a mockup, 2026-09-27).
 *
 * Everything here is worked out from the sessions already logged, the same
 * `DaySession`s a split day adds up (core/day.ts). Nothing is stored:
 *
 * - A DONE DAY is a day whose sessions together met every exercise's minimum
 *   (`dayProgress(...).complete`), for the phase they did. The program counts
 *   days like this ("at least 14 days of the given exercises"), not calendar
 *   days, so a missed day moves the gate and not the calendar.
 * - THE GATE of a phase opens at its `min_done_days`. The app never moves the
 *   person on by itself: it says the next phase is open, and a phase whose
 *   gate has not opened warns but can still be started (his call).
 * - THE WEEK runs Monday to Sunday, and counts done days against the
 *   program's sessions a week. THE STREAK is weeks in a row that met the
 *   program's minimum (his call: the program asks for 3–4 a week, so a daily
 *   streak would break on every rest day). The week going on never breaks it.
 *
 * Pure: the program page and the Workouts home both compute with it on the
 * server, from the space's today.
 */

import { dayProgress, shiftDay, type DayItem, type DaySession } from "./day";
import { countOf } from "./program";

/** The days a phase was done on, and the days it had some sets but not all. */
export function phaseDays(items: readonly DayItem[], sessions: readonly DaySession[]): { done: string[]; partial: string[] } {
  const byDay = new Map<string, DaySession[]>();
  for (const session of sessions) {
    const list = byDay.get(session.localDay);
    if (list) list.push(session);
    else byDay.set(session.localDay, [session]);
  }
  const done: string[] = [];
  const partial: string[] = [];
  for (const [day, list] of [...byDay].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const progress = dayProgress(items, list);
    if (progress.complete) done.push(day);
    else if (progress.done > 0) partial.push(day);
  }
  return { done, partial };
}

export interface PhaseGate {
  /** Done days in the phase. */
  done: number;
  /** The phase's minimum before the next opens; null when the program sets none. */
  needed: number | null;
  /** The next phase may be started: the minimum is met, or there is none. */
  open: boolean;
}

export function phaseGate(minDoneDays: number | null, doneDays: number): PhaseGate {
  return { done: doneDays, needed: minDoneDays, open: minDoneDays === null || doneDays >= minDoneDays };
}

/** "6 of 14 done days", "1 of 1 done day", or "3 done days" when the phase sets none. */
export function doneDaysWords(gate: PhaseGate): string {
  if (gate.needed === null) return countOf(gate.done, "done day", "done days");
  return `${Math.min(gate.done, gate.needed)} of ${countOf(gate.needed, "done day", "done days")}`;
}

/** What the next phase brings: "4 exercises, 2 of them new: A, B.", or "all new". */
export function newExercisesWords(exerciseCount: number, newNames: readonly string[]): string {
  const count = countOf(exerciseCount, "exercise", "exercises");
  if (newNames.length === 0) return `${count}.`;
  if (newNames.length === exerciseCount) return `${count}, all new: ${newNames.join(", ")}.`;
  return `${count}, ${newNames.length} of them new: ${newNames.join(", ")}.`;
}

/** The Monday of the week a day is in. */
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  return shiftDay(day, -((weekday + 6) % 7));
}

/** The done days in today's week, Monday to today. */
export function weekCount(doneDays: ReadonlySet<string>, today: string): number {
  const monday = mondayOf(today);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const day = shiftDay(monday, i);
    if (day > today) break;
    if (doneDays.has(day)) count += 1;
  }
  return count;
}

/**
 * Weeks in a row that met the program's minimum, counted back from the last
 * week before this one; this week adds one once it has met it too, and never
 * breaks the streak while it is going on.
 */
export function weeksOnTarget(doneDays: ReadonlySet<string>, today: string, perWeek: number): number {
  if (perWeek <= 0) return 0;
  const thisMonday = mondayOf(today);
  const inWeek = (monday: string) => {
    let n = 0;
    for (let i = 0; i < 7; i++) if (doneDays.has(shiftDay(monday, i))) n += 1;
    return n;
  };
  let streak = weekCount(doneDays, today) >= perWeek ? 1 : 0;
  // A few years back at most: a streak is a count, not a search.
  for (let week = 1; week <= 260; week++) {
    if (inWeek(shiftDay(thisMonday, -7 * week)) < perWeek) break;
    streak += 1;
  }
  return streak;
}

export type CalendarState = "done" | "partial" | "none" | "ahead";

export interface CalendarDay {
  day: string;
  state: CalendarState;
  today: boolean;
}

/** The last `weeks` weeks, Monday to Sunday, oldest first, this week last. */
export function calendarWeeks(
  done: ReadonlySet<string>,
  partial: ReadonlySet<string>,
  today: string,
  weeks = 4,
): CalendarDay[][] {
  const first = shiftDay(mondayOf(today), -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = shiftDay(first, w * 7 + d);
      const state: CalendarState =
        day > today ? "ahead" : done.has(day) ? "done" : partial.has(day) ? "partial" : "none";
      return { day, state, today: day === today };
    }),
  );
}

/**
 * THE EFFORT WARNING, in the program's own terms: the exercises this week the
 * person rated above the program's zone. Effort is given once per exercise,
 * after its sets, so it counts exercises.
 */
export function effortWarning(
  sessions: readonly DaySession[],
  zone: { min: number; max: number } | null,
  today: string,
): string | null {
  if (!zone) return null;
  const monday = mondayOf(today);
  const over = sessions
    .filter((session) => session.localDay >= monday && session.localDay <= today)
    .flatMap((session) => session.efforts)
    .filter((effort) => effort > zone.max);
  if (over.length === 0) return null;
  const same = over.every((effort) => effort === over[0]);
  const where = same ? `at ${over[0]}/10` : `above ${zone.max}/10`;
  const range = zone.min === zone.max ? `${zone.min}` : `${zone.min}–${zone.max}`;
  return `${countOf(over.length, "exercise", "exercises")} ${where} this week. The program says stay at ${range}.`;
}

export interface FeelSummary {
  /** Averages, to one decimal. */
  before: number;
  after: number;
  /** Sessions with both answers. */
  sessions: number;
  /** The most recent sessions with both, oldest first, for the chart. */
  series: { before: number; after: number }[];
}

/** How the body felt before and after the sessions of a phase that asked both. */
export function feelOf(sessions: readonly DaySession[], phaseId: string, last = 14): FeelSummary | null {
  const answered = sessions.filter(
    (session) => session.phaseId === phaseId && session.feelBefore !== null && session.feelAfter !== null,
  );
  if (answered.length === 0) return null;
  const series = answered.map((session) => ({ before: session.feelBefore!, after: session.feelAfter! }));
  const mean = (values: number[]) => Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  return {
    before: mean(series.map((s) => s.before)),
    after: mean(series.map((s) => s.after)),
    sessions: answered.length,
    series: series.slice(-last),
  };
}

/** Every phase's done days: a day counts for the program when any phase was done on it. */
export function programDays(
  phases: readonly { items: readonly DayItem[] }[],
  sessions: readonly DaySession[],
): { perPhase: { done: string[]; partial: string[] }[]; done: Set<string>; partial: Set<string> } {
  const perPhase = phases.map((phase) => phaseDays(phase.items, sessions));
  const done = new Set(perPhase.flatMap((p) => p.done));
  const partial = new Set(perPhase.flatMap((p) => p.partial).filter((day) => !done.has(day)));
  return { perPhase, done, partial };
}
