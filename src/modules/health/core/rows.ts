import type { ProgressRow, ProgressWindow } from "@/lib/progress-sources/types";
import { inWindow, mean } from "./progress";

/**
 * HEALTH'S OWN ROWS on the Progress page (H1, docs/modules/health.md): sleep a
 * night and how rested, plunges and the time in the cold, and each of the
 * person's habits. One value per week; a week with nothing logged is null,
 * not zero, except for the counts (no plunges in a week is 0 plunges). Pure.
 */

export interface NightIn {
  wokeOn: string;
  minutes: number;
  rested: number | null;
}

export interface PlungeIn {
  takenOn: string;
  seconds: number;
}

export interface HabitIn {
  id: string;
  name: string;
  unit: string | null;
}

export interface HabitDayIn {
  habitId: string;
  doneOn: string;
  amount: number | null;
}

export function healthRows(
  windows: readonly ProgressWindow[],
  nights: readonly NightIn[],
  plunges: readonly PlungeIn[],
  habits: readonly HabitIn[],
  habitDays: readonly HabitDayIn[],
): ProgressRow[] {
  const nightsIn = (w: ProgressWindow) => nights.filter((n) => inWindow(n.wokeOn, w));
  const plungesIn = (w: ProgressWindow) => plunges.filter((p) => inWindow(p.takenOn, w));
  const rows: ProgressRow[] = [
    {
      key: "health.sleep",
      name: "Sleep a night",
      values: windows.map((w) => mean(nightsIn(w).map((n) => n.minutes))),
      format: "minutes",
      better: "up",
    },
    {
      key: "health.rested",
      name: "How rested",
      values: windows.map((w) => mean(nightsIn(w).flatMap((n) => (n.rested === null ? [] : [n.rested])))),
      format: "score",
      better: "up",
    },
    {
      key: "health.plunges",
      name: "Cold plunges",
      values: windows.map((w) => plungesIn(w).length),
      format: "count",
      better: "up",
    },
    {
      key: "health.plunge-time",
      name: "Time in the cold",
      values: windows.map((w) => mean(plungesIn(w).map((p) => p.seconds))),
      format: "seconds",
      better: "up",
    },
  ];
  for (const habit of habits) {
    const days = (w: ProgressWindow) => habitDays.filter((d) => d.habitId === habit.id && inWindow(d.doneOn, w));
    rows.push(
      habit.unit
        ? {
            // A counted habit: how much, that week.
            key: `health.habit.${habit.id}`,
            name: habit.name,
            values: windows.map((w) => days(w).reduce((sum, d) => sum + (d.amount ?? 0), 0)),
            format: "amount",
            unit: habit.unit,
            better: "up",
          }
        : {
            key: `health.habit.${habit.id}`,
            name: habit.name,
            values: windows.map((w) => days(w).length),
            format: "days",
            better: "up",
          },
    );
  }
  return rows;
}
