import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { WorkError } from "@/lib/work/errors";
import {
  ensureDefaultWorkList,
  findDefaultWorkListId,
} from "@/lib/work/provision";
import {
  createItem,
  setAssignee,
  setItemState,
  updateItem,
} from "@/lib/work/items";
import type { WorkCtx, WorkWriteCtx } from "@/lib/work/with-work";

/**
 * Work that is ABOUT a record in another module.
 *
 * ============================================================================
 * WHY THIS IS IN `src/lib/` AND NOT IN THE WORK MODULE
 * ============================================================================
 *
 * CRM raises a follow-up on a customer, and a follow-up is now a work item
 * linked to that record. A module may not import another module, so CRM cannot
 * reach `src/modules/work/`. Everything CRM needs is here, and it is the same
 * code Work's own surfaces use rather than a parallel implementation — the
 * thing slice 5a moved the write path here to avoid.
 *
 * ── THE PAIR IS ATOMIC, AND THE CALLER'S TRANSACTION IS WHAT MAKES IT SO ─────
 *
 * An item without its link is a follow-up that has silently stopped being about
 * anything: it still appears in the digest, but the record it belonged to shows
 * nothing. Both writes go through the caller's `tx`, so either both land or
 * neither does. Nothing here opens its own transaction, and nothing calls
 * `withSystem`.
 */

export interface EntityRef {
  /** The provider that owns the type — `crm`, `accounting`, `documents`. */
  extensionSlug: string;
  /** A REGISTERED type. CRM's are `contact`, `company` and `deal`. */
  entityType: string;
  entityId: string;
}

/**
 * What a READ needs, which is less than a write.
 *
 * Every query here scopes by `tenant_id` and nothing else — who the caller is
 * has already been settled by the transaction's RLS context, which the caller
 * established. Taking only the tenant keeps CRM's existing read signatures
 * (`listTasksForParty(tx, tenantId, partyId)`) intact, so moving the storage
 * underneath them touched no page and no component.
 */
export type WorkReadCtx = Pick<WorkCtx, "tenantId">;

export interface EntityWorkInput {
  title: string;
  notes?: string;
  dueOn?: string | null;
  assignee?: string | null;
}

/**
 * One row, shaped the way a record page wants it rather than the way the table
 * stores it.
 *
 * `completedAt` rather than `closedAt` because that is the word the surfaces
 * calling this already use, and `notes` rather than `description` for the same
 * reason. This is a translation at the boundary, not a second model: there is
 * one row underneath and one write path onto it.
 */
export interface EntityWorkRow {
  id: string;
  title: string;
  notes: string;
  dueOn: string | null;
  assigneeClerkUserId: string | null;
  completedAt: Date | null;
  version: number;
  /** Every entity this item is attached to, so a caller can find its deal. */
  links: { entityType: string; entityId: string }[];
}


/**
 * The list a follow-up from another module lands in, PROVISIONING IT IF MISSING.
 *
 * `ensureDefaultWorkList` normally runs on membership sync, so in practice
 * every tenant has one. Throwing when it did not was wrong in a way that only
 * showed up under test: CRM's automation engine runs each action inside a
 * savepoint and swallows failures so a broken rule cannot roll back the
 * person's own work — so a tenant with no list would have had its rules
 * silently create nothing, with no error anywhere.
 *
 * Self-healing beats failing quietly. The insert is idempotent against the
 * partial unique index, so the common path costs one no-op.
 */
async function ensureListId(tx: Tx, ctx: WorkWriteCtx): Promise<string> {
  const existing = await findDefaultWorkListId(tx, ctx.tenantId);
  if (existing) return existing;
  await ensureDefaultWorkList(tx, ctx.tenantId);
  const created = await findDefaultWorkListId(tx, ctx.tenantId);
  if (!created) {
    throw new WorkError("NOT_FOUND", "this workspace has no work list yet");
  }
  return created;
}

/**
 * Raise work about a record.
 *
 * Lands in the tenant's DEFAULT list. A caller in another module has no
 * business picking a list — it cannot see which ones exist without reading
 * Work's tables directly, and "the place anything lands when nobody chose" is
 * exactly what the default list is for.
 */
export async function createWorkForEntity(
  tx: Tx,
  ctx: WorkWriteCtx,
  ref: EntityRef,
  input: EntityWorkInput,
): Promise<string> {
  const listId = await ensureListId(tx, ctx);
  const itemId = await createItem(tx, ctx, {
    listId,
    title: input.title,
    description: input.notes ?? "",
    dueOn: input.dueOn ?? null,
    assignee: input.assignee ?? null,
  });
  await tx
    .insert(schema.workItemLinks)
    .values({
      tenantId: ctx.tenantId,
      itemId,
      extensionSlug: ref.extensionSlug,
      entityType: ref.entityType,
      entityId: ref.entityId,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing();
  return itemId;
}

/**
 * Work about nothing in particular.
 *
 * `crm_tasks.party_id` was nullable so "ring the accountant back" had a home,
 * and that has to survive the move — a follow-up with no record attached is
 * still a real obligation. It lands in the default list with no link, which is
 * exactly what a work item created from Work's own UI looks like.
 */
export async function createUnlinkedWork(
  tx: Tx,
  ctx: WorkWriteCtx,
  input: EntityWorkInput,
): Promise<string> {
  const listId = await ensureListId(tx, ctx);
  return createItem(tx, ctx, {
    listId,
    title: input.title,
    description: input.notes ?? "",
    dueOn: input.dueOn ?? null,
    assignee: input.assignee ?? null,
  });
}

/** Specific items by id, with their links, in the same shape as the lists. */
export async function listWorkByIds(
  tx: Tx,
  ctx: WorkReadCtx,
  itemIds: readonly string[],
): Promise<EntityWorkRow[]> {
  if (itemIds.length === 0) return [];
  const items = await tx
    .select(ITEM_COLUMNS)
    .from(schema.workItems)
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        inArray(schema.workItems.id, [...itemIds]),
      ),
    );
  const links = await linksFor(tx, ctx, items.map((i) => i.id));
  return items.map((item) => toRow(item, links));
}

/** Hand work to somebody, or to nobody. Guards apply — see `items.ts`. */
export async function setWorkAssignee(
  tx: Tx,
  ctx: WorkWriteCtx,
  itemId: string,
  assignee: string | null,
): Promise<void> {
  await setAssignee(tx, ctx, itemId, assignee);
}

/** Attach an existing item to another record — a follow-up gaining a deal. */
export async function attachEntity(
  tx: Tx,
  ctx: WorkWriteCtx,
  itemId: string,
  ref: EntityRef,
): Promise<void> {
  await tx
    .insert(schema.workItemLinks)
    .values({
      tenantId: ctx.tenantId,
      itemId,
      extensionSlug: ref.extensionSlug,
      entityType: ref.entityType,
      entityId: ref.entityId,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing();
}

export async function detachEntityType(
  tx: Tx,
  ctx: WorkReadCtx,
  itemId: string,
  entityType: string,
): Promise<void> {
  await tx
    .delete(schema.workItemLinks)
    .where(
      and(
        eq(schema.workItemLinks.tenantId, ctx.tenantId),
        eq(schema.workItemLinks.itemId, itemId),
        eq(schema.workItemLinks.entityType, entityType),
      ),
    );
}

async function linksFor(
  tx: Tx,
  ctx: WorkReadCtx,
  itemIds: readonly string[],
): Promise<Map<string, { entityType: string; entityId: string }[]>> {
  const out = new Map<string, { entityType: string; entityId: string }[]>();
  if (itemIds.length === 0) return out;
  const rows = await tx
    .select({
      itemId: schema.workItemLinks.itemId,
      entityType: schema.workItemLinks.entityType,
      entityId: schema.workItemLinks.entityId,
    })
    .from(schema.workItemLinks)
    .where(
      and(
        eq(schema.workItemLinks.tenantId, ctx.tenantId),
        inArray(schema.workItemLinks.itemId, [...itemIds]),
      ),
    );
  for (const row of rows) {
    const bucket = out.get(row.itemId);
    const entry = { entityType: row.entityType, entityId: row.entityId };
    if (bucket) bucket.push(entry);
    else out.set(row.itemId, [entry]);
  }
  return out;
}

function toRow(
  item: {
    id: string;
    title: string;
    description: string;
    dueOn: string | null;
    assigneeClerkUserId: string | null;
    closedAt: Date | null;
    version: number;
  },
  links: Map<string, { entityType: string; entityId: string }[]>,
): EntityWorkRow {
  return {
    id: item.id,
    title: item.title,
    notes: item.description,
    dueOn: item.dueOn,
    assigneeClerkUserId: item.assigneeClerkUserId,
    completedAt: item.closedAt,
    version: item.version,
    links: links.get(item.id) ?? [],
  };
}

const ITEM_COLUMNS = {
  id: schema.workItems.id,
  title: schema.workItems.title,
  description: schema.workItems.description,
  dueOn: schema.workItems.dueOn,
  assigneeClerkUserId: schema.workItems.assigneeClerkUserId,
  closedAt: schema.workItems.closedAt,
  version: schema.workItems.version,
};

/**
 * Everything attached to one record.
 *
 * RLS decides membership of this list twice over: the item has to be visible,
 * and so does the link. Nothing here filters on visibility.
 */
export async function listWorkForEntity(
  tx: Tx,
  ctx: WorkReadCtx,
  ref: { entityType: string | readonly string[]; entityId: string },
): Promise<EntityWorkRow[]> {
  /*
   * `entityType` takes a LIST as well as one value, and CRM is why.
   *
   * A party is a `contact` or a `company` depending on `parties.kind`, so a
   * record page asking "what work is about this party" would otherwise have to
   * look up the kind first just to name the type it already has an id for.
   * Matching on the id across both types is one query and cannot pick wrong.
   * WRITING still needs the exact type — a link row stores one.
   */
  const types = typeof ref.entityType === "string" ? [ref.entityType] : [...ref.entityType];
  const items = await tx
    .select(ITEM_COLUMNS)
    .from(schema.workItems)
    .innerJoin(
      schema.workItemLinks,
      and(
        eq(schema.workItemLinks.tenantId, schema.workItems.tenantId),
        eq(schema.workItemLinks.itemId, schema.workItems.id),
      ),
    )
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        inArray(schema.workItemLinks.entityType, types),
        eq(schema.workItemLinks.entityId, ref.entityId),
      ),
    )
    .orderBy(sql`${schema.workItems.dueOn} asc nulls last`);

  const links = await linksFor(tx, ctx, items.map((i) => i.id));
  return items.map((item) => toRow(item, links));
}

/** Open work across the whole workspace, optionally for one person. */
export async function listOpenWork(
  tx: Tx,
  ctx: WorkReadCtx,
  opts?: { assigneeClerkUserId?: string },
): Promise<EntityWorkRow[]> {
  const items = await tx
    .select(ITEM_COLUMNS)
    .from(schema.workItems)
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        isNull(schema.workItems.closedAt),
        ...(opts?.assigneeClerkUserId
          ? [eq(schema.workItems.assigneeClerkUserId, opts.assigneeClerkUserId)]
          : []),
      ),
    )
    .orderBy(sql`${schema.workItems.dueOn} asc nulls last`);

  const links = await linksFor(tx, ctx, items.map((i) => i.id));
  return items.map((item) => toRow(item, links));
}

/** Recently finished work, newest first. */
export async function listRecentlyClosedWork(
  tx: Tx,
  ctx: WorkReadCtx,
  limit: number,
): Promise<EntityWorkRow[]> {
  const items = await tx
    .select(ITEM_COLUMNS)
    .from(schema.workItems)
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        sql`${schema.workItems.closedAt} is not null`,
      ),
    )
    .orderBy(sql`${schema.workItems.closedAt} desc`)
    .limit(limit);

  const links = await linksFor(tx, ctx, items.map((i) => i.id));
  return items.map((item) => toRow(item, links));
}

/** Tick or untick, keeping `state` and `closed_at` in step. */
export async function setWorkComplete(
  tx: Tx,
  ctx: WorkWriteCtx,
  itemId: string,
  complete: boolean,
): Promise<void> {
  await setItemState(tx, ctx, itemId, complete ? "done" : "todo");
}

/** Edit, guarded against a concurrent edit. */
export async function updateEntityWork(
  tx: Tx,
  ctx: WorkWriteCtx,
  itemId: string,
  expectedVersion: number,
  patch: { title?: string; notes?: string; dueOn?: string | null },
): Promise<void> {
  await updateItem(
    tx,
    ctx,
    itemId,
    {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.notes !== undefined ? { description: patch.notes } : {}),
      ...(patch.dueOn !== undefined ? { dueOn: patch.dueOn } : {}),
    },
    expectedVersion,
  );
}

/**
 * Point every link at a different record — what a merge does.
 *
 * The loser's work follows the winner rather than being deleted, and the unique
 * index means an item already attached to the winner does not gain a duplicate:
 * that pair simply loses its old row.
 */
export async function relinkEntity(
  tx: Tx,
  ctx: WorkReadCtx,
  from: Pick<EntityRef, "entityType" | "entityId">,
  to: Pick<EntityRef, "entityType" | "entityId">,
): Promise<void> {
  const scope = and(
    eq(schema.workItemLinks.tenantId, ctx.tenantId),
    eq(schema.workItemLinks.entityType, from.entityType),
    eq(schema.workItemLinks.entityId, from.entityId),
  );
  // Items that already point at the winner would violate the unique index on
  // update, so drop those links first and let the survivor stand.
  const already = await tx
    .select({ itemId: schema.workItemLinks.itemId })
    .from(schema.workItemLinks)
    .where(
      and(
        eq(schema.workItemLinks.tenantId, ctx.tenantId),
        eq(schema.workItemLinks.entityType, to.entityType),
        eq(schema.workItemLinks.entityId, to.entityId),
      ),
    );
  if (already.length > 0) {
    await tx.delete(schema.workItemLinks).where(
      and(
        scope,
        inArray(
          schema.workItemLinks.itemId,
          already.map((row) => row.itemId),
        ),
      ),
    );
  }
  await tx
    .update(schema.workItemLinks)
    .set({ entityType: to.entityType, entityId: to.entityId })
    .where(scope);
}

/**
 * The CATEGORIES of the features that own this work item — one entry per
 * distinct owner, `null` for a link whose slug is not in the registry.
 *
 * **A LEFT JOIN, DELIBERATELY.** An inner join would drop a link whose
 * `extension_slug` names nothing, and a dropped row means "no owner objected",
 * which is the permissive answer to a question nobody could answer. `null`
 * comes back instead and `ownerFeatureAllowsWrite` treats it as a core module,
 * which is the strict one.
 *
 * **AN ITEM WITH NO LINKS RETURNS AN EMPTY LIST**, and that is correct rather
 * than a gap: an unlinked item is the Work module's own, and Work refuses the
 * accountant. The caller's `.every()` over an empty list is `true`, so the
 * caller adds Work's rule itself — see `assertOwnersAllowWrite`.
 */
export async function owningCategories(
  tx: Tx,
  tenantId: string,
  itemId: string,
): Promise<(string | null)[]> {
  const rows = await tx
    .selectDistinct({ category: schema.modules.category })
    .from(schema.workItemLinks)
    .leftJoin(
      schema.modules,
      eq(schema.modules.id, schema.workItemLinks.extensionSlug),
    )
    .where(
      and(
        eq(schema.workItemLinks.tenantId, tenantId),
        eq(schema.workItemLinks.itemId, itemId),
      ),
    );
  return rows.map((r) => r.category);
}

