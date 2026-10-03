import type { Tx } from "@/db";

/**
 * THE PROGRESS SLOT (docs/modules/health.md, H1; docs/extension-model.md P5).
 *
 * Health shows a person's progress week by week across what they do: its own
 * cold plunges, sleep and habits, and what other personal tools know (the
 * workouts, and what was eaten when Food logs it). Health must not import
 * those tools, and they must not know Health exists. So Health names this
 * slot, a tool fills it with a source (`src/modules/<tool>/progress-source.ts`
 * imports only this file), and `registry.ts` is the one file that names the
 * sources.
 *
 * What a source may do is small on purpose: answer numbers per window, and a
 * line for today. Health draws them, in its own words, so a tool ships no
 * component and decides nothing about the page.
 */

/** A run of days, both ends the space's own `YYYY-MM-DD`, inclusive. */
export interface ProgressWindow {
  from: string;
  to: string;
}

/**
 * How a row's numbers read: `days` ("4 days"), `minutes` ("7 h 12 min"),
 * `seconds` ("3 min 10 s"), `score` (a 0-to-10 average, "7.2"), `count`
 * ("4"), `amount` (a number in the row's `unit`, "60 min").
 */
export type ProgressFormat = "days" | "minutes" | "seconds" | "score" | "count" | "amount";

export interface ProgressRow {
  /** Stable and unique: "fitness.days". */
  key: string;
  /** What it is, in the person's words: "Workout days". */
  name: string;
  /** One value per window asked for, in the same order; null where there was nothing to measure. */
  values: (number | null)[];
  format: ProgressFormat;
  /** The unit of an `amount`: "min", "g". */
  unit?: string;
  /** Which way is better, so the page can say "up" or "down" plainly. */
  better: "up" | "down" | null;
}

/** A tool's card on Health's Today: what it did today, and where to go for more. */
export interface TodayCard {
  key: string;
  /** "Workout". */
  title: string;
  /** The tool's own icon, a name in `@/components/app/icon-registry`: "dumbbell". */
  icon: string;
  /** "Worked out · 4 exercises · 22 min", "Felt 4 before, 7 after". */
  lines: string[];
  /** The tool's own page. */
  href: string;
}

export interface ProgressSource {
  /** The tool's slug: its rows and card show only while it is switched on in the space. */
  tool: string;
  /** The tool's name, for the line that says it could not be read: "Workouts". */
  name: string;
  rows(tx: Tx, tenantId: string, windows: readonly ProgressWindow[]): Promise<ProgressRow[]>;
  today(tx: Tx, tenantId: string, day: string): Promise<TodayCard | null>;
}
