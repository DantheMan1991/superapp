import {
  allotmentForMonth,
  monthOf,
  usedByMonth,
  type AllotmentChange,
} from "@/lib/retainer-core";

/**
 * The engagement's month — PURE, no database.
 *
 * Composed from the platform retainer's own pure helpers (src/lib/
 * retainer-core.ts): the same "newest allotment at or before the month" rule
 * and the same per-month grouping, because a retainer is a retainer whichever
 * side of the platform it sits on. What is NOT reused is that meter's
 * all-time overage: the platform sells hour blocks that soak overage up
 * across months, while an engagement bills its overage at a rate, month by
 * month, and each month stands alone.
 *
 * An engagement with no retainer minutes has no meter — nothing is "over"
 * when nothing was included. Its month is simply what was logged, and what
 * that comes to at the rate.
 */
export interface EngagementMonth {
  month: string;
  includedMinutes: number;
  usedMinutes: number;
  /** Included minus used, floored at zero; zero when there is no retainer. */
  remainingMinutes: number;
  /** Used beyond included; zero when there is no retainer. */
  overageMinutes: number;
  /** The overage at the rate. Null without a rate. */
  overageCents: number | null;
  /** Everything logged at the rate. Null without a rate. */
  usedCents: number | null;
  isOver: boolean;
  /** Four fifths of the retainer used, and not yet over. */
  isNearLimit: boolean;
}

/**
 * THE ONE PLACE THIS PACK DIVIDES. A rate is per hour and time is in minutes,
 * so a month's figure is (minutes × rate) ÷ 60, rounded to the cent ONCE, on
 * the month's total — never summed from per-entry roundings, which is how
 * sixty one-minute entries come to a cent more than an hour.
 */
export function minutesToCents(minutes: number, rateCents: number): number {
  return Math.round((minutes * rateCents) / 60);
}

export function meter(input: {
  month: string;
  usedMinutes: number;
  includedMinutes: number;
  rateCents: number | null;
}): EngagementMonth {
  const { month, usedMinutes, includedMinutes, rateCents } = input;
  const hasRetainer = includedMinutes > 0;
  const overageMinutes = hasRetainer ? Math.max(0, usedMinutes - includedMinutes) : 0;
  return {
    month,
    includedMinutes,
    usedMinutes,
    remainingMinutes: hasRetainer ? Math.max(0, includedMinutes - usedMinutes) : 0,
    overageMinutes,
    overageCents: rateCents === null ? null : minutesToCents(overageMinutes, rateCents),
    usedCents: rateCents === null ? null : minutesToCents(usedMinutes, rateCents),
    isOver: overageMinutes > 0,
    isNearLimit:
      hasRetainer && overageMinutes === 0 && usedMinutes >= 0.8 * includedMinutes,
  };
}

/** 'YYYY-MM' → the month after. */
export function monthAfter(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The first day of a month, and the first day of the next — a half-open range for a query. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${monthAfter(month)}-01` };
}

/**
 * Every month that has time or an allotment, through `through`, newest
 * first — the month-by-month table on an engagement's page. A month with an
 * allotment and no time is listed too: a retainer month nobody worked is
 * worth seeing.
 */
export function monthHistory(input: {
  entries: { workDate: string; minutes: number }[];
  allotments: AllotmentChange[];
  rateCents: number | null;
  through: string;
}): EngagementMonth[] {
  const used = new Map(usedByMonth(input.entries).map((m) => [m.month, m.minutes]));
  const months = new Set<string>(used.keys());
  // From the first allotment month to `through`, every month counts.
  const first = input.allotments
    .map((a) => a.effectiveMonth)
    .sort()
    .at(0);
  if (first) {
    for (let m = first; m <= input.through; m = monthAfter(m)) months.add(m);
  }
  return [...months]
    .filter((m) => m <= input.through)
    .sort()
    .reverse()
    .map((month) =>
      meter({
        month,
        usedMinutes: used.get(month) ?? 0,
        includedMinutes: allotmentForMonth(input.allotments, month),
        rateCents: input.rateCents,
      }),
    );
}

export { monthOf };
