import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { schema } from "@/db";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";
import type { Tx } from "@/db";
import {
  approveSheetFromAttentionAction,
  submitSheetFromAttentionAction,
} from "./actions";
import { formatDuration } from "../core/duration";
import { roleMayApprove } from "../core/errors";
import { approachingOvertime, evaluateWeek } from "../core/overtime";
import { PAY_TYPES, countsAsWorked } from "../core/pay-types";
import { adjacentPayPeriod, payPeriodFor, periodLabel } from "../core/periods";
import { LONG_PUNCH_MINUTES } from "../core/rounding";
import { rulesetFor } from "../core/rulesets";
import { weekDays } from "../core/week";
import { getTimePrefs } from "../settings-ops";
import { startOfWeek, addDays } from "@/lib/timezone";

/**
 * What Time owes a person. Four obligations, and every one of them SELF-CLEARS
 * by the thing that discharges it — approving the sheet, stopping the clock,
 * sending somebody home, pressing submit.
 *
 * ── THE PERFORMANCE WORRY SLICE 3 WROTE DOWN, AND HOW IT IS ANSWERED ─────────
 *
 * The first version of this file said the overtime warning "needs the evaluator
 * run per worker per week, which is too much to do inside a digest that already
 * asks six sources for their answers". That is true of the shape it was
 * imagining — a query per worker — and false of the one built here.
 *
 * **ONE aggregate query returns the whole business's worked minutes per worker
 * per day for the current week**, and `evaluateWeek` is then pure arithmetic
 * over at most seven numbers per person. Nothing here runs a query inside a
 * loop; the whole source is a fixed handful of round trips whatever the head
 * count, which is the property that makes it safe in a digest.
 *
 * ── WHO GETS TOLD WHAT, AND WHY IT DIFFERS PER ITEM ──────────────────────────
 *
 * `deliverTo` below is the one place that decides. The rule is not "whoever is
 * interested" but **whoever can actually do the thing**:
 *
 *  - **Waiting for approval** → owners. Approving is theirs (`roleMayApprove`).
 *  - **Approaching overtime** → OWNERS ONLY, even when the worker has a login.
 *    Deciding to send somebody home an hour early is the person paying for the
 *    hour; telling the worker would be telling them about somebody else's
 *    decision, and telling both would report one fact twice.
 *  - **A clock left running** and **hours not sent** → the WORKER when they have
 *    a sign-in, because it is theirs to fix; rolled up to the owner as
 *    `unassigned` when they do not. That is the contract's own answer to work
 *    that is assigned to nobody, and the barn worker with no login is exactly
 *    the case it was written for.
 */

/** A queue is not a deadline; a long one is still not late. */
const MAX_ITEMS = 25;

/**
 * Derived from the predicate rather than written out, so SQL and
 * `countsAsWorked` cannot drift. A pay type that stops counting toward the 40
 * changes one function and this query follows.
 */
const WORKED_PAY_TYPES = PAY_TYPES.filter(countsAsWorked);

/**
 * Whose item this is, or null when this reader should not be told at all.
 *
 * `unassigned` is the contract's flag for "this reached you because it is
 * nobody's and you are the owner", which the renderer groups on — so an owner
 * can tell "you owe this" from "nobody owes this yet".
 */
function deliverTo(
  workerClerkUserId: string | null,
  ctx: AttentionCtx,
): { unassigned: boolean } | null {
  if (workerClerkUserId && workerClerkUserId === ctx.userId) {
    return { unassigned: false };
  }
  if (workerClerkUserId) return null; // it is somebody else's, and they can see it
  return roleMayApprove(ctx.role) ? { unassigned: true } : null;
}

/** Timesheets submitted and waiting for an owner. */
async function pendingSheets(
  tx: Tx,
  ctx: AttentionCtx,
): Promise<AttentionItem[]> {
  if (!roleMayApprove(ctx.role)) return [];

  const rows = await tx
    .select({
      id: schema.timeSheets.id,
      version: schema.timeSheets.version,
      periodStartsOn: schema.timeSheets.periodStartsOn,
      periodEndsOn: schema.timeSheets.periodEndsOn,
      submittedAt: schema.timeSheets.submittedAt,
      workerName: schema.parties.displayName,
    })
    .from(schema.timeSheets)
    .innerJoin(
      schema.timeWorkers,
      and(
        eq(schema.timeWorkers.tenantId, schema.timeSheets.tenantId),
        eq(schema.timeWorkers.id, schema.timeSheets.workerId),
      ),
    )
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.timeWorkers.tenantId),
        eq(schema.parties.id, schema.timeWorkers.partyId),
      ),
    )
    .where(
      and(
        eq(schema.timeSheets.tenantId, ctx.tenantId),
        isNull(schema.timeSheets.approvedAt),
      ),
    )
    .orderBy(asc(schema.timeSheets.submittedAt))
    .limit(MAX_ITEMS);

  return rows.map((row) => ({
    key: `time_sheet:${row.id}`,
    title: `${row.workerName}'s hours are waiting for you`,
    detail: periodLabel({ start: row.periodStartsOn, end: row.periodEndsOn }),
    urgency: "soon" as const,
    dueOn: null,
    href: `/dashboard/m/time/pay?on=${row.periodStartsOn}`,
    action: {
      kind: "time.sheet.approve",
      label: "Approve",
      done: "Approved",
      // The version rides along so a concurrent edit is refused rather than
      // approved blind — exactly what the contract asks the args to carry.
      args: { sheetId: row.id, expectedVersion: row.version },
    },
  }));
}

/**
 * A clock that has been running longer than anybody works in one stretch.
 *
 * `LONG_PUNCH_MINUTES` is the clock panel's own threshold, reused rather than
 * reinvented: sixteen hours is a punch that has crossed a night, which is
 * somebody who forgot rather than somebody still working. Below it there is
 * nothing to say — a clock running for nine hours is a clock doing its job, and
 * an item about it would fire on every full day anybody works.
 *
 * **OVERDUE, not `soon`.** Unlike a queue, this one has already gone wrong:
 * every hour it keeps running is an hour that will have to be corrected by
 * hand, and the correction gets harder once the period locks.
 */
async function runningClocks(
  tx: Tx,
  ctx: AttentionCtx,
): Promise<AttentionItem[]> {
  const rows = await tx
    .select({
      id: schema.timePunches.id,
      startedAt: schema.timePunches.startedAt,
      deviceLabel: schema.timePunches.deviceLabel,
      workerName: schema.parties.displayName,
      workerClerkUserId: schema.timeWorkers.clerkUserId,
    })
    .from(schema.timePunches)
    .innerJoin(
      schema.timeWorkers,
      and(
        eq(schema.timeWorkers.tenantId, schema.timePunches.tenantId),
        eq(schema.timeWorkers.id, schema.timePunches.workerId),
      ),
    )
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.timeWorkers.tenantId),
        eq(schema.parties.id, schema.timeWorkers.partyId),
      ),
    )
    .where(
      and(
        eq(schema.timePunches.tenantId, ctx.tenantId),
        isNull(schema.timePunches.endedAt),
      ),
    )
    .orderBy(asc(schema.timePunches.startedAt))
    .limit(MAX_ITEMS);

  const now = Date.now();
  const items: AttentionItem[] = [];
  for (const row of rows) {
    const minutes = Math.floor((now - row.startedAt.getTime()) / 60000);
    if (minutes < LONG_PUNCH_MINUTES) continue;
    const to = deliverTo(row.workerClerkUserId, ctx);
    if (!to) continue;
    items.push({
      key: `time_punch:${row.id}`,
      title: row.workerClerkUserId
        ? `Your clock has been running for ${formatDuration(minutes)}`
        : `${row.workerName}'s clock has been running for ${formatDuration(minutes)}`,
      detail: row.deviceLabel
        ? `Started on ${row.deviceLabel}. Stop it, then put the times right.`
        : "Stop it, then put the times right.",
      urgency: "overdue" as const,
      dueOn: null,
      href: "/dashboard/m/time",
      unassigned: to.unassigned || undefined,
    });
  }
  return items;
}

/**
 * Somebody about to cross into overtime, while there is still a decision to
 * take about it.
 *
 * **ONE QUERY FOR THE WHOLE BUSINESS**, grouped by worker and day, then pure
 * arithmetic. `approachingOvertime` decides what counts as close and returns
 * null once the week is already over — an obligation nobody can discharge is
 * not an obligation, and a week that went over is read on the pay period
 * screen, not here.
 */
async function nearOvertime(
  tx: Tx,
  ctx: AttentionCtx,
  prefs: { weekStartsOn: number; overtimeRuleset: string },
): Promise<AttentionItem[]> {
  if (!roleMayApprove(ctx.role)) return [];
  const ruleset = rulesetFor(prefs.overtimeRuleset);
  if (ruleset.weeklyOvertimeAfter === null) return [];

  const weekStart = startOfWeek(ctx.today, prefs.weekStartsOn);
  const weekEnd = addDays(weekStart, 6);

  const rows = await tx
    .select({
      workerId: schema.timeEntries.workerId,
      workDate: schema.timeEntries.workDate,
      minutes: sql<number>`sum(${schema.timeEntries.minutes})::int`,
    })
    .from(schema.timeEntries)
    .where(
      and(
        eq(schema.timeEntries.tenantId, ctx.tenantId),
        gte(schema.timeEntries.workDate, weekStart),
        lte(schema.timeEntries.workDate, weekEnd),
        inArray(schema.timeEntries.payType, WORKED_PAY_TYPES),
      ),
    )
    .groupBy(schema.timeEntries.workerId, schema.timeEntries.workDate);

  const byWorker = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const days = byWorker.get(row.workerId) ?? new Map<string, number>();
    days.set(row.workDate, row.minutes);
    byWorker.set(row.workerId, days);
  }

  const dates = weekDays(weekStart);
  const close: Array<{ workerId: string; left: number }> = [];
  for (const [workerId, days] of byWorker) {
    const buckets = evaluateWeek(
      dates.map((date) => ({ date, workedMinutes: days.get(date) ?? 0 })),
      ruleset,
    );
    const left = approachingOvertime(buckets, ruleset);
    if (left !== null) close.push({ workerId, left });
  }
  if (close.length === 0) return [];

  // Names for the few who matter, not for everybody. Runs at all only when
  // somebody is close, which on most weeks is nobody.
  const names = await tx
    .select({
      id: schema.timeWorkers.id,
      name: schema.parties.displayName,
    })
    .from(schema.timeWorkers)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.timeWorkers.tenantId),
        eq(schema.parties.id, schema.timeWorkers.partyId),
      ),
    )
    .where(
      and(
        eq(schema.timeWorkers.tenantId, ctx.tenantId),
        inArray(
          schema.timeWorkers.id,
          close.map((c) => c.workerId),
        ),
      ),
    );
  const nameOf = new Map(names.map((n) => [n.id, n.name]));

  return close
    .sort((a, b) => a.left - b.left)
    .slice(0, MAX_ITEMS)
    .map((c) => ({
      key: `time_overtime:${c.workerId}:${weekStart}`,
      title: `${nameOf.get(c.workerId) ?? "Somebody"} is ${formatDuration(c.left)} from overtime`,
      detail: `This week, to ${weekEnd}. Anything past it is paid at a premium.`,
      // A decision for today, not a deadline: the week has not gone wrong yet.
      urgency: "today" as const,
      dueOn: weekEnd,
      href: `/dashboard/m/time?on=${weekStart}`,
    }));
}

/**
 * A pay period that has ENDED with hours in it and no timesheet sent.
 *
 * The previous period, never the current one: asking somebody to submit a week
 * they are still working is asking them to do it twice. It appears the day the
 * period ends and disappears the moment they press the button, which is the
 * whole shape this contract is for.
 */
async function unsentHours(
  tx: Tx,
  ctx: AttentionCtx,
  prefs: {
    weekStartsOn: number;
    payFrequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
    periodAnchor: string | null;
  },
): Promise<AttentionItem[]> {
  const settings = {
    frequency: prefs.payFrequency,
    weekStartsOn: prefs.weekStartsOn,
    anchor: prefs.periodAnchor,
  };
  const period = adjacentPayPeriod(
    payPeriodFor(ctx.today, settings),
    -1,
    settings,
  );

  const worked = await tx
    .selectDistinct({ workerId: schema.timeEntries.workerId })
    .from(schema.timeEntries)
    .where(
      and(
        eq(schema.timeEntries.tenantId, ctx.tenantId),
        gte(schema.timeEntries.workDate, period.start),
        lte(schema.timeEntries.workDate, period.end),
      ),
    );
  if (worked.length === 0) return [];

  const sent = await tx
    .select({ workerId: schema.timeSheets.workerId })
    .from(schema.timeSheets)
    .where(
      and(
        eq(schema.timeSheets.tenantId, ctx.tenantId),
        eq(schema.timeSheets.periodStartsOn, period.start),
      ),
    );
  const alreadySent = new Set(sent.map((s) => s.workerId));

  const missing = worked
    .map((w) => w.workerId)
    .filter((id) => !alreadySent.has(id));
  if (missing.length === 0) return [];

  const workers = await tx
    .select({
      id: schema.timeWorkers.id,
      name: schema.parties.displayName,
      clerkUserId: schema.timeWorkers.clerkUserId,
      isActive: schema.timeWorkers.isActive,
    })
    .from(schema.timeWorkers)
    .innerJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.timeWorkers.tenantId),
        eq(schema.parties.id, schema.timeWorkers.partyId),
      ),
    )
    .where(
      and(
        eq(schema.timeWorkers.tenantId, ctx.tenantId),
        inArray(schema.timeWorkers.id, missing),
      ),
    );

  const items: AttentionItem[] = [];
  for (const worker of workers) {
    // Somebody who has left is not going to press submit. Their hours still
    // need approving, and `pendingSheets` is where that lands once an owner
    // sends them — this item would only nag about a person who is gone.
    if (!worker.isActive) continue;
    const to = deliverTo(worker.clerkUserId, ctx);
    if (!to) continue;
    items.push({
      key: `time_unsent:${worker.id}:${period.start}`,
      title: worker.clerkUserId
        ? "Your hours have not been sent for approval"
        : `${worker.name}'s hours have not been sent for approval`,
      detail: periodLabel(period),
      urgency: "soon" as const,
      dueOn: period.end,
      href: `/dashboard/m/time/pay?on=${period.start}`,
      unassigned: to.unassigned || undefined,
      action: {
        kind: "time.sheet.submit",
        label: "Send",
        done: "Sent for approval",
        args: { workerId: worker.id, on: period.start },
      },
    });
  }
  return items.slice(0, MAX_ITEMS);
}

async function collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
  const prefs = await getTimePrefs(tx, ctx.tenantId);
  const [waiting, clocks, overtime, unsent] = await Promise.all([
    pendingSheets(tx, ctx),
    runningClocks(tx, ctx),
    nearOvertime(tx, ctx, prefs),
    unsentHours(tx, ctx, prefs),
  ]);
  return [...clocks, ...overtime, ...waiting, ...unsent];
}

export const timeAttentionSource: AttentionSource = {
  slug: "time",
  moduleSlug: "time",
  label: "Time",
  collect,
  /*
   * REFERENCED, NEVER WRAPPED. An arrow written here would be the function the
   * page hands to a client button, and an arrow in this file is not a server
   * action — React refuses it at render and takes the whole page down with it.
   * `attention/actions.ts` carries the story; accounting's source does the same
   * thing the same way.
   */
  actions: {
    "time.sheet.approve": approveSheetFromAttentionAction,
    "time.sheet.submit": submitSheetFromAttentionAction,
  },
};
