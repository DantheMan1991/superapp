import type { ProgressRow, ProgressWindow, TodayCard } from "@/lib/progress-sources/types";
import {
  caloriesOnTarget,
  gramWords,
  kcalWords,
  proteinOnTarget,
  totals,
  type DayTotals,
  type Nutrients,
  type TargetsInput,
} from "./eating";

/**
 * WHAT FOOD TELLS HEALTH (D4a; the progress slot, ADR 0125): week by week, the
 * calories and each macro a day, averaged over the days something was logged,
 * and the days on each target the person set; and today's card. Food never
 * learns Health exists: it answers numbers and short lines through the slot.
 * Pure: the source reads the rows, this adds them up.
 */

export interface EatenDay extends Nutrients {
  eatenOn: string;
}

const HOME = "/personal/m/food";

function inWindow(day: string, window: ProgressWindow): boolean {
  return day >= window.from && day <= window.to;
}

/** Each logged day of a window, added up. */
function daysIn(entries: readonly EatenDay[], window: ProgressWindow): DayTotals[] {
  const byDay = new Map<string, EatenDay[]>();
  for (const entry of entries) {
    if (!inWindow(entry.eatenOn, window)) continue;
    byDay.set(entry.eatenOn, [...(byDay.get(entry.eatenOn) ?? []), entry]);
  }
  return [...byDay.values()].map((day) => totals(day));
}

/** The mean of one number over the days that know it; null for a week with none. */
function meanOf(days: readonly DayTotals[], pick: (day: DayTotals) => number | null): number | null {
  const values = days.map(pick).filter((v): v is number => v !== null);
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function eatingRows(
  entries: readonly EatenDay[],
  windows: readonly ProgressWindow[],
  targets: TargetsInput,
): ProgressRow[] {
  const weeks = windows.map((window) => daysIn(entries, window));
  const rows: ProgressRow[] = [
    {
      key: "food.calories",
      name: "Calories a day",
      values: weeks.map((days) => meanOf(days, (d) => d.calories)),
      format: "amount",
      unit: "kcal",
      // More is better for one goal and worse for another: no colour.
      better: null,
    },
    {
      key: "food.protein",
      name: "Protein a day",
      values: weeks.map((days) => meanOf(days, (d) => d.proteinG)),
      format: "amount",
      unit: "g",
      better: "up",
    },
    {
      key: "food.carbs",
      name: "Carbs a day",
      values: weeks.map((days) => meanOf(days, (d) => d.carbsG)),
      format: "amount",
      unit: "g",
      better: null,
    },
    {
      key: "food.fat",
      name: "Fat a day",
      values: weeks.map((days) => meanOf(days, (d) => d.fatG)),
      format: "amount",
      unit: "g",
      better: null,
    },
  ];
  if (targets.calories !== null) {
    rows.push({
      key: "food.calorie-target",
      name: "Days on your calorie target",
      values: weeks.map((days) => days.filter((d) => caloriesOnTarget(d.calories, targets.calories) === true).length),
      format: "days",
      better: "up",
    });
  }
  if (targets.proteinG !== null) {
    rows.push({
      key: "food.protein-target",
      name: "Days on your protein target",
      values: weeks.map((days) => days.filter((d) => proteinOnTarget(d.proteinG, targets.proteinG) === true).length),
      format: "days",
      better: "up",
    });
  }
  return rows;
}

/** Today's card: the day's numbers, and how far along each target. */
export function eatingToday(entries: readonly Nutrients[], targets: TargetsInput): TodayCard {
  if (entries.length === 0) {
    return { key: "food", title: "Eating", icon: "utensils", lines: ["Nothing logged today"], href: HOME };
  }
  const day = totals(entries);
  const lines = [
    [
      day.calories === null ? null : kcalWords(day.calories),
      day.proteinG === null ? null : `protein ${gramWords(day.proteinG)}`,
      day.carbsG === null ? null : `carbs ${gramWords(day.carbsG)}`,
      day.fatG === null ? null : `fat ${gramWords(day.fatG)}`,
    ]
      .filter(Boolean)
      .join(" · ") || "Logged, with no nutrition stated",
  ];
  const along = [
    targets.proteinG === null ? null : `Protein ${Math.round(day.proteinG ?? 0)} of ${targets.proteinG} g`,
    targets.calories === null
      ? null
      : `calories ${Math.round(day.calories ?? 0).toLocaleString("en-US")} of ${targets.calories.toLocaleString("en-US")}`,
  ].filter(Boolean);
  if (along.length > 0) lines.push(along.join(" · "));
  if (day.unknown > 0) lines.push(`${day.unknown} ${day.unknown === 1 ? "thing has" : "things have"} no nutrition stated`);
  return { key: "food", title: "Eating", icon: "utensils", lines, href: HOME };
}
