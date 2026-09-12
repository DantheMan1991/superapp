import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { TimeError } from "./core/errors";
import { isPayFrequency, type PayFrequency } from "./core/periods";
import { isRoundingChoice } from "./core/rounding";
import { DEFAULT_RULESET_SLUG, isRulesetSlug } from "./core/rulesets";

/**
 * The tenant's one Time setting. Read on every page, written from Settings.
 *
 * Sunday is the default because it is the most common workweek start in the US
 * and because `Date.prototype.getUTCDay()` already counts from it — but a
 * default is not an answer, which is why the screen asks rather than assuming
 * on the tenant's behalf. From slice 2 this is the anchor of the WORKWEEK, the
 * period overtime is computed over, and a wrong one there is a wrong paycheck.
 */

/** Sunday. Matches `time_settings.week_starts_on`'s column default. */
export const DEFAULT_WEEK_STARTS_ON = 0;

/** To the minute. Matches `time_settings.rounding_minutes`' column default. */
export const DEFAULT_ROUNDING_MINUTES = 0;

export interface TimePrefs {
  weekStartsOn: number;
  roundingMinutes: number;
  payFrequency: PayFrequency;
  periodAnchor: string | null;
  overtimeRuleset: string;
}

/**
 * READ-ONLY, AND SAFE FOR A READER WITH NO WRITE RIGHTS. A missing row means
 * the defaults — they live in the read rather than in a backfill, the shape
 * `notification_preferences` uses, so nobody has to be inserted before the page
 * can render.
 *
 * ONE READ FOR BOTH, because every screen that wants the week start also wants
 * the rounding: the clock panel shows what a punch will be rounded to and the
 * week groups by the start day. Two functions meant two round trips for one
 * row.
 */
export async function getTimePrefs(tx: Tx, tenantId: string): Promise<TimePrefs> {
  const row = await tx.query.timeSettings.findFirst({
    where: eq(schema.timeSettings.tenantId, tenantId),
  });
  return {
    weekStartsOn: row?.weekStartsOn ?? DEFAULT_WEEK_STARTS_ON,
    roundingMinutes: row?.roundingMinutes ?? DEFAULT_ROUNDING_MINUTES,
    payFrequency: (row?.payFrequency as PayFrequency) ?? "weekly",
    periodAnchor: row?.periodAnchor ?? null,
    overtimeRuleset: row?.overtimeRuleset ?? DEFAULT_RULESET_SLUG,
  };
}

export async function setWeekStartsOn(
  tx: Tx,
  tenantId: string,
  weekStartsOn: number,
): Promise<void> {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new TimeError("WEEK_START_INVALID", "week must start on a real day");
  }
  /*
   * Upsert on the tenant's unique index rather than select-then-insert: two
   * owners saving at once would otherwise race to insert the same row and one
   * would get a constraint violation instead of a saved setting.
   */
  await tx
    .insert(schema.timeSettings)
    .values({ tenantId, weekStartsOn })
    .onConflictDoUpdate({
      target: schema.timeSettings.tenantId,
      set: { weekStartsOn, updatedAt: new Date() },
      where: and(eq(schema.timeSettings.tenantId, tenantId)),
    });
}

export async function setRoundingMinutes(
  tx: Tx,
  tenantId: string,
  roundingMinutes: number,
): Promise<void> {
  if (!isRoundingChoice(roundingMinutes)) {
    throw new TimeError("ROUNDING_INVALID", "not a rounding option");
  }
  await tx
    .insert(schema.timeSettings)
    .values({ tenantId, roundingMinutes })
    .onConflictDoUpdate({
      target: schema.timeSettings.tenantId,
      set: { roundingMinutes, updatedAt: new Date() },
      where: and(eq(schema.timeSettings.tenantId, tenantId)),
    });
}

/**
 * How often people are paid, and — for biweekly only — which fortnight it is.
 *
 * THE ANCHOR IS CLEARED BY EVERY OTHER FREQUENCY, which the CHECK on the table
 * also insists on. An anchor left behind after a switch to monthly would sit
 * there meaning nothing until somebody switched back and found their periods
 * landing on a boundary they had forgotten choosing.
 */
export async function setPayFrequency(
  tx: Tx,
  tenantId: string,
  frequency: string,
  anchor: string | null,
): Promise<void> {
  if (!isPayFrequency(frequency)) {
    throw new TimeError("PAY_FREQUENCY_INVALID", "not a pay frequency");
  }
  if (frequency === "biweekly" && !anchor) {
    throw new TimeError("PERIOD_ANCHOR_REQUIRED", "biweekly needs a starting date");
  }
  const periodAnchor = frequency === "biweekly" ? anchor : null;
  await tx
    .insert(schema.timeSettings)
    .values({ tenantId, payFrequency: frequency, periodAnchor })
    .onConflictDoUpdate({
      target: schema.timeSettings.tenantId,
      set: { payFrequency: frequency, periodAnchor, updatedAt: new Date() },
      where: and(eq(schema.timeSettings.tenantId, tenantId)),
    });
}

export async function setOvertimeRuleset(
  tx: Tx,
  tenantId: string,
  slug: string,
): Promise<void> {
  if (!isRulesetSlug(slug)) {
    throw new TimeError("RULESET_INVALID", "not an overtime ruleset");
  }
  await tx
    .insert(schema.timeSettings)
    .values({ tenantId, overtimeRuleset: slug })
    .onConflictDoUpdate({
      target: schema.timeSettings.tenantId,
      set: { overtimeRuleset: slug, updatedAt: new Date() },
      where: and(eq(schema.timeSettings.tenantId, tenantId)),
    });
}
