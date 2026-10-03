import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { dateInTimezone, todayInTimezone } from "@/lib/timezone";
import { HealthError } from "./core/errors";
import type { PlungeInput } from "./core/plunge";
import { shiftDay } from "./core/progress";
import { sleepMinutes, type SleepInput } from "./core/sleep";

/**
 * COLD PLUNGES AND SLEEP, LOGGED (H1, docs/modules/health.md). Every read and
 * write takes the space's own transaction, so RLS decides whose rows these are;
 * the tenant in each `where` is the second lock, not the first.
 */

export const HEALTH_HOME = "/personal/m/health";

/** How far back a plunge may be typed in: last week's, not last year's. */
const PLUNGE_BACK_DAYS = 8;
/** How far back a night may be logged. */
const SLEEP_BACK_DAYS = 60;

/* -- cold plunges ------------------------------------------------------------ */

/**
 * Keep a plunge. Its id is the phone's, so a Save sent twice keeps one; its
 * day is the space's day it started on.
 */
export async function logPlunge(tx: Tx, ctx: TenantContext, input: PlungeInput, now: Date = new Date()): Promise<{ takenOn: string }> {
  const t = schema;
  const startedAt = new Date(input.startedAt);
  if (startedAt.getTime() > now.getTime() + 60_000 || startedAt.getTime() < now.getTime() - PLUNGE_BACK_DAYS * 86_400_000) {
    throw new HealthError("INVALID");
  }
  // Typed in for an earlier day, it goes on that day (the action checked the
  // day can be filled in); otherwise on the day it started.
  const takenOn = input.takenOn ?? dateInTimezone(startedAt, ctx.tenant.timezone);
  const [row] = await tx
    .insert(t.healthPlunges)
    .values({
      id: input.id,
      tenantId: ctx.tenant.id,
      takenOn,
      startedAt,
      seconds: input.seconds,
      waterF: input.waterF,
      feelAfter: input.feelAfter,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing({ target: t.healthPlunges.id })
    .returning({ takenOn: t.healthPlunges.takenOn });
  if (row) return { takenOn: row.takenOn };
  // Sent again: the first one stands, when it is this space's.
  const [existing] = await tx
    .select({ takenOn: t.healthPlunges.takenOn })
    .from(t.healthPlunges)
    .where(and(eq(t.healthPlunges.tenantId, ctx.tenant.id), eq(t.healthPlunges.id, input.id)))
    .limit(1);
  if (!existing) throw new HealthError("INVALID");
  return { takenOn: existing.takenOn };
}

/** Undo a plunge. One already gone is fine: the person wanted it gone. */
export async function deletePlunge(tx: Tx, tenantId: string, id: string): Promise<void> {
  const t = schema;
  await tx.delete(t.healthPlunges).where(and(eq(t.healthPlunges.tenantId, tenantId), eq(t.healthPlunges.id, id)));
}

export interface PlungeRow {
  id: string;
  takenOn: string;
  startedAt: Date;
  seconds: number;
  waterF: number | null;
  feelAfter: number | null;
}

export async function plungesBetween(tx: Tx, tenantId: string, from: string, to: string): Promise<PlungeRow[]> {
  const t = schema;
  return tx
    .select({
      id: t.healthPlunges.id,
      takenOn: t.healthPlunges.takenOn,
      startedAt: t.healthPlunges.startedAt,
      seconds: t.healthPlunges.seconds,
      waterF: t.healthPlunges.waterF,
      feelAfter: t.healthPlunges.feelAfter,
    })
    .from(t.healthPlunges)
    .where(and(eq(t.healthPlunges.tenantId, tenantId), gte(t.healthPlunges.takenOn, from), lte(t.healthPlunges.takenOn, to)))
    .orderBy(t.healthPlunges.startedAt);
}

/** The latest plunge: the timer starts from its water temperature. */
export async function lastPlunge(tx: Tx, tenantId: string): Promise<PlungeRow | null> {
  const t = schema;
  const [row] = await tx
    .select({
      id: t.healthPlunges.id,
      takenOn: t.healthPlunges.takenOn,
      startedAt: t.healthPlunges.startedAt,
      seconds: t.healthPlunges.seconds,
      waterF: t.healthPlunges.waterF,
      feelAfter: t.healthPlunges.feelAfter,
    })
    .from(t.healthPlunges)
    .where(eq(t.healthPlunges.tenantId, tenantId))
    .orderBy(desc(t.healthPlunges.startedAt))
    .limit(1);
  return row ?? null;
}

/* -- sleep ------------------------------------------------------------------- */

/** Keep a night, or change the one already kept for that morning. */
export async function saveSleep(tx: Tx, ctx: TenantContext, input: SleepInput, now: Date = new Date()): Promise<void> {
  const t = schema;
  const today = todayInTimezone(ctx.tenant.timezone, now);
  if (input.wokeOn > today || input.wokeOn < shiftDay(today, -SLEEP_BACK_DAYS)) throw new HealthError("INVALID");
  const minutes = sleepMinutes(input.bedTime, input.wokeTime);
  if (minutes === null) throw new HealthError("SAME_TIME");
  await tx
    .insert(t.healthSleep)
    .values({
      tenantId: ctx.tenant.id,
      wokeOn: input.wokeOn,
      bedTime: input.bedTime,
      wokeTime: input.wokeTime,
      minutes,
      rested: input.rested,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [t.healthSleep.tenantId, t.healthSleep.wokeOn],
      set: { bedTime: input.bedTime, wokeTime: input.wokeTime, minutes, rested: input.rested, updatedAt: now },
    });
}

export async function deleteSleep(tx: Tx, tenantId: string, wokeOn: string): Promise<void> {
  const t = schema;
  await tx.delete(t.healthSleep).where(and(eq(t.healthSleep.tenantId, tenantId), eq(t.healthSleep.wokeOn, wokeOn)));
}

export interface SleepRow {
  wokeOn: string;
  bedTime: string;
  wokeTime: string;
  minutes: number;
  rested: number | null;
}

const sleepColumns = {
  wokeOn: schema.healthSleep.wokeOn,
  bedTime: schema.healthSleep.bedTime,
  wokeTime: schema.healthSleep.wokeTime,
  minutes: schema.healthSleep.minutes,
  rested: schema.healthSleep.rested,
};

export async function sleepBetween(tx: Tx, tenantId: string, from: string, to: string): Promise<SleepRow[]> {
  const t = schema;
  return tx
    .select(sleepColumns)
    .from(t.healthSleep)
    .where(and(eq(t.healthSleep.tenantId, tenantId), gte(t.healthSleep.wokeOn, from), lte(t.healthSleep.wokeOn, to)))
    .orderBy(t.healthSleep.wokeOn);
}

/**
 * The latest night kept on or before a morning: a new morning's form starts
 * from its times, and it is that morning's own night when it was kept then.
 */
export async function lastSleep(tx: Tx, tenantId: string, onOrBefore: string): Promise<SleepRow | null> {
  const t = schema;
  const [row] = await tx
    .select(sleepColumns)
    .from(t.healthSleep)
    .where(and(eq(t.healthSleep.tenantId, tenantId), lte(t.healthSleep.wokeOn, onOrBefore)))
    .orderBy(desc(t.healthSleep.wokeOn))
    .limit(1);
  return row ?? null;
}
