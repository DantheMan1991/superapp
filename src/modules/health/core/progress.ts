import type { ProgressFormat, ProgressRow, ProgressWindow } from "@/lib/progress-sources/types";
import { amountWords } from "./habits";
import { plungeWords } from "./plunge";
import { durationWords } from "./sleep";

/**
 * PROGRESS, BY WEEK (H1, docs/modules/health.md; the founder's call: the last
 * four weeks). A week here is seven days ending on a day: the newest is the
 * seven days ending today, so "this week" is never a Monday's one day against
 * a whole week before it. Each row is one number per week, and the words say
 * which way it is going: the newest week against the weeks before it. Pure.
 */

export const WEEKS = 4;

/** Four weeks of seven days, oldest first, the newest ending `today`. */
export function progressWindows(today: string, weeks = WEEKS): ProgressWindow[] {
  const out: ProgressWindow[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    out.push({ from: shiftDay(today, -(i * 7 + 6)), to: shiftDay(today, -(i * 7)) });
  }
  return out;
}

/** A `YYYY-MM-DD` moved by whole days (calendar arithmetic, no clocks). */
export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
}

/** "Sep 26": a window's first day, for the column under its bar. */
export function weekLabel(window: ProgressWindow): string {
  const [y, m, d] = window.from.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A value as the person reads it. */
export function valueWords(value: number, format: ProgressFormat, unit?: string): string {
  switch (format) {
    case "days":
      return plural(Math.round(value), "day", "days");
    case "minutes":
      return durationWords(value);
    case "seconds":
      return plungeWords(value);
    case "score":
      return (Math.round(value * 10) / 10).toFixed(1);
    case "count":
      return String(Math.round(value));
    case "amount": {
      // Ten and up reads whole, with its thousands marked, as Food's Today writes them:
      // "2,010 kcal", "35 g" (D4a). Below ten, a tenth, so a small amount is not nothing.
      if (value >= 10) return `${Math.round(value).toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`;
      return amountWords(Math.round(value * 10) / 10, unit ?? null);
    }
  }
}

/** The smallest change worth calling a change, per format: below it, "about the same". */
const NOTICEABLE: Record<ProgressFormat, number> = { days: 1, minutes: 10, seconds: 15, score: 0.3, count: 1, amount: 0.0001 };

/**
 * An amount's smallest change depends on what it counts: fifty calories or
 * five grams a day is noise, where any change in a habit's minutes is not.
 */
const NOTICEABLE_BY_UNIT: Record<string, number> = { kcal: 50, g: 5, mg: 100 };

function noticeable(row: ProgressRow): number {
  if (row.format === "amount" && row.unit && row.unit in NOTICEABLE_BY_UNIT) return NOTICEABLE_BY_UNIT[row.unit];
  return NOTICEABLE[row.format];
}

/** A week's value on its own, where a score needs its scale: "6.5 of 10", "7 h 12 min". */
export function weekWords(value: number, format: ProgressFormat, unit?: string): string {
  const words = valueWords(value, format, unit);
  return format === "score" ? `${words} of 10` : words;
}

export type Direction = "better" | "worse" | "same" | null;

export interface RowReading {
  /** The newest week, as words: "7 h 12 min", or null when it had nothing. */
  latest: string | null;
  /** Against the weeks before: "up 25 min on the weeks before", "about the same as the weeks before". */
  change: string | null;
  /** Which way the number went, whatever is better: the arrow beside the words. */
  moved: "up" | "down" | null;
  /** Whether that is the better way, by the row's `better`: the colour of the words. */
  direction: Direction;
}

/**
 * How a row reads: its newest week, and that week against the mean of the
 * weeks before it that had something. A row with nothing in the newest week,
 * or nothing before it, says only what it can.
 */
export function readRow(row: ProgressRow): RowReading {
  const latest = row.values.at(-1) ?? null;
  const before = row.values.slice(0, -1).filter((v): v is number => v !== null);
  if (latest === null) return { latest: null, change: null, moved: null, direction: null };
  const latestWords = weekWords(latest, row.format, row.unit);
  if (before.length === 0) return { latest: latestWords, change: null, moved: null, direction: null };
  const average = before.reduce((sum, v) => sum + v, 0) / before.length;
  const diff = latest - average;
  if (Math.abs(diff) < noticeable(row)) {
    return { latest: latestWords, change: "about the same as the weeks before", moved: null, direction: "same" };
  }
  const up = diff > 0;
  const direction: Direction = row.better === null ? null : (row.better === "up") === up ? "better" : "worse";
  return {
    latest: latestWords,
    change: `${up ? "up" : "down"} ${valueWords(Math.abs(diff), row.format, row.unit)} on the weeks before`,
    moved: up ? "up" : "down",
    direction,
  };
}

/** Each value as a share of the row's largest, for the bars: 0 to 1, null for none. */
export function barHeights(values: readonly (number | null)[]): (number | null)[] {
  const top = Math.max(0, ...values.filter((v): v is number => v !== null));
  return values.map((v) => (v === null ? null : top === 0 ? 0 : v / top));
}

/** The mean of some numbers, or null when there are none. */
export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function inWindow(day: string, window: ProgressWindow): boolean {
  return day >= window.from && day <= window.to;
}
