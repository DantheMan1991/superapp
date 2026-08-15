import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Asset } from "@/db/schema";
import { upsertDimensionMember, archiveDimensionMember } from "@/modules/accounting/core";
import { listDimensionMembers } from "@/modules/accounting/core";
import { isValidAssetKind } from "./vocabulary";

/**
 * Asset operations. Every function takes a `Tx` so the caller owns the
 * transaction — which is not a style preference here but the whole point:
 *
 * **A write and its dimension sync happen in ONE transaction.**
 *
 * `dimension_members` is the seam core opened for exactly this
 * ([dimensions.ts:9](../../modules/accounting/core/dimensions.ts:9)) — a pack
 * mirrors its entities in, and core never imports a pack table. If the two
 * could land separately, an asset would exist that the P&L cannot group by,
 * or a cost object would point at a row that was rolled back. This pack is
 * that seam's FIRST CALLER, so the shape here is the worked example the next
 * pack copies.
 */

/** The dimension type this pack owns. Core stores it; only this pack means anything by it. */
export const ASSET_DIMENSION = "asset";

export class AssetError extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_KIND"
      | "PARENT_INVALID"
      | "PARENT_CYCLE"
      | "NOT_DEPRECIABLE"
      | "DEPRECIATION_ACCOUNTS",
    message: string,
  ) {
    super(message);
    this.name = "AssetError";
  }
}

export interface AssetCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/**
 * Capital is owner territory.
 *
 * What something cost and whether it has been disposed of are decisions with a
 * tax consequence, so they sit with the ledger's own bar rather than with
 * general membership. It is also forced from below: `upsertDimensionMember`
 * calls `requireOwnerRole`, so a staff-created asset could not sync its cost
 * object and would be invisible to every report — a worse outcome than a
 * refusal. RLS stays member-wide because READING what the business owns is
 * ordinary work (see drizzle/0126_assets_rls.sql).
 */
function requireOwner(ctx: AssetCtx): void {
  if (ctx.role !== "owner") {
    throw new AssetError("FORBIDDEN", "owner role required");
  }
}

export async function listAssets(
  tx: Tx,
  tenantId: string,
  filter: { kind?: string; status?: string } = {},
): Promise<Asset[]> {
  const where = [eq(schema.assets.tenantId, tenantId)];
  if (filter.kind) where.push(eq(schema.assets.kind, filter.kind));
  if (filter.status) where.push(eq(schema.assets.status, filter.status));
  return tx.query.assets.findMany({
    where: and(...where),
    orderBy: (a, { asc: byAsc }) => [byAsc(a.kind), byAsc(a.name)],
  });
}

export async function getAsset(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<Asset | null> {
  const row = await tx.query.assets.findFirst({
    where: and(eq(schema.assets.tenantId, tenantId), eq(schema.assets.id, id)),
  });
  return row ?? null;
}

/** What is inside this one. Containment is one level per call, not a tree walk. */
export async function listChildren(
  tx: Tx,
  tenantId: string,
  parentId: string,
): Promise<Asset[]> {
  return tx.query.assets.findMany({
    where: and(
      eq(schema.assets.tenantId, tenantId),
      eq(schema.assets.parentId, parentId),
    ),
    orderBy: (a, { asc: byAsc }) => [byAsc(a.name)],
  });
}

/** Assets that can hold something: everything active, excluding a subtree. */
export async function listContainerCandidates(
  tx: Tx,
  tenantId: string,
  excludeId?: string,
): Promise<Asset[]> {
  const rows = await tx.query.assets.findMany({
    where: and(
      eq(schema.assets.tenantId, tenantId),
      eq(schema.assets.status, "active"),
    ),
    orderBy: (a, { asc: byAsc }) => [byAsc(a.name)],
  });
  if (!excludeId) return rows;
  // Excluding only the row itself would still allow parenting it to its own
  // descendant. The full descendant set is small and this list is a picker, so
  // it is cheaper to compute here than to explain a rejected save afterwards.
  const banned = await descendantIds(tx, tenantId, excludeId);
  banned.add(excludeId);
  return rows.filter((r) => !banned.has(r.id));
}

/** Every asset beneath `rootId`, exclusive. Iterative — depth is unbounded. */
async function descendantIds(
  tx: Tx,
  tenantId: string,
  rootId: string,
): Promise<Set<string>> {
  const seen = new Set<string>();
  let frontier = [rootId];
  while (frontier.length > 0) {
    // `inArray`, NOT sql`= any(${frontier})`. Interpolating a JS array into a
    // raw fragment binds it as ONE parameter, and Postgres rejects it with
    // `malformed array literal`. It shipped that way and every caller that
    // passes a `movingId` threw — which is to say the cycle guard below never
    // ran once. Caught by tests/assets-ops.test.ts, which is the argument for
    // that file existing.
    const children = await tx.query.assets.findMany({
      where: and(
        eq(schema.assets.tenantId, tenantId),
        inArray(schema.assets.parentId, frontier),
      ),
      columns: { id: true },
    });
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      frontier.push(child.id);
    }
  }
  return seen;
}

/**
 * A parent must exist, be in this tenant, and not be inside the asset it is
 * about to contain.
 *
 * The `assets_parent_not_self` CHECK catches only the one-row case; a CHECK
 * cannot see other rows, so a two-step cycle (A in B, B in A) has to be
 * refused here. Left unguarded it would make `descendantIds` loop forever.
 */
async function assertParentUsable(
  tx: Tx,
  tenantId: string,
  parentId: string,
  movingId?: string,
): Promise<void> {
  const parent = await getAsset(tx, tenantId, parentId);
  if (!parent) throw new AssetError("PARENT_INVALID", "parent not found");
  if (!movingId) return;
  if (parentId === movingId) {
    throw new AssetError("PARENT_CYCLE", "an asset cannot contain itself");
  }
  const below = await descendantIds(tx, tenantId, movingId);
  if (below.has(parentId)) {
    throw new AssetError(
      "PARENT_CYCLE",
      "that would put the asset inside something it already contains",
    );
  }
}

export interface AssetInput {
  kind: string;
  name: string;
  identifier?: string;
  /** Manufacturer's model — what it IS, as opposed to which one it is. */
  model?: string;
  acquiredOn?: string | null;
  acquisitionCostCents?: number | null;
  parentId?: string | null;
  notes?: string;
  /**
   * Depreciation settings. All four move together: the
   * `assets_depreciable_is_complete` CHECK refuses a method other than `none`
   * without an in-service date, a life and a cost, so a partial update that
   * sets only the method is rejected by the database rather than producing an
   * asset that depreciates by nothing.
   */
  inServiceOn?: string | null;
  /** Which fixed-asset account carries this asset's cost. */
  assetAccountId?: string | null;
  depreciationMethod?: string;
  usefulLifeMonths?: number | null;
  salvageValueCents?: number | null;
}

export async function createAsset(
  tx: Tx,
  ctx: AssetCtx,
  input: AssetInput,
): Promise<Asset> {
  requireOwner(ctx);
  const kind = input.kind.trim().toLowerCase();
  if (!isValidAssetKind(kind)) {
    throw new AssetError("INVALID_KIND", `invalid asset kind: ${input.kind}`);
  }
  if (input.parentId) {
    await assertParentUsable(tx, ctx.tenantId, input.parentId);
  }

  const rows = await tx
    .insert(schema.assets)
    .values({
      tenantId: ctx.tenantId,
      kind,
      name: input.name.trim(),
      identifier: input.identifier?.trim() ?? "",
      model: input.model?.trim() ?? "",
      acquiredOn: input.acquiredOn ?? null,
      acquisitionCostCents: input.acquisitionCostCents ?? null,
      inServiceOn: input.inServiceOn ?? null,
      assetAccountId: input.assetAccountId ?? null,
      depreciationMethod: input.depreciationMethod ?? "none",
      usefulLifeMonths: input.usefulLifeMonths ?? null,
      salvageValueCents: input.salvageValueCents ?? null,
      parentId: input.parentId ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  const asset = rows[0];

  // Same transaction, always. See the file header.
  await upsertDimensionMember(tx, ctx, {
    dimensionType: ASSET_DIMENSION,
    packEntityId: asset.id,
    displayName: asset.name,
  });

  return asset;
}

export async function updateAsset(
  tx: Tx,
  ctx: AssetCtx,
  id: string,
  input: Partial<AssetInput>,
): Promise<Asset> {
  requireOwner(ctx);
  const existing = await getAsset(tx, ctx.tenantId, id);
  if (!existing) throw new AssetError("NOT_FOUND", `asset ${id} not found`);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.kind !== undefined) {
    const kind = input.kind.trim().toLowerCase();
    if (!isValidAssetKind(kind)) {
      throw new AssetError("INVALID_KIND", `invalid asset kind: ${input.kind}`);
    }
    patch.kind = kind;
  }
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.identifier !== undefined) patch.identifier = input.identifier.trim();
  if (input.model !== undefined) patch.model = input.model.trim();
  if (input.acquiredOn !== undefined) patch.acquiredOn = input.acquiredOn;
  if (input.acquisitionCostCents !== undefined) {
    patch.acquisitionCostCents = input.acquisitionCostCents;
  }
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  if (input.inServiceOn !== undefined) patch.inServiceOn = input.inServiceOn;
  if (input.assetAccountId !== undefined) {
    patch.assetAccountId = input.assetAccountId;
  }
  if (input.depreciationMethod !== undefined) {
    patch.depreciationMethod = input.depreciationMethod;
  }
  if (input.usefulLifeMonths !== undefined) {
    patch.usefulLifeMonths = input.usefulLifeMonths;
  }
  if (input.salvageValueCents !== undefined) {
    patch.salvageValueCents = input.salvageValueCents;
  }
  if (input.parentId !== undefined) {
    if (input.parentId) {
      await assertParentUsable(tx, ctx.tenantId, input.parentId, id);
    }
    patch.parentId = input.parentId;
  }

  const rows = await tx
    .update(schema.assets)
    .set(patch)
    .where(
      and(eq(schema.assets.tenantId, ctx.tenantId), eq(schema.assets.id, id)),
    )
    .returning();
  const asset = rows[0];

  // The member's display name is a COPY, so a rename that skipped this would
  // leave every report labelling the asset by its old name.
  if (input.name !== undefined) {
    await upsertDimensionMember(tx, ctx, {
      dimensionType: ASSET_DIMENSION,
      packEntityId: asset.id,
      displayName: asset.name,
    });
  }
  return asset;
}

/**
 * Dispose of an asset. NOT a delete.
 *
 * Its cost, its history and every journal line tagged with it stay exactly
 * where they are — an asset that earned and cost money for six years does not
 * stop having done so when it is sold. The dimension member is archived rather
 * than removed for the same reason: `archiveDimensionMember`'s own comment
 * says archived members stop being taggable while existing tags keep reporting,
 * which is precisely the behaviour a disposal wants.
 */
export async function disposeAsset(
  tx: Tx,
  ctx: AssetCtx,
  id: string,
  disposedOn: string,
): Promise<Asset> {
  requireOwner(ctx);
  const existing = await getAsset(tx, ctx.tenantId, id);
  if (!existing) throw new AssetError("NOT_FOUND", `asset ${id} not found`);

  const rows = await tx
    .update(schema.assets)
    .set({ status: "disposed", disposedOn, updatedAt: new Date() })
    .where(
      and(eq(schema.assets.tenantId, ctx.tenantId), eq(schema.assets.id, id)),
    )
    .returning();

  const members = await listDimensionMembers(tx, ctx.tenantId, ASSET_DIMENSION);
  const member = members.find((m) => m.packEntityId === id);
  if (member) {
    await archiveDimensionMember(tx, ctx, { memberId: member.id });
  }
  return rows[0];
}

/** Kinds actually in use, for the filter bar. Cheap: one grouped index scan. */
export async function listKindsInUse(
  tx: Tx,
  tenantId: string,
): Promise<{ kind: string; count: number }[]> {
  return tx
    .select({
      kind: schema.assets.kind,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.assets)
    .where(eq(schema.assets.tenantId, tenantId))
    .groupBy(schema.assets.kind)
    .orderBy(asc(schema.assets.kind));
}

/** Top-level assets — the ones not inside anything. */
export async function listRoots(tx: Tx, tenantId: string): Promise<Asset[]> {
  return tx.query.assets.findMany({
    where: and(
      eq(schema.assets.tenantId, tenantId),
      isNull(schema.assets.parentId),
    ),
    orderBy: (a, { asc: byAsc }) => [byAsc(a.name)],
  });
}
