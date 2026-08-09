import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { WorkVisibility } from "@/lib/work/vocabulary";
import { WorkError } from "./core/errors";

/**
 * Work lists: the container, and the unit of sharing.
 *
 * Every function takes the CALLER'S `tx` and never opens its own, never calls
 * `withSystem`. What it can find and change is exactly what RLS allows the
 * person asking — invariant S12 as a signature. The checks below are therefore
 * NOT the security boundary; drizzle/0105 is. They exist so a refused action
 * says why instead of reporting that nothing happened.
 */

export interface WorkCtxLike {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

export interface CreateListInput {
  name: string;
  color: string;
  visibility: WorkVisibility;
}

/**
 * A new list.
 *
 * `visibility: "owners"` from a staff member is refused by the policy's WITH
 * CHECK before this ever returns — the explicit check here just turns a
 * Postgres error into a sentence.
 */
export async function createList(
  tx: Tx,
  ctx: WorkCtxLike,
  input: CreateListInput,
): Promise<string> {
  if (input.visibility === "owners" && ctx.role !== "owner") {
    throw new WorkError("FORBIDDEN", "only an owner can restrict a list");
  }
  const [row] = await tx
    .insert(schema.workLists)
    .values({
      tenantId: ctx.tenantId,
      name: input.name,
      color: input.color,
      visibility: input.visibility,
      createdByClerkUserId: ctx.userId,
    })
    .returning({ id: schema.workLists.id });
  return row.id;
}

export interface UpdateListInput {
  name?: string;
  color?: string;
  visibility?: WorkVisibility;
}

export async function updateList(
  tx: Tx,
  ctx: WorkCtxLike,
  listId: string,
  input: UpdateListInput,
): Promise<void> {
  if (input.visibility === "owners" && ctx.role !== "owner") {
    throw new WorkError("FORBIDDEN", "only an owner can restrict a list");
  }
  const updated = await tx
    .update(schema.workLists)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(schema.workLists.tenantId, ctx.tenantId),
        eq(schema.workLists.id, listId),
      ),
    )
    .returning({ id: schema.workLists.id });
  if (updated.length === 0) {
    throw new WorkError("NOT_FOUND", "list not found");
  }
}

/**
 * Archive or restore. Nothing in this module deletes a list.
 *
 * Archiving keeps the items and keeps a link resolving; it only takes the list
 * out of pickers. The DEFAULT list is refused, because it is where anything
 * lands when nobody chose — a workspace whose default list is archived has a
 * hole exactly where the fallback should be.
 */
export async function setListArchived(
  tx: Tx,
  ctx: WorkCtxLike,
  listId: string,
  archived: boolean,
): Promise<void> {
  const [list] = await tx
    .select({
      id: schema.workLists.id,
      isDefault: schema.workLists.isDefault,
    })
    .from(schema.workLists)
    .where(
      and(
        eq(schema.workLists.tenantId, ctx.tenantId),
        eq(schema.workLists.id, listId),
      ),
    );
  if (!list) throw new WorkError("NOT_FOUND", "list not found");
  if (list.isDefault && archived) {
    throw new WorkError(
      "DEFAULT_IS_PERMANENT",
      "the default list cannot be archived",
    );
  }
  await tx
    .update(schema.workLists)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.workLists.tenantId, ctx.tenantId),
        eq(schema.workLists.id, listId),
      ),
    );
}
