import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { lineCostCents } from "./estimate-math";
import type { EstimateLineFacts } from "./walk-coverage";

/**
 * WHAT THE ESTIMATE ALREADY HAS, AS THE WALK READS IT (X17, ADR 0108).
 *
 * Every line on the estimate that this walk did not write — the takeoff off
 * the model, an item typed by hand, a previous walk's lines — with the code
 * number on this job's set and the name of the item it sits in, which are
 * the two facts a phase is matched on. The walk's own lines are found
 * through the proposed rows that remember them (X9) and left out here: they
 * are the walk's, and it already knows them.
 */
export async function onEstimateOf(
  tx: Tx,
  tenantId: string,
  interviewId: string,
  estimateId: string,
): Promise<EstimateLineFacts[]> {
  const [made, lines] = await Promise.all([
    tx
      .select({ id: schema.jobEstimateProposedLines.estimateLineId })
      .from(schema.jobEstimateProposedLines)
      .where(
        and(
          eq(schema.jobEstimateProposedLines.tenantId, tenantId),
          eq(schema.jobEstimateProposedLines.interviewId, interviewId),
          isNotNull(schema.jobEstimateProposedLines.estimateLineId),
        ),
      ),
    tx
      .select({
        id: schema.jobEstimateLines.id,
        description: schema.jobEstimateLines.description,
        quantityThousandths: schema.jobEstimateLines.quantityThousandths,
        unitCostCents: schema.jobEstimateLines.unitCostCents,
        basis: schema.jobEstimateLines.basis,
        basisDetail: schema.jobEstimateLines.basisDetail,
        groupName: schema.jobEstimateGroups.name,
        code: schema.jobCostCodes.code,
      })
      .from(schema.jobEstimateLines)
      .leftJoin(
        schema.jobEstimateGroups,
        and(
          eq(schema.jobEstimateGroups.tenantId, schema.jobEstimateLines.tenantId),
          eq(schema.jobEstimateGroups.id, schema.jobEstimateLines.groupId),
        ),
      )
      .leftJoin(
        schema.jobCostCodes,
        and(
          eq(schema.jobCostCodes.tenantId, schema.jobEstimateLines.tenantId),
          eq(schema.jobCostCodes.id, schema.jobEstimateLines.costCodeId),
        ),
      )
      .where(
        and(
          eq(schema.jobEstimateLines.tenantId, tenantId),
          eq(schema.jobEstimateLines.estimateId, estimateId),
        ),
      ),
  ]);
  const mine = new Set(made.map((m) => m.id).filter((id): id is string => id !== null));
  return lines
    .filter((l) => !mine.has(l.id))
    .map((l) => ({
      id: l.id,
      costCode: l.code ?? "",
      groupName: l.groupName ?? "",
      description: l.description,
      costCents: lineCostCents({
        quantityThousandths: l.quantityThousandths,
        unitCostCents: l.unitCostCents,
        markupPpm: null,
        unitPriceCents: null,
      }),
      basis: l.basis,
      basisDetail: l.basisDetail,
    }));
}

/** The library's names by id, for a phase pinned to an assembly (X11). */
export async function assemblyNamesOf(tx: Tx, tenantId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: schema.jobAssemblies.id, name: schema.jobAssemblies.name })
    .from(schema.jobAssemblies)
    .where(eq(schema.jobAssemblies.tenantId, tenantId));
  return new Map(rows.map((r) => [r.id, r.name]));
}
