import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobAssembly, JobAssemblyLine } from "@/db/schema";
import { violatedUniqueIndex } from "@/lib/db-errors";
import {
  explodeAssembly,
  resolveCostCode,
  type AssemblyLineShape,
  type ExplodedLine,
} from "./assembly-math";
import { JobsError, requireWrite, type JobsCtx } from "./ops";

/**
 * THE ASSEMBLY LIBRARY (E6, ADR 0086) — saved items, and the items they make.
 *
 * **Built backwards on purpose.** `saveItemAsAssembly` comes first and reads
 * an item somebody has already priced; `linesForDrop` comes second. Nobody
 * ever fills in an assembly library up front, so the library assembles itself
 * out of real work.
 *
 * **An assembly belongs to the TENANT, not to a job** — it is the one thing in
 * estimating that outlives the estimate it came from. Its rows carry no
 * project, because a project would be a lie about where the next one is going.
 */

/** The picker's row: enough to choose by, without the lines. */
export interface AssemblyRow {
  assembly: JobAssembly;
  lineCount: number;
  /** What one of it costs, at the size it was saved — the only figure the picker needs. */
  costCents: number;
}

export async function listAssemblies(tx: Tx, tenantId: string): Promise<AssemblyRow[]> {
  const rows = await tx
    .select()
    .from(schema.jobAssemblies)
    .where(eq(schema.jobAssemblies.tenantId, tenantId))
    .orderBy(asc(schema.jobAssemblies.name));
  if (rows.length === 0) return [];
  const totals = await tx
    .select({
      assemblyId: schema.jobAssemblyLines.assemblyId,
      lineCount: sql<number>`count(*)::int`,
      costCents: sql<number>`coalesce(sum(${schema.jobAssemblyLines.quantityThousandths} * ${schema.jobAssemblyLines.unitCostCents} / 1000), 0)::bigint`.mapWith(
        Number,
      ),
    })
    .from(schema.jobAssemblyLines)
    .where(eq(schema.jobAssemblyLines.tenantId, tenantId))
    .groupBy(schema.jobAssemblyLines.assemblyId);
  const by = new Map(totals.map((t) => [t.assemblyId, t]));
  return rows.map((assembly) => ({
    assembly,
    lineCount: by.get(assembly.id)?.lineCount ?? 0,
    costCents: by.get(assembly.id)?.costCents ?? 0,
  }));
}

export async function getAssembly(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<{ assembly: JobAssembly; lines: JobAssemblyLine[] } | null> {
  const rows = await tx
    .select()
    .from(schema.jobAssemblies)
    .where(and(eq(schema.jobAssemblies.tenantId, tenantId), eq(schema.jobAssemblies.id, id)))
    .limit(1);
  if (rows.length === 0) return null;
  const lines = await tx
    .select()
    .from(schema.jobAssemblyLines)
    .where(
      and(eq(schema.jobAssemblyLines.tenantId, tenantId), eq(schema.jobAssemblyLines.assemblyId, id)),
    )
    .orderBy(asc(schema.jobAssemblyLines.sortOrder), asc(schema.jobAssemblyLines.createdAt));
  return { assembly: rows[0], lines };
}

export interface SaveAssemblyInput {
  name: string;
  clientNote: string;
  notes: string;
  drivingQuantityThousandths: number;
  drivingUnit: string;
  lines: readonly AssemblyLineShape[];
}

/**
 * SAVE AN ITEM AS AN ASSEMBLY.
 *
 * The lines arrive already shaped by the caller from an item the estimator is
 * looking at — this does not read the estimate, so the same verb serves an
 * item on screen that has not been saved yet. **A blank-description line is
 * dropped** rather than refused: the editor always carries one empty row, and
 * refusing the whole save because of it would be the feature failing on the
 * commonest input it will ever see.
 */
export async function saveItemAsAssembly(
  tx: Tx,
  ctx: JobsCtx,
  input: SaveAssemblyInput,
): Promise<JobAssembly> {
  requireWrite(ctx, "member");
  const name = input.name.trim();
  if (name === "") throw new JobsError("INVALID_VALUE", "an assembly needs a name");
  if (input.drivingQuantityThousandths <= 0) {
    throw new JobsError("INVALID_VALUE", "an assembly has to be per something more than nothing");
  }
  const lines = input.lines.filter((l) => l.description.trim() !== "");
  if (lines.length === 0) throw new JobsError("NO_LINES", "an assembly with no lines is not one");

  let assembly: JobAssembly;
  try {
    const rows = await tx
      .insert(schema.jobAssemblies)
      .values({
        tenantId: ctx.tenantId,
        name,
        clientNote: input.clientNote.trim(),
        notes: input.notes.trim(),
        drivingQuantityThousandths: input.drivingQuantityThousandths,
        drivingUnit: input.drivingUnit.trim(),
        createdByClerkUserId: ctx.userId,
      })
      .returning();
    assembly = rows[0];
  } catch (err) {
    // It returns the constraint NAME, not a boolean — the drizzle err.cause trap.
    if (violatedUniqueIndex(err) === "job_assemblies_tenant_name_idx") {
      throw new JobsError("NAME_TAKEN", `you already have an assembly called ${name}`);
    }
    throw err;
  }

  await tx.insert(schema.jobAssemblyLines).values(
    lines.map((l, i) => ({
      tenantId: ctx.tenantId,
      assemblyId: assembly.id,
      description: l.description.trim(),
      clientDescription: l.clientDescription.trim(),
      clientVisible: l.clientVisible,
      unit: l.unit.trim(),
      quantityThousandths: l.quantityThousandths,
      unitCostCents: l.unitCostCents,
      markupPpm: l.markupPpm,
      unitPriceCents: l.unitPriceCents,
      costCode: l.costCode.trim(),
      sortOrder: (i + 1) * 10,
    })),
  );
  return assembly;
}

/** Take one out of the library. Nothing it made is touched — those are lines on a job. */
export async function deleteAssembly(tx: Tx, ctx: JobsCtx, id: string): Promise<void> {
  requireWrite(ctx, "member");
  const rows = await tx
    .delete(schema.jobAssemblies)
    .where(and(eq(schema.jobAssemblies.tenantId, ctx.tenantId), eq(schema.jobAssemblies.id, id)))
    .returning({ id: schema.jobAssemblies.id });
  if (rows.length === 0) throw new JobsError("NOT_FOUND", "assembly not found");
}

/** A dropped line, with the target job's own code resolved onto it. */
export interface DroppedLine extends ExplodedLine {
  /** The code on THIS job's set, or null when it has no such code. */
  costCodeId: string | null;
}

/**
 * THE LINES AN ASSEMBLY MAKES ON THIS JOB, at the size asked for.
 *
 * Two things happen here and nowhere else: the quantities scale (pure, in
 * `assembly-math.ts`) and the written cost code is resolved against the cost
 * code set THIS job uses. A code the set has not got leaves the line uncoded,
 * which still prices and is merely left out of the budget — the visible
 * outcome, rather than a line filed under a code somebody else meant.
 */
export async function linesForDrop(
  tx: Tx,
  tenantId: string,
  assemblyId: string,
  wantedThousandths: number,
  costCodeSetId: string | null,
): Promise<{ assembly: JobAssembly; lines: DroppedLine[] } | null> {
  const found = await getAssembly(tx, tenantId, assemblyId);
  if (!found) return null;

  const codes = costCodeSetId
    ? await tx
        .select({ id: schema.jobCostCodes.id, code: schema.jobCostCodes.code })
        .from(schema.jobCostCodes)
        .where(
          and(
            eq(schema.jobCostCodes.tenantId, tenantId),
            eq(schema.jobCostCodes.setId, costCodeSetId),
            eq(schema.jobCostCodes.isActive, true),
          ),
        )
    : [];

  const exploded = explodeAssembly(found.assembly, found.lines, wantedThousandths);
  return {
    assembly: found.assembly,
    lines: exploded.map((l) => ({ ...l, costCodeId: resolveCostCode(l.costCode, codes) })),
  };
}
