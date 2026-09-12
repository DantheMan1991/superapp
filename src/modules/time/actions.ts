"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { requireTenant, type TenantContext } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone, zonedTimeToInstant } from "@/lib/timezone";
import {
  TimeError,
  friendlyMessage,
  roleMayApprove,
  roleMayManageWorkers,
  roleMayWrite,
} from "./core/errors";
import { PAY_TYPES } from "./core/pay-types";
import { PAY_FREQUENCIES, payPeriodFor } from "./core/periods";
import { isRoundingChoice } from "./core/rounding";
import { isRulesetSlug } from "./core/rulesets";
import { DATE_FORMAT } from "./core/week";
import {
  amendEntry,
  deleteEntry,
  logTime,
  setEntryDimensions,
  splitEntry,
  updateEntry,
} from "./entry-ops";
import { getEntry } from "./read";
import {
  approveSheet,
  assertPeriodOpen,
  lockPeriod,
  returnSheet,
  submitSheet,
  unlockPeriod,
} from "./sheet-ops";
import { clockIn, clockOut, cancelPunch, adjustPunchStart } from "./punch-ops";
import {
  getTimePrefs,
  setOvertimeRuleset,
  setPayFrequency,
  setRoundingMinutes,
  setWeekStartsOn,
} from "./settings-ops";
import { createWorker, setWorkerActive, setWorkerUser } from "./worker-ops";

/**
 * Server actions for Time. Canonical shape (conventions §1):
 * gate → Zod → withTenant → revalidate.
 *
 * THIS FILE EXPORTS ONLY ASYNC FUNCTIONS. Schemas, predicates and error codes
 * live in `core/`, because a `"use server"` file that exports anything else
 * throws when the action graph is evaluated — which no test, type check or
 * build catches. `src/modules/work/core/colors.ts` carries the production
 * incident that taught this.
 *
 * TWO GATES, NOT ONE. `gate()` asks whether this role may write time at all;
 * `ownerGate()` additionally asks whether they may change WHO the workers are.
 * Logging an hour is a chore done by whoever did the work; the list of people
 * whose hours the business records is an owner's decision, and slice 5 hangs
 * pay rates off exactly those rows. Both predicates live in `core/errors.ts` so
 * the screens ask the same question the gate asks — the permission sweep of
 * 2026-09-04 exists because six screens did not.
 */

const BASE = "/dashboard/m/time";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<TenantContext> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "time");
  if (!roleMayWrite(ctx.role)) {
    throw new TimeError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return ctx;
}

async function ownerGate(): Promise<TenantContext> {
  const ctx = await gate();
  if (!roleMayManageWorkers(ctx.role)) {
    throw new TimeError("FORBIDDEN", "only an owner manages who works here");
  }
  return ctx;
}

function fail(error: unknown): { error: string } {
  if (error instanceof TimeError) return { error: friendlyMessage(error) };
  console.error("time action failed", error);
  return { error: "Something went wrong." };
}

function revalidate(): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/people`);
  revalidatePath(`${BASE}/pay`);
}

const uuidSchema = z.string().uuid();
const minutesSchema = z.number().int().positive().max(1440);
const dateSchema = z.string().regex(DATE_FORMAT, "expected yyyy-mm-dd");
const payTypeSchema = z.enum(PAY_TYPES);
const noteSchema = z.string().max(1000).default("");

const addWorkerSchema = z
  .object({
    partyId: uuidSchema.nullish(),
    name: z.string().trim().max(120).optional(),
    clerkUserId: z.string().trim().max(200).nullish(),
  })
  // One door or the other, never neither: without this the only complaint comes
  // from `createWorker`, which would have already decided to make a party.
  .refine((v) => Boolean(v.partyId) || Boolean(v.name), {
    message: "name or existing person required",
  });

export async function addWorkerAction(
  input: z.input<typeof addWorkerSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await ownerGate();
    const parsed = addWorkerSchema.parse(input);
    const id = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const workerId = await createWorker(tx, ctx.tenant.id, parsed);
        await logAuditInTx(tx, {
          action: "time.worker.created",
          tenantId: ctx.tenant.id,
          actorClerkUserId: ctx.userId,
          targetType: "time_worker",
          targetId: workerId,
          // Identifiers only. A name is the tenant's own data and stays out of
          // the audit log, as everywhere else in this codebase.
          meta: { linkedToUser: Boolean(parsed.clerkUserId) },
        });
        return workerId;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

const setWorkerActiveSchema = z.object({
  workerId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  isActive: z.boolean(),
});

export async function setWorkerActiveAction(
  input: z.input<typeof setWorkerActiveSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await ownerGate();
    const parsed = setWorkerActiveSchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        await setWorkerActive(
          tx,
          ctx.tenant.id,
          parsed.workerId,
          parsed.isActive,
          parsed.expectedVersion,
        );
        await logAuditInTx(tx, {
          action: parsed.isActive ? "time.worker.restored" : "time.worker.left",
          tenantId: ctx.tenant.id,
          actorClerkUserId: ctx.userId,
          targetType: "time_worker",
          targetId: parsed.workerId,
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const setWorkerUserSchema = z.object({
  workerId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  clerkUserId: z.string().trim().max(200).nullable(),
});

export async function setWorkerUserAction(
  input: z.input<typeof setWorkerUserSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await ownerGate();
    const parsed = setWorkerUserSchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        await setWorkerUser(
          tx,
          ctx.tenant.id,
          parsed.workerId,
          parsed.clerkUserId,
          parsed.expectedVersion,
        );
        await logAuditInTx(tx, {
          action: "time.worker.sign_in_linked",
          tenantId: ctx.tenant.id,
          actorClerkUserId: ctx.userId,
          targetType: "time_worker",
          targetId: parsed.workerId,
          meta: { linked: Boolean(parsed.clerkUserId) },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const logTimeSchema = z.object({
  workerId: uuidSchema,
  minutes: minutesSchema,
  workDate: dateSchema,
  payType: payTypeSchema,
  note: noteSchema,
  /** What it was for. Written in the same transaction as the entry. */
  memberIds: z.array(uuidSchema).max(10).default([]),
});

export async function logTimeAction(
  input: z.input<typeof logTimeSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await gate();
    const parsed = logTimeSchema.parse(input);
    const id = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const entryId = await logTime(tx, ctx.tenant.id, {
          ...parsed,
          enteredByClerkUserId: ctx.userId,
          // The tenant's today, not the server's and not the browser's, so one
          // request has one idea of the date (0086).
          today: todayInTimezone(ctx.tenant.timezone),
        });
        await setEntryDimensions(tx, ctx.tenant.id, entryId, parsed.memberIds);
        return entryId;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

const updateEntrySchema = z.object({
  entryId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  minutes: minutesSchema,
  workDate: dateSchema,
  payType: payTypeSchema,
  note: noteSchema,
  memberIds: z.array(uuidSchema).max(10).default([]),
});

export async function updateTimeEntryAction(
  input: z.input<typeof updateEntrySchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateEntrySchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        await updateEntry(tx, ctx.tenant.id, {
          ...parsed,
          today: todayInTimezone(ctx.tenant.timezone),
        });
        // Same transaction: an edit that saved the hours and lost the tags
        // would be a silent half-save of the thing reports read.
        await setEntryDimensions(
          tx,
          ctx.tenant.id,
          parsed.entryId,
          parsed.memberIds,
        );
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const deleteEntrySchema = z.object({ entryId: uuidSchema });

export async function deleteTimeEntryAction(
  input: z.input<typeof deleteEntrySchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const { entryId } = deleteEntrySchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      (tx) => deleteEntry(tx, ctx.tenant.id, entryId),
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const weekStartSchema = z.object({ weekStartsOn: z.number().int().min(0).max(6) });

export async function setWeekStartsOnAction(
  input: z.input<typeof weekStartSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await ownerGate();
    const { weekStartsOn } = weekStartSchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        await setWeekStartsOn(tx, ctx.tenant.id, weekStartsOn);
        await logAuditInTx(tx, {
          action: "time.settings.week_start_changed",
          tenantId: ctx.tenant.id,
          actorClerkUserId: ctx.userId,
          meta: { weekStartsOn },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/*
 * ── THE CLOCK ────────────────────────────────────────────────────────────────
 *
 * `gate()`, not `ownerGate()`: starting and stopping a clock is the chore the
 * whole feature exists for, and the person doing it is rarely the owner. A
 * supervisor clocking a group in is the ordinary case, so nothing here asks
 * whether the actor IS the worker.
 *
 * Every one of these takes `new Date()` ONCE and passes it down, so a request
 * that crosses a second boundary mid-way cannot disagree with itself about when
 * the clock started or which day it belongs to.
 */

const clockInSchema = z.object({
  workerId: uuidSchema,
  note: noteSchema,
});

export async function clockInAction(
  input: z.input<typeof clockInSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await gate();
    const parsed = clockInSchema.parse(input);
    const id = await withTenant(
      ctx.tenant.id,
      (tx) =>
        clockIn(tx, ctx.tenant.id, {
          ...parsed,
          actorClerkUserId: ctx.userId,
          at: new Date(),
        }),
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

const clockOutSchema = z.object({
  punchId: uuidSchema,
  note: noteSchema,
});

/**
 * Returns both numbers so the screen can say what rounding did. `paidMinutes`
 * of 0 with a null `entryId` is a real outcome, not a failure: see
 * `core/rounding.ts`.
 */
export async function clockOutAction(
  input: z.input<typeof clockOutSchema>,
): Promise<
  ActionResult<{ rawMinutes: number; paidMinutes: number; entryId: string | null }>
> {
  try {
    const ctx = await gate();
    const parsed = clockOutSchema.parse(input);
    const at = new Date();
    const result = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const prefs = await getTimePrefs(tx, ctx.tenant.id);
        return await clockOut(tx, ctx.tenant.id, {
          ...parsed,
          actorClerkUserId: ctx.userId,
          at,
          roundingMinutes: prefs.roundingMinutes,
          timezone: ctx.tenant.timezone,
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return {
      ok: true,
      data: {
        rawMinutes: result.rawMinutes,
        paidMinutes: result.paidMinutes,
        entryId: result.entryId,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

const punchIdSchema = z.object({ punchId: uuidSchema });

export async function cancelPunchAction(
  input: z.input<typeof punchIdSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const { punchId } = punchIdSchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      (tx) => cancelPunch(tx, ctx.tenant.id, punchId),
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const adjustPunchSchema = z.object({
  punchId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  /** `<input type="datetime-local">`'s value, read in the TENANT's zone. */
  startedAtLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "expected a local date and time"),
});

/**
 * Correct when a running clock started — the forgot-to-clock-in case.
 *
 * The browser sends a WALL-CLOCK reading with no zone, and it is resolved
 * against `tenants.timezone` rather than the browser's: somebody travelling, or
 * a laptop left on the wrong zone, would otherwise move a shift by hours.
 * `zonedTimeToInstant` is the same seam Scheduling uses for an event's time.
 */
export async function adjustPunchStartAction(
  input: z.input<typeof adjustPunchSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = adjustPunchSchema.parse(input);
    const [date, time] = parsed.startedAtLocal.split("T");
    const startedAt = zonedTimeToInstant(date, time, ctx.tenant.timezone);
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        adjustPunchStart(tx, ctx.tenant.id, {
          punchId: parsed.punchId,
          expectedVersion: parsed.expectedVersion,
          startedAt,
          at: new Date(),
        }),
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const roundingSchema = z.object({
  roundingMinutes: z
    .number()
    .int()
    .refine(isRoundingChoice, "not a rounding option"),
});

export async function setRoundingAction(
  input: z.input<typeof roundingSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await ownerGate();
    const { roundingMinutes } = roundingSchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        await setRoundingMinutes(tx, ctx.tenant.id, roundingMinutes);
        await logAuditInTx(tx, {
          action: "time.settings.rounding_changed",
          tenantId: ctx.tenant.id,
          actorClerkUserId: ctx.userId,
          meta: { roundingMinutes },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const payFrequencySchema = z.object({
  frequency: z.enum(PAY_FREQUENCIES),
  /** Required for biweekly, ignored by the rest. */
  anchor: z.string().regex(DATE_FORMAT, "expected yyyy-mm-dd").nullable(),
});

export async function setPayFrequencyAction(
  input: z.input<typeof payFrequencySchema>,
): Promise<ActionResult> {
  try {
    const ctx = await ownerGate();
    const parsed = payFrequencySchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        await setPayFrequency(tx, ctx.tenant.id, parsed.frequency, parsed.anchor);
        await logAuditInTx(tx, {
          action: "time.settings.pay_frequency_changed",
          tenantId: ctx.tenant.id,
          actorClerkUserId: ctx.userId,
          meta: { frequency: parsed.frequency },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const rulesetSchema = z.object({
  slug: z.string().refine(isRulesetSlug, "not an overtime ruleset"),
});

/**
 * Which overtime rules the business is measured by.
 *
 * AUDITED, and of everything in this module this is the one that most deserves
 * it: it changes what every future week is worth, and the answer to "who
 * decided we were on the federal rules?" should not be nobody.
 */
export async function setOvertimeRulesetAction(
  input: z.input<typeof rulesetSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await ownerGate();
    const { slug } = rulesetSchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        await setOvertimeRuleset(tx, ctx.tenant.id, slug);
        await logAuditInTx(tx, {
          action: "time.settings.overtime_ruleset_changed",
          tenantId: ctx.tenant.id,
          actorClerkUserId: ctx.userId,
          meta: { ruleset: slug },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

/*
 * ── SUBMIT, APPROVE, LOCK ────────────────────────────────────────────────────
 *
 * Submitting is a `staff` chore and approving is an `owner` decision, and the
 * split is the whole point of having two steps: somebody who can both submit
 * and approve their own hours has an approval that certifies nothing.
 * `roleMayApprove` is the predicate and the screens ask it too.
 *
 * Approving and locking are AUDITED. They are the two acts in this module with
 * a money consequence, and "who agreed these hours?" must have an answer that
 * is not "nobody remembers".
 */

async function approverGate(): Promise<TenantContext> {
  const ctx = await gate();
  if (!roleMayApprove(ctx.role)) {
    throw new TimeError("FORBIDDEN", "only an owner approves hours");
  }
  return ctx;
}

/** The pay period a date falls in, under the tenant's current settings. */
async function periodFor(ctx: TenantContext, on: string) {
  return await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const prefs = await getTimePrefs(tx, ctx.tenant.id);
      return {
        prefs,
        period: payPeriodFor(on, {
          frequency: prefs.payFrequency,
          weekStartsOn: prefs.weekStartsOn,
          anchor: prefs.periodAnchor,
        }),
      };
    },
    { role: ctx.role, userId: ctx.userId },
  );
}

const submitSchema = z.object({
  workerId: uuidSchema,
  /** Any day inside the period being submitted. */
  on: dateSchema,
});

export async function submitSheetAction(
  input: z.input<typeof submitSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await gate();
    const parsed = submitSchema.parse(input);
    const { period } = await periodFor(ctx, parsed.on);
    const id = await withTenant(
      ctx.tenant.id,
      (tx) =>
        submitSheet(tx, ctx.tenant.id, {
          workerId: parsed.workerId,
          period,
          actorClerkUserId: ctx.userId,
        }),
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

const approveSchema = z.object({
  sheetId: uuidSchema,
  expectedVersion: z.number().int().positive(),
});

export async function approveSheetAction(
  input: z.input<typeof approveSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await approverGate();
    const parsed = approveSchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const prefs = await getTimePrefs(tx, ctx.tenant.id);
        const totals = await approveSheet(tx, ctx.tenant.id, {
          sheetId: parsed.sheetId,
          expectedVersion: parsed.expectedVersion,
          actorClerkUserId: ctx.userId,
          prefs,
        });
        await logAuditInTx(tx, {
          action: "time.sheet.approved",
          tenantId: ctx.tenant.id,
          actorClerkUserId: ctx.userId,
          targetType: "time_sheet",
          targetId: parsed.sheetId,
          // Minutes and a ruleset slug, no names: the audit log records what
          // was agreed, never who it was about.
          meta: {
            workedMinutes: totals.workedMinutes,
            overtimeMinutes: totals.overtimeMinutes,
            doubleTimeMinutes: totals.doubleTimeMinutes,
            ruleset: totals.rulesetSlug,
          },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const sheetIdSchema = z.object({ sheetId: uuidSchema });

export async function returnSheetAction(
  input: z.input<typeof sheetIdSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await approverGate();
    const { sheetId } = sheetIdSchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      (tx) => returnSheet(tx, ctx.tenant.id, sheetId),
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const lockSchema = z.object({ on: dateSchema, locked: z.boolean() });

export async function setPeriodLockAction(
  input: z.input<typeof lockSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await approverGate();
    const parsed = lockSchema.parse(input);
    const { period } = await periodFor(ctx, parsed.on);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        if (parsed.locked) {
          await lockPeriod(tx, ctx.tenant.id, period, ctx.userId);
        } else {
          await unlockPeriod(tx, ctx.tenant.id, period.start);
        }
        await logAuditInTx(tx, {
          action: parsed.locked ? "time.period.locked" : "time.period.unlocked",
          tenantId: ctx.tenant.id,
          actorClerkUserId: ctx.userId,
          targetType: "time_period",
          targetId: period.start,
          meta: { startsOn: period.start, endsOn: period.end },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const amendSchema = z.object({
  originalEntryId: uuidSchema,
  minutes: minutesSchema,
  workDate: dateSchema,
  payType: payTypeSchema,
  note: noteSchema,
});

export async function amendEntryAction(
  input: z.input<typeof amendSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await gate();
    const parsed = amendSchema.parse(input);
    const id = await withTenant(
      ctx.tenant.id,
      (tx) =>
        amendEntry(tx, ctx.tenant.id, {
          ...parsed,
          enteredByClerkUserId: ctx.userId,
          today: todayInTimezone(ctx.tenant.timezone),
        }),
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}

/*
 * ── WHAT THE HOUR WAS FOR ────────────────────────────────────────────────────
 *
 * Tags are a `staff` chore, like the hour itself: the person who did the work
 * knows which field they were in. Nothing here is owner-only.
 */

const memberIdsSchema = z.array(uuidSchema).max(10).default([]);

const setDimensionsSchema = z.object({
  entryId: uuidSchema,
  memberIds: memberIdsSchema,
});

export async function setEntryDimensionsAction(
  input: z.input<typeof setDimensionsSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = setDimensionsSchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        // Tagging an hour inside a locked period changes what a report says
        // about a pay run that has already happened, so it is refused with
        // everything else.
        const entry = await getEntry(tx, ctx.tenant.id, parsed.entryId);
        if (!entry) throw new TimeError("ENTRY_NOT_FOUND", "no such entry");
        await assertPeriodOpen(tx, ctx.tenant.id, entry.workDate);
        await setEntryDimensions(
          tx,
          ctx.tenant.id,
          parsed.entryId,
          parsed.memberIds,
        );
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

const splitSchema = z.object({
  entryId: uuidSchema,
  minutes: minutesSchema,
  /** What the SPLIT-OFF half was for. The original keeps its own tags. */
  memberIds: memberIdsSchema,
});

/**
 * Divide an entry so each half can say what it was for.
 *
 * The split and the new half's tags happen in ONE transaction: a split that
 * committed without them would leave somebody looking at two identical rows
 * wondering which was which.
 */
export async function splitEntryAction(
  input: z.input<typeof splitSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await gate();
    const parsed = splitSchema.parse(input);
    const id = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const newId = await splitEntry(tx, ctx.tenant.id, {
          entryId: parsed.entryId,
          minutes: parsed.minutes,
          today: todayInTimezone(ctx.tenant.timezone),
        });
        await setEntryDimensions(tx, ctx.tenant.id, newId, parsed.memberIds);
        return newId;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true, data: { id } };
  } catch (error) {
    return fail(error);
  }
}
