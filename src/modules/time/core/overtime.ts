/**
 * The overtime evaluator. NO IMPORTS AND NO DIRECTIVE — pure arithmetic over
 * minutes, so it runs anywhere and is testable without a database.
 *
 * ── THE ONE THING TO UNDERSTAND ──────────────────────────────────────────────
 *
 * **The workweek is the unit of overtime. The pay period is the unit of
 * payment.** They are different, and they need not line up. A workweek is a
 * fixed, recurring 168 hours starting on a day the business picks; a pay period
 * is weekly, biweekly, semi-monthly or monthly. This function evaluates ONE
 * WORKWEEK and knows nothing about periods, because averaging hours across a
 * fortnight is the most common payroll error there is: 30 hours then 50 hours
 * is ten hours of overtime, not none.
 *
 * ── WHAT COUNTS ──────────────────────────────────────────────────────────────
 *
 * Only minutes actually WORKED reach this function. Paid leave and holiday are
 * on the paycheck and are not hours worked, so they never count toward the 40 —
 * `countsAsWorked` in `pay-types.ts` is the predicate, and the caller applies it
 * before calling here. Feeding leave in would overpay every week anybody takes
 * a day off.
 *
 * ── A RULESET IS DATA ────────────────────────────────────────────────────────
 *
 * Every jurisdictional difference is a value in `OvertimeRuleset`, never a
 * branch in this file. `rulesets.ts` holds the ones the product ships; a pack
 * (a union agreement, a prevailing-wage schedule) can supply its own without
 * core learning what a union is.
 *
 * ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────────
 *
 * It returns BUCKETS OF MINUTES, never money. The regular rate is not the base
 * rate — it folds in non-discretionary bonuses and shift differentials, and is
 * a weighted average when somebody has two rates in one week — and none of that
 * exists until rates do, in slice 5. Premiums that are money rather than time,
 * such as a missed meal break, arrive there too.
 *
 * The platform does not give legal advice: which ruleset applies is a choice
 * the business (or its advisor) makes, and the screen says so.
 */

/** A jurisdiction's rules, expressed entirely as numbers. */
export interface OvertimeRuleset {
  slug: string;
  label: string;
  /** What a reader is told they picked. One sentence, plain. */
  summary: string;
  /**
   * Minutes of straight time in one WORKWEEK after which hours are overtime.
   * Null means this jurisdiction has no weekly rule (nowhere does, today) or
   * the worker is exempt.
   */
  weeklyOvertimeAfter: number | null;
  /** Minutes in one DAY after which hours are overtime. Null = no daily rule. */
  dailyOvertimeAfter: number | null;
  /** Minutes in one DAY after which hours are double time. Null = none. */
  dailyDoubleTimeAfter: number | null;
  /**
   * What happens when every day of the workweek was worked. California pays
   * the seventh consecutive day at 1.5× for the first eight hours and 2×
   * beyond, which is `{ overtimeAfter: 0, doubleTimeAfter: 480 }`.
   */
  seventhDay: { overtimeAfter: number; doubleTimeAfter: number } | null;
}

export interface DayWorked {
  /** `yyyy-mm-dd`. */
  date: string;
  /** Minutes WORKED — leave and holiday already excluded by the caller. */
  workedMinutes: number;
}

export interface DayBuckets extends DayWorked {
  /** Minutes this day contributed at straight time, before the weekly test. */
  straightMinutes: number;
  /** Minutes this day earned at 1.5× by a DAILY rule. */
  dailyOvertimeMinutes: number;
  /** Minutes this day earned at 2× by a DAILY rule. */
  doubleTimeMinutes: number;
  /** True when this day was treated as the seventh consecutive day. */
  seventhDay: boolean;
}

export interface WeekBuckets {
  workedMinutes: number;
  /** Straight time that survived both the daily and the weekly test. */
  regularMinutes: number;
  /** Everything at 1.5×, daily and weekly together. */
  overtimeMinutes: number;
  /** Everything at 2×. */
  doubleTimeMinutes: number;
  /** The part of `overtimeMinutes` the WEEKLY threshold produced. */
  weeklyOvertimeMinutes: number;
  days: DayBuckets[];
}

/**
 * One worker, one workweek, one ruleset.
 *
 * `days` should be the seven days of the workweek in order, including the ones
 * with nothing on them — the seventh-day rule can only be answered by a caller
 * that knows a day was empty, so a caller that filtered them out would silently
 * turn that rule off.
 *
 * ── NO PYRAMIDING ────────────────────────────────────────────────────────────
 *
 * An hour already paid as daily overtime must not be counted again toward the
 * weekly 40. That is why each day contributes only its STRAIGHT minutes to the
 * weekly test, and why the weekly threshold is applied to that sum rather than
 * to hours worked. Miss it and a Californian working five ten-hour days is paid
 * fifty hours of overtime on a fifty-hour week.
 */
export function evaluateWeek(
  days: readonly DayWorked[],
  ruleset: OvertimeRuleset,
): WeekBuckets {
  const worked = days.filter((d) => d.workedMinutes > 0);
  /*
   * The seventh-day rule turns on only when EVERY day of the workweek was
   * worked, which is why this asks for seven and not "the last day present".
   */
  const seventhDayApplies =
    ruleset.seventhDay !== null && days.length === 7 && worked.length === 7;
  const seventhDayDate = seventhDayApplies ? days[days.length - 1].date : null;

  const evaluated: DayBuckets[] = days.map((day) => {
    const w = Math.max(0, day.workedMinutes);
    if (w === 0) {
      return {
        ...day,
        workedMinutes: 0,
        straightMinutes: 0,
        dailyOvertimeMinutes: 0,
        doubleTimeMinutes: 0,
        seventhDay: false,
      };
    }

    if (seventhDayDate !== null && day.date === seventhDayDate) {
      const rule = ruleset.seventhDay!;
      const dt = Math.max(0, w - rule.doubleTimeAfter);
      const ot = Math.max(0, Math.min(w, rule.doubleTimeAfter) - rule.overtimeAfter);
      return {
        ...day,
        workedMinutes: w,
        // Whatever the seventh-day rule does not price stays straight time —
        // zero under California's rule, and the shape holds if a jurisdiction
        // ever writes a gentler one.
        straightMinutes: w - ot - dt,
        dailyOvertimeMinutes: ot,
        doubleTimeMinutes: dt,
        seventhDay: true,
      };
    }

    const dtAfter = ruleset.dailyDoubleTimeAfter;
    const otAfter = ruleset.dailyOvertimeAfter;
    const dt = dtAfter === null ? 0 : Math.max(0, w - dtAfter);
    const ot =
      otAfter === null
        ? 0
        : Math.max(0, Math.min(w, dtAfter ?? Number.MAX_SAFE_INTEGER) - otAfter);

    return {
      ...day,
      workedMinutes: w,
      straightMinutes: w - ot - dt,
      dailyOvertimeMinutes: ot,
      doubleTimeMinutes: dt,
      seventhDay: false,
    };
  });

  const workedMinutes = evaluated.reduce((s, d) => s + d.workedMinutes, 0);
  const straight = evaluated.reduce((s, d) => s + d.straightMinutes, 0);
  const dailyOvertime = evaluated.reduce((s, d) => s + d.dailyOvertimeMinutes, 0);
  const doubleTime = evaluated.reduce((s, d) => s + d.doubleTimeMinutes, 0);

  const weeklyOvertime =
    ruleset.weeklyOvertimeAfter === null
      ? 0
      : Math.max(0, straight - ruleset.weeklyOvertimeAfter);

  return {
    workedMinutes,
    regularMinutes: straight - weeklyOvertime,
    overtimeMinutes: weeklyOvertime + dailyOvertime,
    doubleTimeMinutes: doubleTime,
    weeklyOvertimeMinutes: weeklyOvertime,
    days: evaluated,
  };
}

/**
 * How much more this worker can do this week before any of it is overtime.
 *
 * Null when the ruleset has no weekly threshold, or when the threshold is
 * already passed. What makes overtime a decision an owner takes on Tuesday
 * rather than a number they read after payroll — slice 8 puts it in front of
 * them; this is the arithmetic behind it.
 */
export function minutesUntilWeeklyOvertime(
  buckets: WeekBuckets,
  ruleset: OvertimeRuleset,
): number | null {
  if (ruleset.weeklyOvertimeAfter === null) return null;
  const straight = buckets.regularMinutes + buckets.weeklyOvertimeMinutes;
  const left = ruleset.weeklyOvertimeAfter - straight;
  return left > 0 ? left : null;
}

/**
 * How close is close enough to be worth telling somebody?
 *
 * **HALF A WORKING DAY.** On a forty-hour week that fires at thirty-six, which
 * lands on Friday morning for somebody doing eight-hour days and on Thursday
 * afternoon for somebody doing ten — a day's notice either way, which is what
 * makes it a decision rather than a report. Warning earlier would put an item in
 * front of an owner every Wednesday of every week and teach them to ignore it;
 * warning later is a message that arrives after the money is spent.
 */
export const OVERTIME_WARNING_MINUTES = 4 * 60;

/**
 * Minutes left before overtime starts, but ONLY once it is close.
 *
 * The threshold is the whole point: `minutesUntilWeeklyOvertime` is true of
 * every worker on a Monday morning, and a warning that is always on is not a
 * warning. Null means "not worth saying" — either the ruleset has no weekly
 * threshold, or the week is already over it, or there is plenty of room left.
 *
 * **A WEEK ALREADY IN OVERTIME RETURNS NULL, and that is deliberate.** This
 * answers "can you still do something about it", and once the hours are worked
 * nobody can; the pay period screen is where a week that went over is read.
 * An obligation you cannot discharge is not an obligation.
 */
export function approachingOvertime(
  buckets: WeekBuckets,
  ruleset: OvertimeRuleset,
): number | null {
  const left = minutesUntilWeeklyOvertime(buckets, ruleset);
  if (left === null || left > OVERTIME_WARNING_MINUTES) return null;
  return left;
}

/** Did this week produce anything above straight time? */
export function hasPremium(buckets: WeekBuckets): boolean {
  return buckets.overtimeMinutes > 0 || buckets.doubleTimeMinutes > 0;
}
