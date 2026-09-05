import { z } from "zod";
import { addDays } from "@/lib/timezone";

/**
 * Page views, the pure part: what the beacon sends, and how a month of
 * daily rows becomes the numbers the Website screen shows.
 *
 * The beacon says which site, which page, and whether this browser has
 * already reported a view today. That last word is the browser's own — it
 * keeps a "seen today" note in its storage — because the alternative,
 * telling browsers apart by their address, keeps something about a person
 * this platform has no reason to keep (ADR 0022).
 */
export const ViewBeaconSchema = z.object({
  site: z.string().trim().min(1).max(60),
  path: z.string().trim().max(200).default("/"),
  first: z.boolean().default(false),
});
export type ViewBeacon = z.infer<typeof ViewBeaconSchema>;

export const VIEWS_WINDOW_DAYS = 30;

export interface ViewRow {
  /** `yyyy-mm-dd` */
  day: string;
  path: string;
  views: number;
  visitors: number;
}

export interface ViewSummary {
  /** Oldest first, one entry per day in the window, zeros where nothing happened. */
  days: { day: string; views: number; visitors: number }[];
  /** Most viewed first. */
  pages: { path: string; views: number; visitors: number }[];
  totals: { views: number; visitors: number };
}

/** The `days` calendar days ending today, oldest first. */
export function dayKeys(today: string, days: number): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) keys.push(addDays(today, -i));
  return keys;
}

export function summarizeViews(rows: ViewRow[], today: string, days = VIEWS_WINDOW_DAYS): ViewSummary {
  const keys = dayKeys(today, days);
  const inWindow = new Set(keys);
  const byDay = new Map(keys.map((day) => [day, { day, views: 0, visitors: 0 }]));
  const byPath = new Map<string, { path: string; views: number; visitors: number }>();
  const totals = { views: 0, visitors: 0 };
  for (const row of rows) {
    if (!inWindow.has(row.day)) continue;
    const d = byDay.get(row.day)!;
    d.views += row.views;
    d.visitors += row.visitors;
    const p = byPath.get(row.path) ?? { path: row.path, views: 0, visitors: 0 };
    p.views += row.views;
    p.visitors += row.visitors;
    byPath.set(row.path, p);
    totals.views += row.views;
    totals.visitors += row.visitors;
  }
  return {
    days: keys.map((day) => byDay.get(day)!),
    pages: [...byPath.values()].sort((a, b) => b.views - a.views || a.path.localeCompare(b.path)),
    totals,
  };
}

/** The key a browser keeps to say "I have been counted today on this site". */
export function visitStorageKey(slug: string, localDay: string): string {
  return `yosher-site-visit:${slug}:${localDay}`;
}

/** `yyyy-mm-dd` of a Date in the browser's own timezone. */
export function localDayOf(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
