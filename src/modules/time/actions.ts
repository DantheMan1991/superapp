"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { requireTenant, type TenantContext } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone, zonedTimeToInstant } from "@/lib/timezone";
import { TimeError, friendlyMessage, roleMayManageWorkers, roleMayWrite } from "./core/errors";
import { PAY_TYPES } from "./core/pay-types";
import { isRoundingChoice } from "./core/rounding";
import { DATE_FORMAT } from "./core/week";
import { deleteEntry, logTime, updateEntry } from "./entry-ops";
import { clockIn, clockOut, cancelPunch, adjustPunchStart } from "./punch-ops";
import { getTimePrefs, setRoundingMinutes, setWeekStartsOn } from "./settings-ops";
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
});

export async function logTimeAction(
  input: z.input<typeof logTimeSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await gate();
    const parsed = logTimeSchema.parse(input);
    const id = await withTenant(
      ctx.tenant.id,
      (tx) =>
        logTime(tx, ctx.tenant.id, {
          ...parsed,
          enteredByClerkUserId: ctx.userId,
          // The tenant's today, not the server's and not the browser's, so one
          // request has one idea of the date (0086).
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

const updateEntrySchema = z.object({
  entryId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  minutes: minutesSchema,
  workDate: dateSchema,
  payType: payTypeSchema,
  note: noteSchema,
});

export async function updateTimeEntryAction(
  input: z.input<typeof updateEntrySchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateEntrySchema.parse(input);
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        updateEntry(tx, ctx.tenant.id, {
          ...parsed,
          today: todayInTimezone(ctx.tenant.timezone),
        }),
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
