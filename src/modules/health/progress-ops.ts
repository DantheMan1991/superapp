import "server-only";
import type { Tx } from "@/db";
import type { ProgressRow, ProgressWindow } from "@/lib/progress-sources/types";
import {
  getWeightGoal,
  lastMeasuredOn,
  listMeasures,
  measurementsBetween,
  weighinsBetween,
  type MeasureRow,
} from "./body-ops";
import { habitLogsBetween, listHabits, type HabitLogRow, type HabitRow } from "./habit-ops";
import { lastSleep, plungesBetween, sleepBetween, type PlungeRow, type SleepRow } from "./log-ops";
import { bodyRows, type Weighin, type WeightGoal } from "./core/body";
import { shiftDay } from "./core/progress";
import { healthRows } from "./core/rows";

/**
 * WHAT TODAY AND PROGRESS READ (H1, H2; docs/modules/health.md), in one of
 * the space's transactions each. Workouts' and Food's parts come through the
 * progress slot (`@/lib/progress-sources/resolve`), never from here.
 */

/**
 * How far before the first week the weigh-ins are read: the trend through a
 * week starts from every weigh-in before it, and after two months the oldest
 * counts for under two in a thousand (0.9^60).
 */
export const TREND_WARM_UP_DAYS = 60;

/** Health's own rows for these weeks: the body first, then sleep, plunges and the habits. */
export async function ownRows(tx: Tx, tenantId: string, windows: readonly ProgressWindow[]): Promise<ProgressRow[]> {
  if (windows.length === 0) return [];
  const from = windows[0].from;
  const to = windows[windows.length - 1].to;
  const weighins = await weighinsBetween(tx, tenantId, shiftDay(from, -TREND_WARM_UP_DAYS), to);
  const goal = await getWeightGoal(tx, tenantId);
  const measures = await listMeasures(tx, tenantId);
  const measurements = await measurementsBetween(tx, tenantId, from, to);
  const nights = await sleepBetween(tx, tenantId, from, to);
  const plunges = await plungesBetween(tx, tenantId, from, to);
  const habits = await listHabits(tx, tenantId);
  const days = await habitLogsBetween(tx, tenantId, from, to);
  return [...bodyRows(windows, weighins, goal, measures, measurements), ...healthRows(windows, nights, plunges, habits, days)];
}

export interface DayData {
  day: string;
  /** The night that ended that morning, when it was kept. */
  night: SleepRow | null;
  /** The latest night kept on or before that morning: the form starts from its times. */
  lastNight: SleepRow | null;
  plunges: PlungeRow[];
  /** Plunges in the seven days ending that day. */
  plungesThisWeek: number;
  habits: HabitRow[];
  /** That day's marks, by habit. */
  doneThatDay: HabitLogRow[];
  /** The weigh-ins in the two months ending that day, oldest first: the card's trend runs through them. */
  weighins: Weighin[];
  goal: WeightGoal | null;
  measures: MeasureRow[];
  /** The latest day a tape measure was taken, on or before that day. */
  lastMeasured: string | null;
}

/**
 * What Today shows for a day, today or one being filled in. One query after
 * another in the space's one transaction, so each is a round trip: the day's
 * own night is the latest night when it was kept on that morning.
 */
export async function dayData(tx: Tx, tenantId: string, day: string): Promise<DayData> {
  const lastNight = await lastSleep(tx, tenantId, day);
  const week = await plungesBetween(tx, tenantId, shiftDay(day, -6), day);
  const habits = await listHabits(tx, tenantId);
  const doneThatDay = await habitLogsBetween(tx, tenantId, day, day);
  const weighins = await weighinsBetween(tx, tenantId, shiftDay(day, -TREND_WARM_UP_DAYS), day);
  const goal = await getWeightGoal(tx, tenantId);
  const measures = await listMeasures(tx, tenantId);
  const lastMeasured = measures.length === 0 ? null : await lastMeasuredOn(tx, tenantId, day);
  return {
    day,
    night: lastNight?.wokeOn === day ? lastNight : null,
    lastNight,
    plunges: week.filter((p) => p.takenOn === day),
    plungesThisWeek: week.length,
    habits,
    doneThatDay,
    weighins,
    goal,
    measures,
    lastMeasured,
  };
}
