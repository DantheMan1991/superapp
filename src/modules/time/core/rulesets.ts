/**
 * The overtime rulesets the product ships, as DATA. NO IMPORTS beyond the types
 * — the picker renders these in the browser.
 *
 * Every jurisdictional difference below is a number, not a branch. That is the
 * whole claim of `overtime.ts`, and the reason California is here in slice 2
 * rather than being promised for later: a second ruleset that required no code
 * is the only proof the first one was designed right.
 *
 * ── THIS IS NOT LEGAL ADVICE ─────────────────────────────────────────────────
 *
 * Which ruleset applies to a business is the business's decision, taken with
 * whoever does its payroll. The product records the choice and does the
 * arithmetic; it does not know where anybody works, and the screen says so.
 *
 * ── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────────
 *
 * Money. A missed-meal-break premium is an hour's PAY, not an hour, so it
 * belongs with rates in slice 5 and not in a table of minute thresholds. The
 * `8/80` rule for healthcare needs a 14-day window rather than a workweek, so
 * it needs a change to the evaluator's shape and waits for somebody who needs
 * it. Adding either as a half-measure here would make this file lie about what
 * it can express.
 */
import type { OvertimeRuleset } from "./overtime";

const HOURS = (h: number) => h * 60;

/**
 * The federal floor (FLSA): over 40 hours in a workweek is time and a half.
 * No daily rule, no seventh-day rule. Right everywhere in the US as a minimum,
 * and right on its own in most states.
 */
export const FEDERAL: OvertimeRuleset = {
  slug: "federal",
  label: "Federal (over 40 in a week)",
  summary:
    "Anything over 40 hours worked in one week is overtime. The federal minimum, and all that most states add to.",
  weeklyOvertimeAfter: HOURS(40),
  dailyOvertimeAfter: null,
  dailyDoubleTimeAfter: null,
  seventhDay: null,
};

/**
 * California, which is the ruleset that forces the evaluator's shape: a daily
 * threshold, a double-time threshold, and a seventh-consecutive-day rule that
 * prices a whole day differently.
 */
export const CALIFORNIA: OvertimeRuleset = {
  slug: "california",
  label: "California (daily and weekly)",
  summary:
    "Over 8 hours in a day or 40 in a week is overtime; over 12 in a day is double time; the seventh day worked in a week pays overtime for 8 hours and double time beyond.",
  weeklyOvertimeAfter: HOURS(40),
  dailyOvertimeAfter: HOURS(8),
  dailyDoubleTimeAfter: HOURS(12),
  seventhDay: { overtimeAfter: 0, doubleTimeAfter: HOURS(8) },
};

/**
 * No overtime at all.
 *
 * For a business whose people are all salaried and exempt, and the setting a
 * business picks when it wants hours tracked for cost and billing and wants the
 * product to stay out of the pay question. Exempt-per-person is a flag on the
 * worker and arrives with rates in slice 5; this is the whole-business answer.
 */
export const NONE: OvertimeRuleset = {
  slug: "none",
  label: "None — no overtime rules",
  summary:
    "Hours are recorded and totalled, and none of them are ever marked as overtime.",
  weeklyOvertimeAfter: null,
  dailyOvertimeAfter: null,
  dailyDoubleTimeAfter: null,
  seventhDay: null,
};

export const RULESETS: readonly OvertimeRuleset[] = [FEDERAL, CALIFORNIA, NONE];

/** What a tenant gets before anyone chooses. The federal floor. */
export const DEFAULT_RULESET_SLUG = FEDERAL.slug;

export function isRulesetSlug(slug: string): boolean {
  return RULESETS.some((r) => r.slug === slug);
}

/**
 * Look a ruleset up, falling back to the federal floor.
 *
 * FALLS BACK RATHER THAN THROWS, on purpose: a row naming a ruleset this build
 * does not have is a deploy that went backwards, and answering that week with
 * the federal minimum is better than a screen that will not render. The value
 * is CHECKed in the database, so the case is close to unreachable.
 */
export function rulesetFor(slug: string): OvertimeRuleset {
  return RULESETS.find((r) => r.slug === slug) ?? FEDERAL;
}
