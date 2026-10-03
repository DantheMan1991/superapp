import "server-only";
import { and, asc, count, desc, eq, gte, lte, max, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { HealthError } from "./core/errors";
import { cmFromInches, kgFromPounds, MEASURES_MAX, type Better, type MeasureInput, type Weighin, type WeightGoal } from "./core/body";

/**
 * THE BODY, KEPT (H2, docs/modules/health.md): weigh-ins, the goal weight,
 * and the person's own tape measures with the days each was taken. In the
 * space's own transaction, like everything in Health; the tenant in each
 * `where` is the second lock, not the first. Whether a day may be filled in
 * is the action's to decide (`core/days.ts`); here a day is a day.
 */

/* -- weigh-ins ---------------------------------------------------------------- */

/** Keep a day's weigh-in, or change the one kept for it: one a day. */
export async function saveWeighin(tx: Tx, ctx: TenantContext, day: string, pounds: number, now: Date = new Date()): Promise<void> {
  const t = schema;
  const kg = kgFromPounds(pounds);
  await tx
    .insert(t.healthWeighins)
    .values({ tenantId: ctx.tenant.id, weighedOn: day, kg, createdByClerkUserId: ctx.userId })
    .onConflictDoUpdate({ target: [t.healthWeighins.tenantId, t.healthWeighins.weighedOn], set: { kg, updatedAt: now } });
}

/** Change a weigh-in already kept, on whatever day: NOT_FOUND when there is none that day. */
export async function changeWeighin(tx: Tx, tenantId: string, day: string, pounds: number, now: Date = new Date()): Promise<void> {
  const t = schema;
  const changed = await tx
    .update(t.healthWeighins)
    .set({ kg: kgFromPounds(pounds), updatedAt: now })
    .where(and(eq(t.healthWeighins.tenantId, tenantId), eq(t.healthWeighins.weighedOn, day)))
    .returning({ id: t.healthWeighins.id });
  if (changed.length === 0) throw new HealthError("NOT_FOUND");
}

/** Take a day's weigh-in off. One already gone is fine: the person wanted it gone. */
export async function deleteWeighin(tx: Tx, tenantId: string, day: string): Promise<void> {
  const t = schema;
  await tx.delete(t.healthWeighins).where(and(eq(t.healthWeighins.tenantId, tenantId), eq(t.healthWeighins.weighedOn, day)));
}

const weighinColumns = { day: schema.healthWeighins.weighedOn, kg: schema.healthWeighins.kg };

/** The weigh-ins from `from` to `to`, oldest first. */
export async function weighinsBetween(tx: Tx, tenantId: string, from: string, to: string): Promise<Weighin[]> {
  const t = schema;
  return tx
    .select(weighinColumns)
    .from(t.healthWeighins)
    .where(and(eq(t.healthWeighins.tenantId, tenantId), gte(t.healthWeighins.weighedOn, from), lte(t.healthWeighins.weighedOn, to)))
    .orderBy(asc(t.healthWeighins.weighedOn));
}

/** Every weigh-in, oldest first: Body's chart and list. */
export async function allWeighins(tx: Tx, tenantId: string): Promise<Weighin[]> {
  const t = schema;
  return tx
    .select(weighinColumns)
    .from(t.healthWeighins)
    .where(eq(t.healthWeighins.tenantId, tenantId))
    .orderBy(asc(t.healthWeighins.weighedOn));
}

/** The latest weigh-in on or before a day: a new day's weigh-in starts from it. */
export async function lastWeighin(tx: Tx, tenantId: string, onOrBefore: string): Promise<Weighin | null> {
  const t = schema;
  const [row] = await tx
    .select(weighinColumns)
    .from(t.healthWeighins)
    .where(and(eq(t.healthWeighins.tenantId, tenantId), lte(t.healthWeighins.weighedOn, onOrBefore)))
    .orderBy(desc(t.healthWeighins.weighedOn))
    .limit(1);
  return row ?? null;
}

/* -- the goal ------------------------------------------------------------------ */

export async function getWeightGoal(tx: Tx, tenantId: string): Promise<WeightGoal | null> {
  const t = schema;
  const [row] = await tx
    .select({ goalKg: t.healthWeightGoals.goalKg, paceKg: t.healthWeightGoals.paceKg })
    .from(t.healthWeightGoals)
    .where(eq(t.healthWeightGoals.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function setWeightGoal(
  tx: Tx,
  tenantId: string,
  goalPounds: number,
  pacePounds: number,
  now: Date = new Date(),
): Promise<void> {
  const t = schema;
  const goalKg = kgFromPounds(goalPounds);
  const paceKg = kgFromPounds(pacePounds);
  await tx
    .insert(t.healthWeightGoals)
    .values({ tenantId, goalKg, paceKg })
    .onConflictDoUpdate({ target: t.healthWeightGoals.tenantId, set: { goalKg, paceKg, updatedAt: now } });
}

export async function clearWeightGoal(tx: Tx, tenantId: string): Promise<void> {
  const t = schema;
  await tx.delete(t.healthWeightGoals).where(eq(t.healthWeightGoals.tenantId, tenantId));
}

/* -- tape measures --------------------------------------------------------------- */

export interface MeasureRow {
  id: string;
  name: string;
  better: Better | null;
}

export async function listMeasures(tx: Tx, tenantId: string): Promise<MeasureRow[]> {
  const t = schema;
  const rows = await tx
    .select({ id: t.healthMeasures.id, name: t.healthMeasures.name, better: t.healthMeasures.better })
    .from(t.healthMeasures)
    .where(eq(t.healthMeasures.tenantId, tenantId))
    .orderBy(asc(t.healthMeasures.position), asc(t.healthMeasures.createdAt));
  return rows.map((r) => ({ ...r, better: r.better === "smaller" || r.better === "bigger" ? r.better : null }));
}

/** Refuse a name the space already has, whatever its capitals. */
async function checkMeasureName(tx: Tx, tenantId: string, name: string, except: string | null): Promise<void> {
  const t = schema;
  const [taken] = await tx
    .select({ id: t.healthMeasures.id })
    .from(t.healthMeasures)
    .where(
      and(
        eq(t.healthMeasures.tenantId, tenantId),
        sql`lower(${t.healthMeasures.name}) = lower(${name})`,
        ...(except ? [ne(t.healthMeasures.id, except)] : []),
      ),
    )
    .limit(1);
  if (taken) throw new HealthError("MEASURE_NAME_TAKEN");
}

export async function createMeasure(tx: Tx, tenantId: string, input: MeasureInput): Promise<{ id: string }> {
  const t = schema;
  const [{ n }] = await tx.select({ n: count() }).from(t.healthMeasures).where(eq(t.healthMeasures.tenantId, tenantId));
  if (n >= MEASURES_MAX) throw new HealthError("TOO_MANY_MEASURES");
  await checkMeasureName(tx, tenantId, input.name, null);
  const [{ last }] = await tx
    .select({ last: max(t.healthMeasures.position) })
    .from(t.healthMeasures)
    .where(eq(t.healthMeasures.tenantId, tenantId));
  const [row] = await tx
    .insert(t.healthMeasures)
    .values({ tenantId, name: input.name, better: input.better, position: (last ?? -1) + 1 })
    .returning({ id: t.healthMeasures.id });
  return row;
}

export async function updateMeasure(tx: Tx, tenantId: string, id: string, input: MeasureInput, now: Date = new Date()): Promise<void> {
  const t = schema;
  await checkMeasureName(tx, tenantId, input.name, id);
  const changed = await tx
    .update(t.healthMeasures)
    .set({ name: input.name, better: input.better, updatedAt: now })
    .where(and(eq(t.healthMeasures.tenantId, tenantId), eq(t.healthMeasures.id, id)))
    .returning({ id: t.healthMeasures.id });
  if (changed.length === 0) throw new HealthError("NOT_FOUND");
}

/** Delete a tape measure and every day it was taken (the composite key cascades). */
export async function deleteMeasure(tx: Tx, tenantId: string, id: string): Promise<void> {
  const t = schema;
  await tx.delete(t.healthMeasures).where(and(eq(t.healthMeasures.tenantId, tenantId), eq(t.healthMeasures.id, id)));
}

export interface MeasurementRow {
  measureId: string;
  day: string;
  cm: number;
}

const measurementColumns = {
  measureId: schema.healthMeasurements.measureId,
  day: schema.healthMeasurements.measuredOn,
  cm: schema.healthMeasurements.cm,
};

/**
 * Keep a day's tape measures: each one's inches, or null to take that
 * measure off the day. Every measure named must be this space's own, or
 * nothing is kept (NOT_FOUND).
 */
export async function saveMeasurements(
  tx: Tx,
  tenantId: string,
  day: string,
  values: readonly { measureId: string; inches: number | null }[],
  now: Date = new Date(),
): Promise<void> {
  const t = schema;
  const own = new Set((await listMeasures(tx, tenantId)).map((m) => m.id));
  if (values.some((v) => !own.has(v.measureId))) throw new HealthError("NOT_FOUND");
  for (const value of values) {
    if (value.inches === null) {
      await tx
        .delete(t.healthMeasurements)
        .where(
          and(
            eq(t.healthMeasurements.tenantId, tenantId),
            eq(t.healthMeasurements.measureId, value.measureId),
            eq(t.healthMeasurements.measuredOn, day),
          ),
        );
      continue;
    }
    const cm = cmFromInches(value.inches);
    await tx
      .insert(t.healthMeasurements)
      .values({ tenantId, measureId: value.measureId, measuredOn: day, cm })
      .onConflictDoUpdate({
        target: [t.healthMeasurements.tenantId, t.healthMeasurements.measureId, t.healthMeasurements.measuredOn],
        set: { cm, updatedAt: now },
      });
  }
}

/** The tape measures taken from `from` to `to`, oldest first. */
export async function measurementsBetween(tx: Tx, tenantId: string, from: string, to: string): Promise<MeasurementRow[]> {
  const t = schema;
  return tx
    .select(measurementColumns)
    .from(t.healthMeasurements)
    .where(
      and(eq(t.healthMeasurements.tenantId, tenantId), gte(t.healthMeasurements.measuredOn, from), lte(t.healthMeasurements.measuredOn, to)),
    )
    .orderBy(asc(t.healthMeasurements.measuredOn));
}

/** Every tape measure taken, oldest first: Body. */
export async function allMeasurements(tx: Tx, tenantId: string): Promise<MeasurementRow[]> {
  const t = schema;
  return tx
    .select(measurementColumns)
    .from(t.healthMeasurements)
    .where(eq(t.healthMeasurements.tenantId, tenantId))
    .orderBy(asc(t.healthMeasurements.measuredOn));
}

/** The latest day any tape measure was taken, on or before a day; null when none was. */
export async function lastMeasuredOn(tx: Tx, tenantId: string, onOrBefore: string): Promise<string | null> {
  const t = schema;
  const [row] = await tx
    .select({ day: t.healthMeasurements.measuredOn })
    .from(t.healthMeasurements)
    .where(and(eq(t.healthMeasurements.tenantId, tenantId), lte(t.healthMeasurements.measuredOn, onOrBefore)))
    .orderBy(desc(t.healthMeasurements.measuredOn))
    .limit(1);
  return row?.day ?? null;
}
