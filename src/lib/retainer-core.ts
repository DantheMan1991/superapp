/**
 * Retainer hours — pure math, no db/server imports (unit-testable alone).
 *
 * Model: each tenant's monthly included hours come from an allotment
 * HISTORY ("included from month M onward"), so past months are frozen when
 * the allotment changes. Balances are derived, never stored:
 *
 *   overageAllTime      = Σ over months m ≤ asOf of max(0, used_m − allotment_m)
 *   purchasedRemaining  = max(0, purchasedTotal − overageAllTime)
 *   unpaidOverage       = max(0, overageAllTime − purchasedTotal)
 *
 * No-rollover falls out of the max(): an under-used month contributes 0.
 * Purchased blocks carry until consumed because only overage consumes them.
 */

/** Calendar-month boundaries are defined in the founder's timezone. */
export const RETAINER_TZ = "America/New_York";

export interface AllotmentChange {
  /** 'YYYY-MM' — applies from this calendar month onward. */
  effectiveMonth: string;
  includedMinutes: number;
}

export interface MonthlyUsed {
  month: string;
  minutes: number;
}

export interface RetainerUsage {
  month: string;
  includedMinutes: number;
  usedMinutes: number;
  includedRemainingMinutes: number;
  overageMinutesThisMonth: number;
  purchasedMinutesTotal: number;
  overageMinutesAllTime: number;
  purchasedMinutesRemaining: number;
  /** Overage not covered by purchased blocks — the red state. */
  unpaidOverageMinutes: number;
  isOver: boolean;
  isNearLimit: boolean;
}

/** 'YYYY-MM' of a 'yyyy-mm-dd' date string. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Full 'yyyy-mm-dd' today in the retainer timezone. */
export function todayInRetainerTz(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RETAINER_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 'YYYY-MM' current calendar month in the retainer timezone. */
export function currentMonth(now: Date = new Date()): string {
  return monthOf(todayInRetainerTz(now));
}

/** Timer duration: round UP to whole minutes, minimum 1. */
export function elapsedMinutes(startedAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60_000));
}

/** Display only — storage is always integer minutes. */
export function formatMinutesAsHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`;
}

/**
 * Allotment in force for `month`: the row with the greatest effectiveMonth
 * ≤ month (string compare is correct for 'YYYY-MM'). None → 0.
 */
export function allotmentForMonth(
  history: AllotmentChange[],
  month: string,
): number {
  let best: AllotmentChange | undefined;
  for (const change of history) {
    if (change.effectiveMonth > month) continue;
    if (!best || change.effectiveMonth > best.effectiveMonth) best = change;
  }
  return best?.includedMinutes ?? 0;
}

/** Group raw entries into per-month sums. */
export function usedByMonth(
  entries: { workDate: string; minutes: number }[],
): MonthlyUsed[] {
  const sums = new Map<string, number>();
  for (const e of entries) {
    const m = monthOf(e.workDate);
    sums.set(m, (sums.get(m) ?? 0) + e.minutes);
  }
  return [...sums.entries()]
    .map(([month, minutes]) => ({ month, minutes }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function computeRetainerUsage(input: {
  monthlyUsed: MonthlyUsed[];
  purchasedMinutesTotal: number;
  allotments: AllotmentChange[];
  /** The month the meter reports on — normally currentMonth(). */
  month: string;
}): RetainerUsage {
  const { monthlyUsed, purchasedMinutesTotal, allotments, month } = input;

  let overageMinutesAllTime = 0;
  let usedMinutes = 0;
  for (const m of monthlyUsed) {
    // Future-dated months are excluded from the balance until they arrive.
    if (m.month > month) continue;
    overageMinutesAllTime += Math.max(
      0,
      m.minutes - allotmentForMonth(allotments, m.month),
    );
    if (m.month === month) usedMinutes = m.minutes;
  }

  const includedMinutes = allotmentForMonth(allotments, month);
  const purchasedMinutesRemaining = Math.max(
    0,
    purchasedMinutesTotal - overageMinutesAllTime,
  );
  const unpaidOverageMinutes = Math.max(
    0,
    overageMinutesAllTime - purchasedMinutesTotal,
  );

  return {
    month,
    includedMinutes,
    usedMinutes,
    includedRemainingMinutes: Math.max(0, includedMinutes - usedMinutes),
    overageMinutesThisMonth: Math.max(0, usedMinutes - includedMinutes),
    purchasedMinutesTotal,
    overageMinutesAllTime,
    purchasedMinutesRemaining,
    unpaidOverageMinutes,
    isOver: unpaidOverageMinutes > 0,
    isNearLimit: includedMinutes > 0 && usedMinutes >= 0.8 * includedMinutes,
  };
}
