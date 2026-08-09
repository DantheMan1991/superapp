import { addDays, datesBetween, startOfWeek } from "@/lib/timezone";

/**
 * Which local days a view covers, and how they group into rows.
 *
 * Pure and separate from the renderer so the ranges can be tested without a
 * DOM — the month grid in particular is easy to get subtly wrong (a month that
 * needs six rows, a month starting on a Sunday) and impossible to eyeball.
 */

export type ScheduleViewMode = "week" | "day" | "month";

export interface ViewRange {
  /** First local day shown, `yyyy-mm-dd`. */
  from: string;
  /** Last local day shown, inclusive. */
  to: string;
  /** Every day in the range, in order. */
  days: string[];
  /** Days grouped into rows: 1 row for week and day, 4–6 for month. */
  rows: string[][];
}

/**
 * A month view shows WHOLE WEEKS, not whole months.
 *
 * So it starts on the Sunday on or before the 1st and ends on the Saturday on
 * or after the last day — which is why a month can need four rows (February
 * starting on a Sunday in a non-leap year) or six (a 31-day month starting on a
 * Friday). Hardcoding five is the bug every hand-rolled month grid ships with.
 */
function monthRange(anchor: string): { from: string; to: string } {
  const [y, m] = anchor.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  // Day 0 of the next month is the last day of this one — no leap-year table.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const from = startOfWeek(first);
  const to = addDays(startOfWeek(last), 6);
  return { from, to };
}

export function resolveViewRange(
  mode: ScheduleViewMode,
  anchor: string,
): ViewRange {
  if (mode === "day") {
    return { from: anchor, to: anchor, days: [anchor], rows: [[anchor]] };
  }
  if (mode === "week") {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    const days = datesBetween(from, to);
    return { from, to, days, rows: [days] };
  }
  const { from, to } = monthRange(anchor);
  const days = datesBetween(from, to);
  const rows: string[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return { from, to, days, rows };
}

/** Where the previous/next arrows go, in the same view. */
export function shiftAnchor(
  mode: ScheduleViewMode,
  anchor: string,
  direction: -1 | 1,
): string {
  if (mode === "day") return addDays(anchor, direction);
  if (mode === "week") return addDays(anchor, 7 * direction);
  // A month step has to land inside the NEXT month rather than 30 days later,
  // or stepping from the 31st skips a month entirely.
  const [y, m] = anchor.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + direction, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
