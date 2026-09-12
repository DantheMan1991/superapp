import "server-only";
import { and, asc, eq, isNull, lte, gte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { TimeError, violatedUniqueIndex } from "./core/errors";
import { countsAsPaid, countsAsWorked } from "./core/pay-types";
import { evaluateWeek } from "./core/overtime";
import { groupByRate, payForWeek } from "./core/pay";
import { rulesetFor } from "./core/rulesets";
import { listRates } from "./rate-ops";
import {
  adjacentPayPeriod,
  payPeriodFor,
  workweeksPaidIn,
  type PayFrequency,
  type PayPeriod,
} from "./core/periods";
import { weekDays } from "./core/week";
import { listEntries } from "./read";

/**
 * Submitting, approving and locking. ONE WRITER per table; every function takes
 * the caller's `tx` and never opens its own.
 *
 * ── WHAT LOCKING IS FOR ──────────────────────────────────────────────────────
 *
 * Until a period is locked, every figure in this module is live: somebody can
 * still edit Tuesday after the pay run quoted it. Locking is the moment the
 * hours stop moving, and it is what makes an approval mean anything.
 *
 * ── AND WHAT IT COSTS ────────────────────────────────────────────────────────
 *
 * A locked period's entries are immutable. The way to put one right is an
 * AMENDMENT: a new entry in the open period carrying the difference and
 * pointing back at the original (`time_entries.amends_entry_id`). Paid history
 * is never rewritten, so the record still says what the pay run actually saw.
 * `assertPeriodOpen` is the guard, and it is the shape accounting's guard of
 * the same name already has.
 */

/**
 * Refuse to write on a day inside a locked pay period.
 *
 * Takes the DATE rather than a period, because every caller has one and none of
 * them should have to work out which period it falls in — that is exactly the
 * knowledge this function exists to hold. A day with no row is open: periods
 * only get a row when they are first locked.
 */
export async function assertPeriodOpen(
  tx: Tx,
  tenantId: string,
  workDate: string,
): Promise<void> {
  const locked = await tx.query.timePeriods.findFirst({
    where: and(
      eq(schema.timePeriods.tenantId, tenantId),
      lte(schema.timePeriods.startsOn, workDate),
      gte(schema.timePeriods.endsOn, workDate),
    ),
    columns: { startsOn: true, endsOn: true, lockedAt: true },
  });
  if (locked?.lockedAt) {
    throw new TimeError(
      "PERIOD_LOCKED",
      `pay period ${locked.startsOn}–${locked.endsOn} is locked`,
    );
  }
}

export interface SheetTotals {
  workedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  doubleTimeMinutes: number;
  paidLeaveMinutes: number;
  rulesetSlug: string;
  /**
   * What the period is worth, in cents. NULL when there are no rates — which
   * covers both "this business keeps none" and "this reader may not see them",
   * and nothing downstream should try to tell those apart.
   */
  grossCents: number | null;
}

/**
 * What one worker's period comes to, worked out the way the pay period screen
 * works it out: **week by week, each tested against the rules on its own.**
 *
 * Shared with that screen on purpose. A snapshot that disagreed with the figure
 * the approver was looking at when they pressed the button would be the worst
 * possible kind of bug — silent, and only visible in a pay run.
 */
export async function totalsFor(
  tx: Tx,
  tenantId: string,
  workerId: string,
  period: PayPeriod,
  prefs: { weekStartsOn: number; overtimeRuleset: string },
): Promise<SheetTotals> {
  const weeks = workweeksPaidIn(period, prefs.weekStartsOn);
  const ruleset = rulesetFor(prefs.overtimeRuleset);
  if (weeks.length === 0) {
    return {
      workedMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      doubleTimeMinutes: 0,
      paidLeaveMinutes: 0,
      rulesetSlug: ruleset.slug,
      grossCents: null,
    };
  }

  const rows = await listEntries(tx, tenantId, {
    from: weeks[0].start,
    to: weeks[weeks.length - 1].end,
    workerId,
  });

  /*
   * Rates come back empty for a reader who may not see them (the policy carries
   * `app_current_tenant_role() = 'owner'`), and that is the same answer as a
   * business with none: no money figure. Only owners approve, so the snapshot
   * taken at approval is always computed by somebody who could see them.
   */
  const rates = (await listRates(tx, tenantId))
    .filter((r) => r.workerId === workerId)
    .map((r) => ({ effectiveOn: r.effectiveOn, payRateCents: r.payRateCents }));

  const totals: SheetTotals = {
    workedMinutes: 0,
    regularMinutes: 0,
    overtimeMinutes: 0,
    doubleTimeMinutes: 0,
    paidLeaveMinutes: 0,
    rulesetSlug: ruleset.slug,
    grossCents: rates.length > 0 ? 0 : null,
  };
  for (const week of weeks) {
    const buckets = evaluateWeek(
      weekDays(week.start).map((date) => ({
        date,
        workedMinutes: rows
          .filter((r) => r.workDate === date && countsAsWorked(r.payType))
          .reduce((s, r) => s + r.minutes, 0),
      })),
      ruleset,
    );
    totals.workedMinutes += buckets.workedMinutes;
    totals.regularMinutes += buckets.regularMinutes;
    totals.overtimeMinutes += buckets.overtimeMinutes;
    totals.doubleTimeMinutes += buckets.doubleTimeMinutes;
    const leaveRows = rows.filter(
      (r) =>
        r.workDate >= week.start &&
        r.workDate <= week.end &&
        countsAsPaid(r.payType) &&
        !countsAsWorked(r.payType),
    );
    totals.paidLeaveMinutes += leaveRows.reduce((s, r) => s + r.minutes, 0);

    /*
     * MONEY IS WORKED OUT PER WEEK, for the same reason overtime is: the
     * regular rate is a weighted average over ONE workweek, and averaging a
     * fortnight would price a raise that happened in the middle of it wrongly
     * for both halves.
     */
    if (totals.grossCents !== null) {
      const workedRows = rows.filter(
        (r) =>
          r.workDate >= week.start &&
          r.workDate <= week.end &&
          countsAsWorked(r.payType),
      );
      totals.grossCents += payForWeek({
        worked: groupByRate(workedRows, rates),
        overtimeMinutes: buckets.overtimeMinutes,
        doubleTimeMinutes: buckets.doubleTimeMinutes,
        leave: groupByRate(leaveRows, rates),
      }).grossCents;
    }
  }
  return totals;
}

/** Hand one worker's period over for approval. */
export async function submitSheet(
  tx: Tx,
  tenantId: string,
  input: { workerId: string; period: PayPeriod; actorClerkUserId: string },
): Promise<string> {
  const worker = await tx.query.timeWorkers.findFirst({
    where: and(
      eq(schema.timeWorkers.tenantId, tenantId),
      eq(schema.timeWorkers.id, input.workerId),
    ),
  });
  if (!worker) throw new TimeError("WORKER_NOT_FOUND", "no such worker");

  /*
   * The unique index is the arbiter, not a preceding SELECT: two people
   * pressing Submit at once would otherwise both see nothing and both insert.
   */
  try {
    const [row] = await tx
      .insert(schema.timeSheets)
      .values({
        tenantId,
        workerId: input.workerId,
        periodStartsOn: input.period.start,
        periodEndsOn: input.period.end,
        submittedByClerkUserId: input.actorClerkUserId,
      })
      .returning({ id: schema.timeSheets.id });
    return row.id;
  } catch (err) {
    if (violatedUniqueIndex(err) === "time_sheets_tenant_worker_period_idx") {
      throw new TimeError("SHEET_EXISTS", "already submitted for this period");
    }
    throw err;
  }
}

/**
 * Agree one worker's period, and freeze what was agreed.
 *
 * The snapshot is computed HERE rather than passed in from the screen. A
 * caller-supplied total is a number the server never checked, and this one
 * decides what somebody is paid.
 */
export async function approveSheet(
  tx: Tx,
  tenantId: string,
  input: {
    sheetId: string;
    expectedVersion: number;
    actorClerkUserId: string;
    prefs: { weekStartsOn: number; overtimeRuleset: string };
  },
): Promise<SheetTotals> {
  const sheet = await loadSheet(tx, tenantId, input.sheetId);
  if (sheet.approvedAt) {
    throw new TimeError("SHEET_ALREADY_APPROVED", "already approved");
  }

  const totals = await totalsFor(
    tx,
    tenantId,
    sheet.workerId,
    { start: sheet.periodStartsOn, end: sheet.periodEndsOn },
    input.prefs,
  );

  const result = await tx
    .update(schema.timeSheets)
    .set({
      approvedAt: new Date(),
      approvedByClerkUserId: input.actorClerkUserId,
      ...totals,
      version: sql`${schema.timeSheets.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.timeSheets.tenantId, tenantId),
        eq(schema.timeSheets.id, input.sheetId),
        eq(schema.timeSheets.version, input.expectedVersion),
        isNull(schema.timeSheets.approvedAt),
      ),
    )
    .returning({ id: schema.timeSheets.id });

  if (result.length === 0) {
    throw new TimeError("STALE_VERSION", "sheet changed underneath");
  }
  return totals;
}

/**
 * Send a sheet back. The row goes, so the period reads as never submitted.
 *
 * A DELETE rather than a status, because "returned" is not a state anybody acts
 * on — the person fixes the hours and submits again. Keeping a returned row
 * would mean the attention source had to learn to ignore it, and the unique
 * index would have to be taught that a returned sheet does not count.
 */
export async function returnSheet(
  tx: Tx,
  tenantId: string,
  sheetId: string,
): Promise<void> {
  const result = await tx
    .delete(schema.timeSheets)
    .where(
      and(
        eq(schema.timeSheets.tenantId, tenantId),
        eq(schema.timeSheets.id, sheetId),
        isNull(schema.timeSheets.approvedAt),
      ),
    )
    .returning({ id: schema.timeSheets.id });
  if (result.length === 0) {
    const still = await tx.query.timeSheets.findFirst({
      where: and(
        eq(schema.timeSheets.tenantId, tenantId),
        eq(schema.timeSheets.id, sheetId),
      ),
    });
    throw still
      ? new TimeError("SHEET_ALREADY_APPROVED", "approved sheets are not returned")
      : new TimeError("SHEET_NOT_FOUND", "no such timesheet");
  }
}

/**
 * Stop the hours in a period from moving. Creates the row if it is the first time.
 *
 * Returns the row's id, because that is what a journal entry points at when the
 * period's labor is accrued (`journal_entries.source_id`). This function still
 * writes one table and nothing else; posting is the caller's move.
 */
export async function lockPeriod(
  tx: Tx,
  tenantId: string,
  period: PayPeriod,
  actorClerkUserId: string,
): Promise<string> {
  const rows = await tx
    .insert(schema.timePeriods)
    .values({
      tenantId,
      startsOn: period.start,
      endsOn: period.end,
      lockedAt: new Date(),
      lockedByClerkUserId: actorClerkUserId,
    })
    .onConflictDoUpdate({
      target: [schema.timePeriods.tenantId, schema.timePeriods.startsOn],
      set: {
        endsOn: period.end,
        lockedAt: new Date(),
        lockedByClerkUserId: actorClerkUserId,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.timePeriods.id });
  return rows[0].id;
}

/**
 * Let the hours move again.
 *
 * The row stays, with `locked_at` nulled: it is the record that this period has
 * been through a pay run at least once, which is worth knowing even while it is
 * open. Who unlocked it is in `audit_log`.
 */
export async function unlockPeriod(
  tx: Tx,
  tenantId: string,
  periodStart: string,
): Promise<string> {
  const result = await tx
    .update(schema.timePeriods)
    .set({
      lockedAt: null,
      lockedByClerkUserId: null,
      version: sql`${schema.timePeriods.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.timePeriods.tenantId, tenantId),
        eq(schema.timePeriods.startsOn, periodStart),
      ),
    )
    .returning({ id: schema.timePeriods.id });
  if (result.length === 0) {
    throw new TimeError("PERIOD_NOT_LOCKED", "that period is not locked");
  }
  return result[0].id;
}

/** Every sheet in one period, oldest submission first. */
export async function listSheets(
  tx: Tx,
  tenantId: string,
  period: PayPeriod,
) {
  return await tx
    .select()
    .from(schema.timeSheets)
    .where(
      and(
        eq(schema.timeSheets.tenantId, tenantId),
        eq(schema.timeSheets.periodStartsOn, period.start),
      ),
    )
    .orderBy(asc(schema.timeSheets.submittedAt));
}

/** The lock row for a period, when there is one. */
export async function getPeriodLock(
  tx: Tx,
  tenantId: string,
  periodStart: string,
) {
  return (
    (await tx.query.timePeriods.findFirst({
      where: and(
        eq(schema.timePeriods.tenantId, tenantId),
        eq(schema.timePeriods.startsOn, periodStart),
      ),
    })) ?? null
  );
}

async function loadSheet(tx: Tx, tenantId: string, sheetId: string) {
  const row = await tx.query.timeSheets.findFirst({
    where: and(
      eq(schema.timeSheets.tenantId, tenantId),
      eq(schema.timeSheets.id, sheetId),
    ),
  });
  if (!row) throw new TimeError("SHEET_NOT_FOUND", "no such timesheet");
  return row;
}

/**
 * The locked periods overlapping a span of days.
 *
 * What lets a screen know, before it draws anything, which days cannot be
 * edited. Without it the week would offer an Edit button on every row and
 * refuse half the presses — the exact shape of the six bugs the permissions
 * sweep of 2026-09-04 found.
 */
export async function listLockedPeriods(
  tx: Tx,
  tenantId: string,
  range: { from: string; to: string },
): Promise<{ startsOn: string; endsOn: string }[]> {
  const rows = await tx
    .select({
      startsOn: schema.timePeriods.startsOn,
      endsOn: schema.timePeriods.endsOn,
    })
    .from(schema.timePeriods)
    .where(
      and(
        eq(schema.timePeriods.tenantId, tenantId),
        lte(schema.timePeriods.startsOn, range.to),
        gte(schema.timePeriods.endsOn, range.from),
        sql`${schema.timePeriods.lockedAt} is not null`,
      ),
    );
  return rows;
}

/**
 * The first day, at or after `from`, that sits in a period nobody has locked.
 *
 * WHERE A CORRECTION GOES. "Today" is the obvious answer and it is wrong
 * whenever the business has locked the period it is currently in — which is
 * exactly what happens when payroll is run on the last day of the period.
 * Found by driving slice 3: the correction dialog offered today, and today was
 * inside the locked fortnight, so every amendment would have been refused by
 * the guard that had just been added.
 *
 * Walks forward a period at a time. Bounded, because an unbounded loop over a
 * misconfigured anchor is a hung request rather than a wrong answer.
 */
export async function firstOpenDay(
  tx: Tx,
  tenantId: string,
  from: string,
  prefs: { frequency: PayFrequency; weekStartsOn: number; anchor: string | null },
): Promise<string> {
  let period = payPeriodFor(from, prefs);
  for (let i = 0; i < 24; i++) {
    const lock = await getPeriodLock(tx, tenantId, period.start);
    if (!lock?.lockedAt) {
      // Inside the first open period, the earliest sensible day is `from`
      // itself when it falls there, and the period's first day otherwise.
      return from > period.start && from <= period.end ? from : period.start;
    }
    period = adjacentPayPeriod(period, 1, prefs);
  }
  return period.start;
}
