import "server-only";
import type { Tx } from "@/db";
import type { ProgressRow, ProgressWindow } from "@/lib/progress-sources/types";
import { habitLogsBetween, listHabits, type HabitLogRow, type HabitRow } from "./habit-ops";
import { lastSleep, plungesBetween, sleepBetween, type PlungeRow, type SleepRow } from "./log-ops";
import { shiftDay } from "./core/progress";
import { healthRows } from "./core/rows";

/**
 * WHAT TODAY AND PROGRESS READ (H1, docs/modules/health.md), in one of the
 * space's transactions each. Workouts' part comes through the progress slot
 * (`@/lib/progress-sources/resolve`), never from here.
 */

/** Health's own rows for these weeks. */
export async function ownRows(tx: Tx, tenantId: string, windows: readonly ProgressWindow[]): Promise<ProgressRow[]> {
  if (windows.length === 0) return [];
  const from = windows[0].from;
  const to = windows[windows.length - 1].to;
  const nights = await sleepBetween(tx, tenantId, from, to);
  const plunges = await plungesBetween(tx, tenantId, from, to);
  const habits = await listHabits(tx, tenantId);
  const days = await habitLogsBetween(tx, tenantId, from, to);
  return healthRows(windows, nights, plunges, habits, days);
}

export interface TodayData {
  today: string;
  /** Last night, when logged this morning. */
  night: SleepRow | null;
  /** The latest night logged (this morning's, when it is): the form starts from its times. */
  lastNight: SleepRow | null;
  plunges: PlungeRow[];
  /** Plunges in the seven days ending today. */
  plungesThisWeek: number;
  habits: HabitRow[];
  /** Today's marks, by habit. */
  doneToday: HabitLogRow[];
}

/**
 * Four queries in the space's one transaction, run one after another, so each
 * is a round trip: this morning's night is the latest night when it was
 * logged today (no night is ever filed under a morning still to come).
 */
export async function todayData(tx: Tx, tenantId: string, today: string): Promise<TodayData> {
  const lastNight = await lastSleep(tx, tenantId);
  const week = await plungesBetween(tx, tenantId, shiftDay(today, -6), today);
  const habits = await listHabits(tx, tenantId);
  const doneToday = await habitLogsBetween(tx, tenantId, today, today);
  return {
    today,
    night: lastNight?.wokeOn === today ? lastNight : null,
    lastNight,
    plunges: week.filter((p) => p.takenOn === today),
    plungesThisWeek: week.length,
    habits,
    doneToday,
  };
}
