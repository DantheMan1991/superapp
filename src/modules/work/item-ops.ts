import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { listAssignableMembers } from "@/lib/team";
import type { WorkState } from "@/lib/work/vocabulary";
import { isClosedState } from "./core/state";
import { WorkError } from "./core/errors";
import type { WorkCtxLike } from "./list-ops";

/**
 * Work items. Same contract as list-ops: the caller's `tx`, never `withSystem`,
 * and the checks here produce a sentence rather than enforce a boundary.
 */

/**
 * Who may be given work.
 *
 * `listAssignableMembers` already excludes EXPERTS, and this module leans on
 * that rather than restating it. The reason is a closed loop: an expert is
 * read-only in every module that has no read-only-safe write, so an expert who
 * could be assigned work would be unable to mark it done. Refusing the
 * assignment is the version of that with no half-feature in it.
 *
 * crm.md records the gap this closes — there, any string could be written into
 * an assignee column, producing work that appears in nobody's list and nobody's
 * digest. Not a leak; just work that has quietly stopped existing.
 */
async function assertAssignable(
  tx: Tx,
  ctx: WorkCtxLike,
  clerkUserId: string | null,
): Promise<void> {
  if (clerkUserId === null) return;
  const members = await listAssignableMembers(tx, ctx.tenantId);
  if (!members.some((m) => m.clerkUserId === clerkUserId)) {
    throw new WorkError("NOT_ASSIGNABLE", "that person cannot be given work");
  }
}

/** The item, if the caller can see it. Used to turn silence into a reason. */
async function requireItem(
  tx: Tx,
  ctx: WorkCtxLike,
  itemId: string,
): Promise<{ id: string; listId: string; parentId: string | null }> {
  const [row] = await tx
    .select({
      id: schema.workItems.id,
      listId: schema.workItems.listId,
      parentId: schema.workItems.parentId,
    })
    .from(schema.workItems)
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        eq(schema.workItems.id, itemId),
      ),
    );
  if (!row) throw new WorkError("NOT_FOUND", "work not found");
  return row;
}

export interface CreateItemInput {
  listId: string;
  title: string;
  description?: string;
  dueOn?: string | null;
  startsOn?: string | null;
  assignee?: string | null;
  parentId?: string | null;
  kind?: string;
}

export async function createItem(
  tx: Tx,
  ctx: WorkCtxLike,
  input: CreateItemInput,
): Promise<string> {
  await assertAssignable(tx, ctx, input.assignee ?? null);
  if (input.parentId) {
    // Reading it under the caller's context is the check: a parent they cannot
    // see is a parent they cannot file under.
    await requireItem(tx, ctx, input.parentId);
  }
  const [row] = await tx
    .insert(schema.workItems)
    .values({
      tenantId: ctx.tenantId,
      listId: input.listId,
      title: input.title,
      description: input.description ?? "",
      dueOn: input.dueOn ?? null,
      startsOn: input.startsOn ?? null,
      assigneeClerkUserId: input.assignee ?? null,
      parentId: input.parentId ?? null,
      kind: input.kind ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning({ id: schema.workItems.id });
  return row.id;
}

export interface UpdateItemInput {
  title?: string;
  description?: string;
  dueOn?: string | null;
  startsOn?: string | null;
  listId?: string;
  kind?: string;
  status?: string;
}

export async function updateItem(
  tx: Tx,
  ctx: WorkCtxLike,
  itemId: string,
  input: UpdateItemInput,
): Promise<void> {
  const updated = await tx
    .update(schema.workItems)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        eq(schema.workItems.id, itemId),
      ),
    )
    .returning({ id: schema.workItems.id });
  if (updated.length === 0) throw new WorkError("NOT_FOUND", "work not found");
}

export async function setAssignee(
  tx: Tx,
  ctx: WorkCtxLike,
  itemId: string,
  assignee: string | null,
): Promise<void> {
  await assertAssignable(tx, ctx, assignee);
  const updated = await tx
    .update(schema.workItems)
    .set({ assigneeClerkUserId: assignee, updatedAt: new Date() })
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        eq(schema.workItems.id, itemId),
      ),
    )
    .returning({ id: schema.workItems.id });
  if (updated.length === 0) throw new WorkError("NOT_FOUND", "work not found");
}

/**
 * Move an item to a state, keeping `closed_at` in step.
 *
 * THE CHECK CONSTRAINT IS WHY THIS IS ONE FUNCTION. `state` and `closed_at`
 * are one fact spread over two columns, and the database refuses any write
 * where they disagree — so there is no "just set the state" path to write, and
 * no way for a future caller to invent one.
 */
export async function setItemState(
  tx: Tx,
  ctx: WorkCtxLike,
  itemId: string,
  state: WorkState,
): Promise<void> {
  const closing = isClosedState(state);
  const updated = await tx
    .update(schema.workItems)
    .set({
      state,
      closedAt: closing ? new Date() : null,
      closedByClerkUserId: closing ? ctx.userId : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        eq(schema.workItems.id, itemId),
      ),
    )
    .returning({ id: schema.workItems.id });
  if (updated.length === 0) throw new WorkError("NOT_FOUND", "work not found");
}

/**
 * File one item under another, or unfile it.
 *
 * The database refuses only the TRIVIAL cycle (an item that is its own parent).
 * A longer one — A under B under A — is the read path's problem, so it is
 * checked here by walking up from the proposed parent. The walk is bounded by
 * the chain it is walking; there is no depth limit because the only way to
 * build a deep chain is one accepted call at a time, and each of those ran this.
 */
export async function setParent(
  tx: Tx,
  ctx: WorkCtxLike,
  itemId: string,
  parentId: string | null,
): Promise<void> {
  await requireItem(tx, ctx, itemId);
  if (parentId !== null) {
    if (parentId === itemId) {
      throw new WorkError("WOULD_CYCLE", "work cannot be filed under itself");
    }
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (cursor === itemId) {
        throw new WorkError("WOULD_CYCLE", "that would file work under itself");
      }
      // A cycle that already exists in the data would spin here forever;
      // refuse to walk a node twice rather than trusting the data is clean.
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const parent = await requireItem(tx, ctx, cursor);
      cursor = parent.parentId;
    }
  }
  await tx
    .update(schema.workItems)
    .set({ parentId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        eq(schema.workItems.id, itemId),
      ),
    );
}
