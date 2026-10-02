"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { HEALTH_MESSAGES, HealthError } from "./core/errors";
import { habitDayInputSchema, habitInputSchema } from "./core/habits";
import { plungeInputSchema } from "./core/plunge";
import { sleepInputSchema } from "./core/sleep";
import { createHabit, deleteHabit, setHabitDay, updateHabit } from "./habit-ops";
import { HEALTH_HOME, deletePlunge, deleteSleep, logPlunge, saveSleep } from "./log-ops";

/**
 * HEALTH'S SERVER ACTIONS (H1). Each one: the personal space's own door
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
}

const invalid = { error: HEALTH_MESSAGES.INVALID };

/** Keep a cold plunge (timed or typed in). Its id is the phone's: a resend is one plunge. */
export async function logPlungeAction(input: unknown): Promise<Outcome<{ takenOn: string }>> {
  try {
    const ctx = await gate();
    const parsed = plungeInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
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

/** Keep a night's sleep, or change the one kept for that morning. */
export async function saveSleepAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = sleepInputSchema.safeParse(input);
    if (!parsed.success) {
      const sameTime = parsed.error.issues.some((issue) => issue.message === "SAME_TIME");
      return { error: sameTime ? HEALTH_MESSAGES.SAME_TIME : HEALTH_MESSAGES.INVALID };
    }
    // This morning's night, as the space counts it: a page left open since
    // yesterday must not file it under yesterday's morning.
    if (parsed.data.wokeOn !== todayInTimezone(ctx.tenant.timezone)) return { error: HEALTH_MESSAGES.NEW_DAY };
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

/** Mark a habit done today (with its amount), or not done. Today is the space's. */
export async function setHabitDayAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = habitDayInputSchema.safeParse(input);
    if (!parsed.success) return invalid;
    // Only today, as the space counts it: Today is the one screen that marks.
    if (parsed.data.day !== todayInTimezone(ctx.tenant.timezone)) return { error: HEALTH_MESSAGES.NEW_DAY };
    await withTenant(ctx.tenant.id, (tx) => setHabitDay(tx, ctx.tenant.id, parsed.data), { role: ctx.role });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err, "That could not be kept. Try again.");
  }
}
