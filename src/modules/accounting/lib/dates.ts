/**
 * Report date arithmetic — pure ISO-string math, shared with the client
 * (no "server-only"). Policy pins P1/P3: bookkeeping dates are plain
 * yyyy-mm-dd strings compared lexically; no timezone ever enters report
 * math ("today" comes from todayInTimezone at the call site).
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parts(dateIso: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateIso.split("-").map(Number);
  return { y, m, d };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** P1: start of the fiscal year containing D, given the FY start month. */
export function fiscalYearStart(dateIso: string, startMonth: number): string {
  const { y, m } = parts(dateIso);
  return m >= startMonth ? iso(y, startMonth, 1) : iso(y - 1, startMonth, 1);
}

/** Add days (may be negative). UTC Date math internally; returns ISO. */
export function addDaysIso(dateIso: string, days: number): string {
  const { y, m, d } = parts(dateIso);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Shift whole years; Feb 29 clamps to Feb 28 (P3). */
export function shiftYearsIso(dateIso: string, years: number): string {
  const { y, m, d } = parts(dateIso);
  if (m === 2 && d === 29) return iso(y + years, 2, 28);
  return iso(y + years, m, d);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = parts(fromIso);
  const b = parts(toIso);
  const ms =
    Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/** P3: same-length range immediately preceding [from, to], no gap. */
export function previousPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  const len = daysBetween(from, to);
  const prevTo = addDaysIso(from, -1);
  return { from: addDaysIso(prevTo, -len), to: prevTo };
}

/** P3: the same range one calendar year earlier. */
export function previousYear(
  from: string,
  to: string,
): { from: string; to: string } {
  return { from: shiftYearsIso(from, -1), to: shiftYearsIso(to, -1) };
}

/** The last day of the month containing D. */
export function monthEndIso(dateIso: string): string {
  const { y, m } = parts(dateIso);
  return iso(y, m, lastDayOfMonth(y, m));
}

/** The end of the most recent COMPLETE month before today (close default). */
export function lastCompleteMonthEndIso(todayIso: string): string {
  const { y, m } = parts(todayIso);
  const ly = m === 1 ? y - 1 : y;
  const lm = m === 1 ? 12 : m - 1;
  return iso(ly, lm, lastDayOfMonth(ly, lm));
}

export type RangePreset =
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "this-fy"
  | "last-fy"
  | "custom";

export const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-quarter", label: "This quarter" },
  { value: "this-fy", label: "This fiscal year" },
  { value: "last-fy", label: "Last fiscal year" },
  { value: "custom", label: "Custom" },
];

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Resolve a preset to [from, to] given today + the tenant's FY start
 * month. "This quarter" is the calendar quarter (FY-aware quarters are
 * deferred); the FY presets are FY-aware. "custom" returns today..today
 * (the form keeps whatever the user typed).
 */
export function presetRange(
  preset: RangePreset,
  todayIso: string,
  fyStartMonth: number,
): { from: string; to: string } {
  const { y, m } = parts(todayIso);
  switch (preset) {
    case "this-month":
      return { from: iso(y, m, 1), to: todayIso };
    case "last-month": {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: iso(ly, lm, 1), to: iso(ly, lm, lastDayOfMonth(ly, lm)) };
    }
    case "this-quarter": {
      const qStartMonth = m - ((m - 1) % 3);
      return { from: iso(y, qStartMonth, 1), to: todayIso };
    }
    case "this-fy":
      return { from: fiscalYearStart(todayIso, fyStartMonth), to: todayIso };
    case "last-fy": {
      const thisStart = fiscalYearStart(todayIso, fyStartMonth);
      const lastStart = shiftYearsIso(thisStart, -1);
      return { from: lastStart, to: addDaysIso(thisStart, -1) };
    }
    case "custom":
      return { from: todayIso, to: todayIso };
  }
}
