import "server-only";
import { and, asc, count, eq, gte, lte, max, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { HealthError } from "./core/errors";
import { HABITS_MAX, type HabitDayInput, type HabitInput } from "./core/habits";

/**
 * THE PERSON'S OWN HABITS (H1, docs/modules/health.md): the list, and the days
 * each was done. In the space's own transaction, like everything in Health.
 */

export interface HabitRow {
  id: string;
  name: string;
  unit: string | null;
}

export async function listHabits(tx: Tx, tenantId: string): Promise<HabitRow[]> {
  const t = schema;
  return tx
    .select({ id: t.healthHabits.id, name: t.healthHabits.name, unit: t.healthHabits.unit })
    .from(t.healthHabits)
    .where(eq(t.healthHabits.tenantId, tenantId))
    .orderBy(asc(t.healthHabits.position), asc(t.healthHabits.createdAt));
}

/** Refuse a name the space already has, whatever its capitals. */
async function checkName(tx: Tx, tenantId: string, name: string, except: string | null): Promise<void> {
  const t = schema;
  const [taken] = await tx
    .select({ id: t.healthHabits.id })
    .from(t.healthHabits)
    .where(
      and(
        eq(t.healthHabits.tenantId, tenantId),
        sql`lower(${t.healthHabits.name}) = lower(${name})`,
        ...(except ? [ne(t.healthHabits.id, except)] : []),
      ),
    )
    .limit(1);
  if (taken) throw new HealthError("HABIT_NAME_TAKEN");
}

export async function createHabit(tx: Tx, tenantId: string, input: HabitInput): Promise<{ id: string }> {
  const t = schema;
  const [{ n }] = await tx.select({ n: count() }).from(t.healthHabits).where(eq(t.healthHabits.tenantId, tenantId));
  if (n >= HABITS_MAX) throw new HealthError("TOO_MANY_HABITS");
  await checkName(tx, tenantId, input.name, null);
  const [{ last }] = await tx
    .select({ last: max(t.healthHabits.position) })
    .from(t.healthHabits)
    .where(eq(t.healthHabits.tenantId, tenantId));
  const [row] = await tx
    .insert(t.healthHabits)
    .values({ tenantId, name: input.name, unit: input.unit, position: (last ?? -1) + 1 })
    .returning({ id: t.healthHabits.id });
  return row;
}

export async function updateHabit(tx: Tx, tenantId: string, id: string, input: HabitInput, now: Date = new Date()): Promise<void> {
  const t = schema;
  await checkName(tx, tenantId, input.name, id);
  const changed = await tx
    .update(t.healthHabits)
    .set({ name: input.name, unit: input.unit, updatedAt: now })
    .where(and(eq(t.healthHabits.tenantId, tenantId), eq(t.healthHabits.id, id)))
    .returning({ id: t.healthHabits.id });
  if (changed.length === 0) throw new HealthError("NOT_FOUND");
}

/** Delete a habit and the days it was done (the composite key cascades). */
export async function deleteHabit(tx: Tx, tenantId: string, id: string): Promise<void> {
  const t = schema;
  await tx.delete(t.healthHabits).where(and(eq(t.healthHabits.tenantId, tenantId), eq(t.healthHabits.id, id)));
}

/**
 * Mark a habit done on a day, with its amount when it is counted, or not done.
 * Once a day: marking it again changes the amount.
 */
export async function setHabitDay(tx: Tx, tenantId: string, input: HabitDayInput, now: Date = new Date()): Promise<void> {
  const t = schema;
  if (!input.done) {
    await tx
      .delete(t.healthHabitLogs)
      .where(
        and(
          eq(t.healthHabitLogs.tenantId, tenantId),
          eq(t.healthHabitLogs.habitId, input.habitId),
          eq(t.healthHabitLogs.doneOn, input.day),
        ),
      );
    return;
  }
  const [habit] = await tx
    .select({ id: t.healthHabits.id })
    .from(t.healthHabits)
    .where(and(eq(t.healthHabits.tenantId, tenantId), eq(t.healthHabits.id, input.habitId)))
    .limit(1);
  if (!habit) throw new HealthError("NOT_FOUND");
  await tx
    .insert(t.healthHabitLogs)
    .values({ tenantId, habitId: input.habitId, doneOn: input.day, amount: input.amount })
    .onConflictDoUpdate({
      target: [t.healthHabitLogs.tenantId, t.healthHabitLogs.habitId, t.healthHabitLogs.doneOn],
      set: { amount: input.amount, updatedAt: now },
    });
}

export interface HabitLogRow {
  habitId: string;
  doneOn: string;
  amount: number | null;
}

export async function habitLogsBetween(tx: Tx, tenantId: string, from: string, to: string): Promise<HabitLogRow[]> {
  const t = schema;
  return tx
    .select({ habitId: t.healthHabitLogs.habitId, doneOn: t.healthHabitLogs.doneOn, amount: t.healthHabitLogs.amount })
    .from(t.healthHabitLogs)
    .where(and(eq(t.healthHabitLogs.tenantId, tenantId), gte(t.healthHabitLogs.doneOn, from), lte(t.healthHabitLogs.doneOn, to)));
}
