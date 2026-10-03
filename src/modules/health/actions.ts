"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import type { TenantContext } from "@/lib/auth";
import {
  measureInputSchema,
  measurementsInputSchema,
  weighinChangeSchema,
  weighinDaySchema,
  weighinInputSchema,
  weightGoalSchema,
} from "./core/body";
import { dayRefused } from "./core/days";
import { HEALTH_MESSAGES, HealthError } from "./core/errors";
import { habitDayInputSchema, habitInputSchema } from "./core/habits";
import { plungeInputSchema } from "./core/plunge";
import { sleepInputSchema } from "./core/sleep";
import {
  changeWeighin,
  clearWeightGoal,
  createMeasure,
  deleteMeasure,
  deleteWeighin,
  measurementsBetween,
  saveMeasurements,
  saveWeighin,
  setWeightGoal,
  updateMeasure,
} from "./body-ops";
import { createHabit, deleteHabit, setHabitDay, updateHabit } from "./habit-ops";
import { HEALTH_HOME, deletePlunge, deleteSleep, logPlunge, saveSleep } from "./log-ops";

/**
 * HEALTH'S SERVER ACTIONS (H1, H2). Each one: the personal space's own door
 * (`requirePersonalSpace`: a business never reaches here), the module gate,
 * then zod on the input. Each returns `{ ok }` or `{ error }` with a sentence;
 * an exception's own text never reaches the screen.
 */

type Outcome<T extends object = object> = ({ ok: true } & T) | { error: string };

async function gate() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "health");
  return ctx;
}

function failure(err: unknown, fallback: string): { error: string } {
  if (err instanceof HealthError) return { error: err.message };
  console.error("health action failed", err instanceof Error ? err.name : "unknown");
  return { error: fallback };
}

/**
 * The Health pages an action can change. An action re-renders the page it was
 * called from only when that page is named here: Your habits was missing, and
 * a habit added there never appeared until a reload (the drive, 2026-10-02).
 */
function refresh() {
  revalidatePath(HEALTH_HOME);
  revalidatePath(`${HEALTH_HOME}/progress`);
  revalidatePath(`${HEALTH_HOME}/habits`);
  revalidatePath(`${HEALTH_HOME}/body`);
  revalidatePath(`${HEALTH_HOME}/body/measure`);
  revalidatePath(`${HEALTH_HOME}/body/measures`);
}

const invalid = { error: HEALTH_MESSAGES.INVALID };

/**
 * Whether a day can be filled in (H2, `core/days.ts`): today or the two weeks
 * before it, as the space counts days; and a page that showed the day as
 * today must still be on today, or a Today left open overnight would file
 * this morning under yesterday (`NEW_DAY`).
 */
function dayRefusal(ctx: TenantContext, day: string, asToday: boolean): { error: string } | null {
  const code = dayRefused(day, todayInTimezone(ctx.tenant.timezone), asToday);
  return code ? { error: HEALTH_MESSAGES[code] } : null;
}

/** Keep a cold plunge (timed or typed in). Its id is the phone's: a resend is one plunge. */
export async function logPlungeAction(input: unknown): Promise<Outcome<{ takenOn: string }>> {
  try {
    const ctx = await gate();
    const parsed = plungeInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
    const refused = parsed.data.takenOn ? dayRefusal(ctx, parsed.data.takenOn, false) : null;
    if (refused) return refused;
    const { takenOn } = await withTenant(ctx.tenant.id, (tx) => logPlunge(tx, ctx, parsed.data), { role: ctx.role });
    refresh();
    return { ok: true, takenOn };
  } catch (err) {
    return failure(err, "The plunge could not be kept. Try again.");
  }
}

const idInput = z.object({ id: z.string().uuid() });

export async function deletePlungeAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return invalid;
    await withTenant(ctx.tenant.id, (tx) => deletePlunge(tx, ctx.tenant.id, parsed.data.id), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be removed. Try again.");
  }
}

/** Keep a night's sleep, or change the one kept for that morning: today's, or one of the two weeks before. */
export async function saveSleepAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = sleepInputSchema.safeParse(input);
    if (!parsed.success) {
      const sameTime = parsed.error.issues.some((issue) => issue.message === "SAME_TIME");
      return { error: sameTime ? HEALTH_MESSAGES.SAME_TIME : HEALTH_MESSAGES.INVALID };
    }
    const refused = dayRefusal(ctx, parsed.data.wokeOn, parsed.data.asToday);
    if (refused) return refused;
    await withTenant(ctx.tenant.id, (tx) => saveSleep(tx, ctx, parsed.data), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "Your sleep could not be kept. Try again.");
  }
}

const morningInput = z.object({ wokeOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function deleteSleepAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = morningInput.safeParse(input);
    if (!parsed.success) return invalid;
    await withTenant(ctx.tenant.id, (tx) => deleteSleep(tx, ctx.tenant.id, parsed.data.wokeOn), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be removed. Try again.");
  }
}

export async function createHabitAction(input: unknown): Promise<Outcome<{ id: string }>> {
  try {
    const ctx = await gate();
    const parsed = habitInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
    const { id } = await withTenant(ctx.tenant.id, (tx) => createHabit(tx, ctx.tenant.id, parsed.data), { role: ctx.role });
    refresh();
    return { ok: true, id };
  } catch (err) {
    return failure(err, "The habit could not be added. Try again.");
  }
}

const habitChange = habitInputSchema.and(idInput);

export async function updateHabitAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = habitChange.safeParse(input);
    if (!parsed.success) return invalid;
    await withTenant(ctx.tenant.id, (tx) => updateHabit(tx, ctx.tenant.id, parsed.data.id, parsed.data), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "The habit could not be changed. Try again.");
  }
}

export async function deleteHabitAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return invalid;
    await withTenant(ctx.tenant.id, (tx) => deleteHabit(tx, ctx.tenant.id, parsed.data.id), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "The habit could not be deleted. Try again.");
  }
}

/** Mark a habit done on a day (with its amount), or not done: today, or one of the two weeks before. */
export async function setHabitDayAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = habitDayInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
    const refused = dayRefusal(ctx, parsed.data.day, parsed.data.asToday);
    if (refused) return refused;
    await withTenant(ctx.tenant.id, (tx) => setHabitDay(tx, ctx.tenant.id, parsed.data), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "That could not be kept. Try again.");
  }
}

/* -- the body (H2) ------------------------------------------------------------- */

/** Keep a day's weigh-in, or change it: today's, or one of the two weeks before. */
export async function saveWeighinAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = weighinInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
    const refused = dayRefusal(ctx, parsed.data.day, parsed.data.asToday);
    if (refused) return refused;
    await withTenant(ctx.tenant.id, (tx) => saveWeighin(tx, ctx, parsed.data.day, parsed.data.pounds), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "The weigh-in could not be kept. Try again.");
  }
}

/** Change a weigh-in already kept, from Body's list: any day it was kept on. */
export async function changeWeighinAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = weighinChangeSchema.safeParse(input);
    if (!parsed.success) return invalid;
    await withTenant(ctx.tenant.id, (tx) => changeWeighin(tx, ctx.tenant.id, parsed.data.day, parsed.data.pounds), {
      role: ctx.role,
    });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "The weigh-in could not be changed. Try again.");
  }
}

export async function deleteWeighinAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = weighinDaySchema.safeParse(input);
    if (!parsed.success) return invalid;
    await withTenant(ctx.tenant.id, (tx) => deleteWeighin(tx, ctx.tenant.id, parsed.data.day), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be removed. Try again.");
  }
}

/** Set the goal weight and about how fast, or change them. */
export async function setWeightGoalAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = weightGoalSchema.safeParse(input);
    if (!parsed.success) return invalid;
    await withTenant(
      ctx.tenant.id,
      (tx) => setWeightGoal(tx, ctx.tenant.id, parsed.data.goalPounds, parsed.data.pacePounds),
      { role: ctx.role },
    );
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "The goal could not be kept. Try again.");
  }
}

export async function clearWeightGoalAction(): Promise<Outcome> {
  try {
    const ctx = await gate();
    await withTenant(ctx.tenant.id, (tx) => clearWeightGoal(tx, ctx.tenant.id), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "The goal could not be removed. Try again.");
  }
}

export async function createMeasureAction(input: unknown): Promise<Outcome<{ id: string }>> {
  try {
    const ctx = await gate();
    const parsed = measureInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
    const { id } = await withTenant(ctx.tenant.id, (tx) => createMeasure(tx, ctx.tenant.id, parsed.data), { role: ctx.role });
    refresh();
    return { ok: true, id };
  } catch (err) {
    return failure(err, "The tape measure could not be added. Try again.");
  }
}

const measureChange = measureInputSchema.and(idInput);

export async function updateMeasureAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = measureChange.safeParse(input);
    if (!parsed.success) return invalid;
    await withTenant(ctx.tenant.id, (tx) => updateMeasure(tx, ctx.tenant.id, parsed.data.id, parsed.data), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "The tape measure could not be changed. Try again.");
  }
}

export async function deleteMeasureAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return invalid;
    await withTenant(ctx.tenant.id, (tx) => deleteMeasure(tx, ctx.tenant.id, parsed.data.id), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "The tape measure could not be deleted. Try again.");
  }
}

/**
 * Keep a day's tape measures: today's, one of the two weeks before, or a day
 * already measured (to change or take off what was kept, however long ago).
 */
export async function saveMeasurementsAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = measurementsInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
    const { day, values, asToday } = parsed.data;
    const refused = dayRefusal(ctx, day, asToday);
    const outcome = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        if (refused) {
          // Out of reach to add to, but a day already measured can be changed.
          const kept = await measurementsBetween(tx, ctx.tenant.id, day, day);
          if (asToday || kept.length === 0) return refused;
        }
        await saveMeasurements(tx, ctx.tenant.id, day, values);
        return null;
      },
      { role: ctx.role },
    );
    if (outcome) return outcome;
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "The tape measures could not be kept. Try again.");
  }
}
