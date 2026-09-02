import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { DimensionMember } from "@/db/schema";
import { LedgerError } from "./errors";
import { requireOwnerRole } from "./guards";
import type { LedgerCtx } from "./types";

/**
 * The pack seam. Industry packs sync their entities (properties, jobs,
 * cost codes…) into dimension_members in the SAME transaction as their own
 * entity CRUD — the core never imports pack tables.
 */

/**
 * **THE ONE MEMBER VALIDATOR.** Every id must name a member that exists and is
 * active, and no line may carry two members of one dimension type. Returns the
 * members by id so a caller can read each one's type.
 *
 * Lifted here on 2026-09-01 from three private copies — the posting engine's
 * `loadDimensionMembers`, and a `validateLineDimensions` in each of the invoice
 * and bill modules — on the day a fourth caller arrived (a recurring template
 * checked at save). Three copies of one rule is how one of them drifts; the
 * codable-account check learnt the same lesson the same day.
 */
export async function loadDimensionMembers(
  tx: Tx,
  tenantId: string,
  lines: ReadonlyArray<{ dimensionMemberIds?: string[] }>,
): Promise<Map<string, DimensionMember>> {
  const allIds = [...new Set(lines.flatMap((l) => l.dimensionMemberIds ?? []))];
  if (allIds.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.dimensionMembers)
    .where(
      and(
        eq(schema.dimensionMembers.tenantId, tenantId),
        inArray(schema.dimensionMembers.id, allIds),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of allIds) {
    const member = byId.get(id);
    if (!member || !member.isActive) {
      throw new LedgerError("DIMENSION_INVALID", `dimension member ${id} invalid`);
    }
  }
  for (const line of lines) {
    const types = new Set<string>();
    for (const id of line.dimensionMemberIds ?? []) {
      const t = byId.get(id)!.dimensionType;
      if (types.has(t)) {
        throw new LedgerError(
          "DIMENSION_INVALID",
          `line tags two members of dimension type ${t}`,
        );
      }
      types.add(t);
    }
  }
  return byId;
}

/** Read helper for report selectors and column labels. */
export async function listDimensionMembers(
  tx: Tx,
  tenantId: string,
  dimensionType?: string,
): Promise<DimensionMember[]> {
  return tx.query.dimensionMembers.findMany({
    where: dimensionType
      ? and(
          eq(schema.dimensionMembers.tenantId, tenantId),
          eq(schema.dimensionMembers.dimensionType, dimensionType),
        )
      : eq(schema.dimensionMembers.tenantId, tenantId),
    orderBy: (m, { asc }) => asc(m.displayName),
  });
}

export async function upsertDimensionMember(
  tx: Tx,
  ctx: LedgerCtx,
  input: { dimensionType: string; packEntityId: string; displayName: string },
): Promise<DimensionMember> {
  requireOwnerRole(ctx);
  const rows = await tx
    .insert(schema.dimensionMembers)
    .values({
      tenantId: ctx.tenantId,
      dimensionType: input.dimensionType,
      packEntityId: input.packEntityId,
      displayName: input.displayName,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [
        schema.dimensionMembers.tenantId,
        schema.dimensionMembers.dimensionType,
        schema.dimensionMembers.packEntityId,
      ],
      set: {
        displayName: input.displayName,
        isActive: true,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

/** Archived members stop being taggable; existing tags keep reporting. */
export async function archiveDimensionMember(
  tx: Tx,
  ctx: LedgerCtx,
  args: { memberId: string },
): Promise<DimensionMember> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.dimensionMembers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.dimensionMembers.tenantId, ctx.tenantId),
        eq(schema.dimensionMembers.id, args.memberId),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("DIMENSION_INVALID", `member ${args.memberId} not found`);
  }
  return rows[0];
}
