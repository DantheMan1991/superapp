import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobEstimateOutlineMeasure, JobMeasurement } from "@/db/schema";
import { JobsError, requireWrite, type JobsCtx } from "./ops";
import {
  measureSlug,
  type DeclaredMeasure,
  type TakenMeasure,
} from "./measure-math";
import { isMeasureKind } from "./vocabulary";

/**
 * THE HOUSE'S NUMBERS, WRITTEN DOWN (X7). `measure-math.ts` has the
 * reasoning; this is the half that touches the database.
 *
 * ── THE NAME IS THE KEY, AND IT IS THE PROJECT'S ────────────────────────────
 *
 * `recordMeasurement` is an upsert on `(tenant, project, slug)`, so
 * re-measuring the wall perimeter corrects the number rather than making a
 * second one. That is what makes a measurement a fact about the BUILDING:
 * two walks, three estimate revisions and a takeoff pushed from a drawing
 * all read and write the same row.
 *
 * ── AND RE-MEASURING CLEARS THE PASS ────────────────────────────────────────
 *
 * A pass says *not now*; giving the number later has to undo it, or the
 * walk's own "what is still outstanding" would go on lying about a building
 * that has been measured.
 */

/* -------------------------------------------------- what the outline wants */

/**
 * **THE LIST IS OWNER WORK; TAKING THE NUMBERS IS NOT.** Deciding what this
 * business measures before it prices a job is the same kind of decision as
 * deciding the steps, and `createOutline` is owner-only for that reason.
 * Going and measuring a building is a chore, so the half below is
 * member-wide — the split the whole pack keeps.
 */

export async function listOutlineMeasures(
  tx: Tx,
  tenantId: string,
  outlineId: string,
): Promise<JobEstimateOutlineMeasure[]> {
  return tx
    .select()
    .from(schema.jobEstimateOutlineMeasures)
    .where(
      and(
        eq(schema.jobEstimateOutlineMeasures.tenantId, tenantId),
        eq(schema.jobEstimateOutlineMeasures.outlineId, outlineId),
      ),
    )
    .orderBy(
      asc(schema.jobEstimateOutlineMeasures.sortOrder),
      asc(schema.jobEstimateOutlineMeasures.name),
    );
}

/** The rows as the pure half reads them. An unknown kind reads as a length. */
export function asDeclared(rows: readonly JobEstimateOutlineMeasure[]): DeclaredMeasure[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    kind: isMeasureKind(r.kind) ? r.kind : "length",
    guidance: r.guidance,
    required: r.required,
  }));
}

export async function getOutlineMeasure(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<JobEstimateOutlineMeasure | null> {
  const rows = await tx
    .select()
    .from(schema.jobEstimateOutlineMeasures)
    .where(
      and(
        eq(schema.jobEstimateOutlineMeasures.tenantId, tenantId),
        eq(schema.jobEstimateOutlineMeasures.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface OutlineMeasureInput {
  name: string;
  unit: string;
  kind: string;
  guidance: string;
  required: boolean;
}

export async function createOutlineMeasure(
  tx: Tx,
  ctx: JobsCtx,
  outlineId: string,
  input: OutlineMeasureInput,
): Promise<JobEstimateOutlineMeasure> {
  requireWrite(ctx, "owner");
  const existing = await listOutlineMeasures(tx, ctx.tenantId, outlineId);
  /** The database refuses a duplicate name; say so in words first. */
  if (existing.some((m) => measureSlug(m.name) === measureSlug(input.name))) {
    throw new JobsError("NAME_TAKEN", `this outline already asks for ${input.name.trim()}`);
  }
  const rows = await tx
    .insert(schema.jobEstimateOutlineMeasures)
    .values({
      tenantId: ctx.tenantId,
      outlineId,
      sortOrder: existing.length,
      name: input.name.trim(),
      unit: input.unit.trim(),
      kind: isMeasureKind(input.kind) ? input.kind : "length",
      guidance: input.guidance.trim(),
      required: input.required,
    })
    .returning();
  return rows[0];
}

export async function updateOutlineMeasure(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: OutlineMeasureInput & { version: number },
): Promise<JobEstimateOutlineMeasure> {
  requireWrite(ctx, "owner");
  const rows = await tx
    .update(schema.jobEstimateOutlineMeasures)
    .set({
      name: input.name.trim(),
      unit: input.unit.trim(),
      kind: isMeasureKind(input.kind) ? input.kind : "length",
      guidance: input.guidance.trim(),
      required: input.required,
      version: input.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.jobEstimateOutlineMeasures.tenantId, ctx.tenantId),
        eq(schema.jobEstimateOutlineMeasures.id, id),
        eq(schema.jobEstimateOutlineMeasures.version, input.version),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new JobsError("STALE_VERSION", "measurement changed since loaded");
  }
  return rows[0];
}

export async function deleteOutlineMeasure(tx: Tx, ctx: JobsCtx, id: string): Promise<void> {
  requireWrite(ctx, "owner");
  await tx
    .delete(schema.jobEstimateOutlineMeasures)
    .where(
      and(
        eq(schema.jobEstimateOutlineMeasures.tenantId, ctx.tenantId),
        eq(schema.jobEstimateOutlineMeasures.id, id),
      ),
    );
}

/** The list in the order somebody dragged them into. */
export async function reorderOutlineMeasures(
  tx: Tx,
  ctx: JobsCtx,
  outlineId: string,
  ids: readonly string[],
): Promise<void> {
  requireWrite(ctx, "owner");
  for (const [at, id] of ids.entries()) {
    await tx
      .update(schema.jobEstimateOutlineMeasures)
      .set({ sortOrder: at, updatedAt: new Date() })
      .where(
        and(
          eq(schema.jobEstimateOutlineMeasures.tenantId, ctx.tenantId),
          eq(schema.jobEstimateOutlineMeasures.outlineId, outlineId),
          eq(schema.jobEstimateOutlineMeasures.id, id),
        ),
      );
  }
}

/* ------------------------------------------------ what the building measures */

export async function listMeasurements(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<JobMeasurement[]> {
  return tx
    .select()
    .from(schema.jobMeasurements)
    .where(
      and(
        eq(schema.jobMeasurements.tenantId, tenantId),
        eq(schema.jobMeasurements.projectId, projectId),
      ),
    )
    .orderBy(asc(schema.jobMeasurements.takenAt));
}

/** The rows as the pure half reads them. */
export function asTaken(rows: readonly JobMeasurement[]): TakenMeasure[] {
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    unit: r.unit,
    valueThousandths: r.valueThousandths,
    passed: r.passedAt !== null,
    note: r.note,
  }));
}

export interface MeasurementInput {
  projectId: string;
  name: string;
  unit: string;
  valueThousandths: number;
  source?: "measured" | "said" | "derived";
  note?: string;
  sheetId?: string | null;
  markupId?: string | null;
}

/**
 * **ONE NUMBER PER NAME PER BUILDING.** Written fresh or corrected in place,
 * by the unique index rather than by a read-then-write that two tabs could
 * race. Re-measuring clears a pass, because the pass was *not now*.
 */
export async function recordMeasurement(
  tx: Tx,
  ctx: JobsCtx,
  input: MeasurementInput,
): Promise<JobMeasurement> {
  requireWrite(ctx, "member");
  const name = input.name.trim();
  const slug = measureSlug(name);
  if (slug === "") throw new JobsError("INVALID_VALUE", "a measurement needs a name");
  if (!Number.isFinite(input.valueThousandths) || input.valueThousandths <= 0) {
    throw new JobsError("INVALID_VALUE", "a measurement is more than nothing");
  }
  const rows = await tx
    .insert(schema.jobMeasurements)
    .values({
      tenantId: ctx.tenantId,
      projectId: input.projectId,
      name,
      slug,
      unit: input.unit.trim(),
      valueThousandths: Math.round(input.valueThousandths),
      source: input.source ?? "said",
      note: (input.note ?? "").trim(),
      passedAt: null,
      sheetId: input.sheetId ?? null,
      markupId: input.markupId ?? null,
      takenByClerkUserId: ctx.userId,
      takenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.jobMeasurements.tenantId,
        schema.jobMeasurements.projectId,
        schema.jobMeasurements.slug,
      ],
      set: {
        name,
        unit: input.unit.trim(),
        valueThousandths: Math.round(input.valueThousandths),
        source: input.source ?? "said",
        note: (input.note ?? "").trim(),
        /** A number given now undoes a "not now". */
        passedAt: null,
        sheetId: input.sheetId ?? null,
        markupId: input.markupId ?? null,
        takenByClerkUserId: ctx.userId,
        takenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

/** Not on this job, or not known yet. It sticks, so the walk stops asking. */
export async function passMeasurement(
  tx: Tx,
  ctx: JobsCtx,
  input: { projectId: string; name: string; unit: string; note?: string },
): Promise<void> {
  requireWrite(ctx, "member");
  const name = input.name.trim();
  const slug = measureSlug(name);
  if (slug === "") throw new JobsError("INVALID_VALUE", "a measurement needs a name");
  await tx
    .insert(schema.jobMeasurements)
    .values({
      tenantId: ctx.tenantId,
      projectId: input.projectId,
      name,
      slug,
      unit: input.unit.trim(),
      valueThousandths: null,
      source: "said",
      note: (input.note ?? "").trim(),
      passedAt: new Date(),
      takenByClerkUserId: ctx.userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.jobMeasurements.tenantId,
        schema.jobMeasurements.projectId,
        schema.jobMeasurements.slug,
      ],
      set: {
        /**
         * **A PASS DOES NOT WIPE A NUMBER THAT IS ALREADY THERE.** Passing
         * something already measured is somebody moving on, not somebody
         * deleting a measurement — that is what `forgetMeasurement` is for.
         */
        passedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

export async function forgetMeasurement(
  tx: Tx,
  ctx: JobsCtx,
  projectId: string,
  slug: string,
): Promise<void> {
  requireWrite(ctx, "member");
  await tx
    .delete(schema.jobMeasurements)
    .where(
      and(
        eq(schema.jobMeasurements.tenantId, ctx.tenantId),
        eq(schema.jobMeasurements.projectId, projectId),
        eq(schema.jobMeasurements.slug, slug),
      ),
    );
}
