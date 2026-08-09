import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { WorkError } from "./core/errors";
import type { WorkCtxLike } from "./list-ops";

/**
 * Named views — which is to say, named sets of URL parameters.
 *
 * NOTHING HERE PARSES `params`. It is stored as the query string it came from
 * and handed back the same way; the only thing that reads it is
 * `parseWorkView`, on the page, through the one query builder. A function here
 * that turned a saved view into a filter tree would be the second query builder
 * this module exists not to have.
 *
 * Read and write scopes differ for the first time in this module — shared views
 * are readable by everyone, writable only by their author — and that is
 * enforced by four command-specific policies in drizzle/0107, not here. The
 * checks below turn a refusal into a sentence.
 */

export interface SavedViewRow {
  id: string;
  name: string;
  params: string;
  scope: "tenant" | "private";
  createdByClerkUserId: string;
  /** True when the caller may rename or delete it. */
  mine: boolean;
}

/** A stable key for "the same name", so `Overdue` and `overdue` collide. */
function nameKeyOf(name: string): string {
  return name.trim().toLowerCase();
}

export async function listSavedViews(
  tx: Tx,
  ctx: WorkCtxLike,
): Promise<SavedViewRow[]> {
  const rows = await tx
    .select()
    .from(schema.workSavedViews)
    .where(eq(schema.workSavedViews.tenantId, ctx.tenantId))
    .orderBy(asc(schema.workSavedViews.sortOrder), asc(schema.workSavedViews.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    params: row.params,
    scope: row.scope as "tenant" | "private",
    createdByClerkUserId: row.createdByClerkUserId,
    mine: row.createdByClerkUserId === ctx.userId,
  }));
}

export async function createSavedView(
  tx: Tx,
  ctx: WorkCtxLike,
  input: { name: string; params: string; scope: "tenant" | "private" },
): Promise<string> {
  const name = input.name.trim();
  const [row] = await tx
    .insert(schema.workSavedViews)
    .values({
      tenantId: ctx.tenantId,
      name,
      nameKey: nameKeyOf(name),
      params: input.params,
      scope: input.scope,
      createdByClerkUserId: ctx.userId,
    })
    // Saving over a name you already used REPLACES it, which is what somebody
    // adjusting a view and saving it again means. The unique index is per
    // owner, so this can never overwrite a colleague's view.
    .onConflictDoUpdate({
      target: [
        schema.workSavedViews.tenantId,
        schema.workSavedViews.createdByClerkUserId,
        schema.workSavedViews.nameKey,
      ],
      set: {
        name,
        params: input.params,
        scope: input.scope,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.workSavedViews.id });
  return row.id;
}

export async function deleteSavedView(
  tx: Tx,
  ctx: WorkCtxLike,
  viewId: string,
): Promise<void> {
  const removed = await tx
    .delete(schema.workSavedViews)
    .where(
      and(
        eq(schema.workSavedViews.tenantId, ctx.tenantId),
        eq(schema.workSavedViews.id, viewId),
      ),
    )
    .returning({ id: schema.workSavedViews.id });
  // Zero rows means either "no such view" or "somebody else's" — the DELETE
  // policy cannot tell those apart and neither should the message, since
  // distinguishing them would confirm a private view exists.
  if (removed.length === 0) {
    throw new WorkError("NOT_FOUND", "that view is not yours to delete");
  }
}
