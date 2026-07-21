import "server-only";
import { and, eq } from "drizzle-orm";
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
