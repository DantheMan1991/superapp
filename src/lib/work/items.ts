import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { listAssignableMembers } from "@/lib/team";
import { isClosedState, type WorkState } from "@/lib/work/vocabulary";
import { WorkError } from "@/lib/work/errors";
import type { WorkCtx } from "@/lib/work/with-work";

/**
 * THE write path for a work item. One implementation, two callers.
 *
 * ============================================================================
 * WHY THIS IS IN `src/lib/` AND NOT IN THE MODULE
 * ============================================================================
 *
 * Slice 5b makes CRM create work items — a follow-up on a customer becomes a
 * work item linked to that record. A module may not import another module
 * (extension-model §6, enforced by eslint), so CRM cannot call
 * `src/modules/work/item-ops.ts`. The options were a second write path inside
 * CRM, which would duplicate every guard below and drift from them, or this.
 *
 * `src/lib/schedule/` set the precedent: `provision.ts`, `range.ts`,
 * `access.ts` and `availability.ts` all live there for the same reason.
 *
 * IT STILL TAKES THE CALLER'S `tx` and never opens its own, never calls
 * `withSystem`. What it can change is exactly what RLS allows the person
 * asking — invariant S12 as a signature. The checks here are NOT the security
 * boundary; drizzle/0105 is. They exist so a refused write says why.
 *
 * EVERY WRITE BUMPS `version` IN SQL (`version = version + 1`) rather than by
 * reading the row and adding one. Read-then-write loses a bump when two writes
 * interleave, which is exactly the collision the column exists to detect.
 */

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

export interface UpdateItemInput {
  title?: string;
  description?: string;
  dueOn?: string | null;
  startsOn?: string | null;
  listId?: string;
  kind?: string;
  status?: string;
}

/**
 * Who may be given work.
 *
 * `listAssignableMembers` already excludes EXPERTS, and this leans on that
 * rather than restating it. The reason is a closed loop: an expert is read-only
 * in this module, so an expert who could be assigned work would be unable to
 * mark it done. Refusing the assignment is the version of that with no
 * half-feature in it.
 *
 * crm.md records the gap this closes — there, any string could be written into
 * an assignee column, producing work that appears in nobody's list and nobody's
 * digest. Not a leak; just work that has quietly stopped existing.
 */
async function assertAssignable(
  tx: Tx,
  ctx: WorkCtx,
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
  ctx: WorkCtx,
  itemId: string,
): Promise<{ id: string; listId: string; parentId: string | null; version: number }> {
  const [row] = await tx
    .select({
      id: schema.workItems.id,
      listId: schema.workItems.listId,
      parentId: schema.workItems.parentId,
      version: schema.workItems.version,
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

export async function createItem(
  tx: Tx,
  ctx: WorkCtx,
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

/**
 * Edit an item, optionally guarding against a concurrent edit.
 *
 * `expectedVersion` is opt-in: the sheet passes the version it rendered, and a
 * caller with nothing to be stale about (a rule firing, an import) omits it.
 * Omitting is last-write-wins, which is what every caller got before this
 * column existed — so adding the guard changed no existing behaviour.
 */
export async function updateItem(
  tx: Tx,
  ctx: WorkCtx,
  itemId: string,
  input: UpdateItemInput,
  expectedVersion?: number,
): Promise<void> {
  /*
   * THE VERSION GOES IN THE `WHERE`, NOT IN A CHECK BEFORE IT.
   *
   * Slice 5a read the row, compared, then updated — which is a
   * time-of-check-to-time-of-use window: Postgres runs at READ COMMITTED, so
   * another transaction can commit between the SELECT and the UPDATE, and the
   * comparison would have passed against data that was already stale. The
   * write then silently overwrites the very edit the column exists to detect.
   *
   * A compare-and-swap has no window: the row either still carries the version
   * the caller saw, in which case one row is updated, or it does not and zero
   * are. `crm_tasks` has done it this way since CRM slice 1 and was the reason
   * this was spotted at all.
   */
  const updated = await tx
    .update(schema.workItems)
    .set({
      ...input,
      version: sql`${schema.workItems.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        eq(schema.workItems.id, itemId),
        ...(expectedVersion === undefined
          ? []
          : [eq(schema.workItems.version, expectedVersion)]),
      ),
    )
    .returning({ id: schema.workItems.id });

  if (updated.length > 0) return;

  // Zero rows means one of two things, and the caller deserves to be told
  // which: the item is gone (or invisible), or somebody got there first.
  if (expectedVersion !== undefined) {
    const [exists] = await tx
      .select({ id: schema.workItems.id })
      .from(schema.workItems)
      .where(
        and(
          eq(schema.workItems.tenantId, ctx.tenantId),
          eq(schema.workItems.id, itemId),
        ),
      );
    if (exists) throw new WorkError("STALE", "somebody else changed this first");
  }
  throw new WorkError("NOT_FOUND", "work not found");
}

export async function setAssignee(
  tx: Tx,
  ctx: WorkCtx,
  itemId: string,
  assignee: string | null,
): Promise<void> {
  await assertAssignable(tx, ctx, assignee);
  const updated = await tx
    .update(schema.workItems)
    .set({
      assigneeClerkUserId: assignee,
      version: sql`${schema.workItems.version} + 1`,
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
 * Move an item to a state, keeping `closed_at` in step.
 *
 * THE CHECK CONSTRAINT IS WHY THIS IS ONE FUNCTION. `state` and `closed_at`
 * are one fact spread over two columns, and the database refuses any write
 * where they disagree — so there is no "just set the state" path to write, and
 * no way for a future caller to invent one.
 */
export async function setItemState(
  tx: Tx,
  ctx: WorkCtx,
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
      version: sql`${schema.workItems.version} + 1`,
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
 * checked here by walking up from the proposed parent.
 */
export async function setParent(
  tx: Tx,
  ctx: WorkCtx,
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
    .set({
      parentId,
      version: sql`${schema.workItems.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        eq(schema.workItems.id, itemId),
      ),
    );
}
