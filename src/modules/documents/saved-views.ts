import "server-only";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema, type Tx } from "@/db";
import type { DocumentSavedView } from "@/db/schema";
import { DocsError } from "./core/errors";
import type { DocsCtx } from "./folder-ops";
import { normalizeTags } from "./core/tags";
import { SEARCH_QUERY_MAX } from "./search";

/**
 * Saved views: a named set of search parameters.
 *
 * The design decision that matters, and the reason this file is small: a saved
 * view does NOT carry its own query engine. `query` is parsed into the same
 * parameters the search page already accepts, and the existing, already-tested
 * `searchDocuments` runs. The stored jsonb never becomes a WHERE clause on its
 * own terms — it becomes a URL.
 *
 * That is the safe reading of the rule recorded when the table shipped
 * ("`query` jsonb is stored USER INPUT that becomes a WHERE clause — must be
 * re-parsed with Zod on read"). It is re-parsed on read, and what it produces
 * is a bounded parameter set rather than SQL.
 */

export const SAVED_VIEWS_PER_USER_MAX = 30;
const VIEW_NAME_MAX = 60;

/**
 * The whole vocabulary of a view. Anything not in here cannot be expressed,
 * which is the point: the schema is the allowlist.
 *
 * `.catch()` on every field rather than a failing parse — a view written by an
 * older or newer version of this code should degrade to a usable view, not
 * throw on a page render. `strip` (Zod's default) drops unknown keys, so a
 * hand-edited row cannot smuggle a field into the parameters.
 */
export const savedViewQuerySchema = z.object({
  q: z.string().max(SEARCH_QUERY_MAX).optional().catch(undefined),
  folderId: z.string().uuid().optional().catch(undefined),
  tags: z.array(z.string().max(64)).max(10).optional().catch(undefined),
  origin: z.enum(["dms", "accounting"]).optional().catch(undefined),
});

export type SavedViewQuery = z.infer<typeof savedViewQuerySchema>;

/**
 * Parse a stored `query` blob into something safe to act on.
 *
 * Called on READ, every time, including on rows this code wrote — a value that
 * was valid when stored is still untrusted input by the time it comes back, and
 * a database someone has edited by hand is exactly the case worth surviving.
 */
export function parseSavedViewQuery(raw: unknown): SavedViewQuery {
  const parsed = savedViewQuerySchema.safeParse(raw ?? {});
  if (!parsed.success) return {};
  const query = parsed.data;
  // Tags go through the same normalizer as every other tag path, so a stored
  // slug that could never have matched anything is dropped rather than sent to
  // the query.
  const tags = query.tags ? normalizeTags(query.tags) : undefined;
  return {
    ...query,
    tags: tags && tags.length > 0 ? tags : undefined,
  };
}

/** The view as a query string for /dashboard/m/documents/search. */
export function savedViewHref(
  query: SavedViewQuery,
  base = "/dashboard/m/documents/search",
): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.folderId) params.set("folder", query.folderId);
  if (query.origin) params.set("origin", query.origin);
  for (const tag of query.tags ?? []) params.append("tag", tag);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** True when a view would select everything — worth refusing to save. */
export function isEmptyQuery(query: SavedViewQuery): boolean {
  return (
    !query.q && !query.folderId && !query.origin && (query.tags ?? []).length === 0
  );
}

export function viewNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface SavedViewEntry {
  id: string;
  name: string;
  scope: string;
  query: SavedViewQuery;
  href: string;
  createdByClerkUserId: string;
  version: number;
}

/**
 * Views this caller can see: the tenant's shared ones plus their own private
 * ones. RLS scopes to the tenant; the `scope`/owner split is an app-level
 * courtesy, not a security boundary — a private view hides clutter, it does not
 * hide data, and the documents it selects are protected by their own RLS.
 */
export async function listSavedViews(
  tx: Tx,
  tenantId: string,
  userId: string,
): Promise<SavedViewEntry[]> {
  const rows = await tx
    .select()
    .from(schema.documentSavedViews)
    .where(
      and(
        eq(schema.documentSavedViews.tenantId, tenantId),
        or(
          eq(schema.documentSavedViews.scope, "tenant"),
          eq(schema.documentSavedViews.createdByClerkUserId, userId),
        ),
      ),
    )
    .orderBy(
      asc(schema.documentSavedViews.sortOrder),
      asc(schema.documentSavedViews.name),
    );

  return rows.map((row) => {
    const query = parseSavedViewQuery(row.query);
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      query,
      href: savedViewHref(query),
      createdByClerkUserId: row.createdByClerkUserId,
      version: row.version,
    };
  });
}

export async function createSavedView(
  tx: Tx,
  ctx: DocsCtx,
  input: { name: string; scope: "tenant" | "private"; query: SavedViewQuery },
): Promise<DocumentSavedView> {
  const name = input.name.trim().slice(0, VIEW_NAME_MAX);
  if (!name) throw new DocsError("VIEW_NAME_INVALID", "blank name");

  // Parsed on the way IN as well as on the way out: the column should never
  // hold a shape this module would refuse to read back.
  const query = parseSavedViewQuery(input.query);
  if (isEmptyQuery(query)) {
    throw new DocsError("VIEW_QUERY_EMPTY", "no filters");
  }

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.documentSavedViews)
    .where(
      and(
        eq(schema.documentSavedViews.tenantId, ctx.tenantId),
        eq(schema.documentSavedViews.createdByClerkUserId, ctx.userId),
      ),
    );
  if (count >= SAVED_VIEWS_PER_USER_MAX) {
    throw new DocsError("VIEW_LIMIT", `${count} views`);
  }

  const inserted = await tx
    .insert(schema.documentSavedViews)
    .values({
      tenantId: ctx.tenantId,
      name,
      nameKey: viewNameKey(name),
      scope: input.scope,
      createdByClerkUserId: ctx.userId,
      query,
    })
    .onConflictDoNothing()
    .returning();

  // The unique is (tenant, creator, name_key), so this is only ever a clash
  // with one of the caller's OWN views — never with a colleague's.
  if (inserted.length === 0) {
    throw new DocsError("VIEW_NAME_TAKEN", `name ${name} exists`);
  }
  return inserted[0];
}

/**
 * Delete a view.
 *
 * A shared ('tenant') view may only be deleted by whoever created it or by an
 * owner — one person should not be able to remove a view the whole business
 * navigates by, but an owner needs to be able to tidy up after somebody who has
 * left.
 */
export async function deleteSavedView(
  tx: Tx,
  ctx: DocsCtx,
  input: { viewId: string },
): Promise<{ name: string }> {
  const view = await tx.query.documentSavedViews.findFirst({
    where: and(
      eq(schema.documentSavedViews.tenantId, ctx.tenantId),
      eq(schema.documentSavedViews.id, input.viewId),
    ),
  });
  if (!view) throw new DocsError("VIEW_NOT_FOUND", "view missing");
  if (view.createdByClerkUserId !== ctx.userId && ctx.role !== "owner") {
    throw new DocsError("FORBIDDEN", "not the view's creator");
  }

  await tx
    .delete(schema.documentSavedViews)
    .where(
      and(
        eq(schema.documentSavedViews.tenantId, ctx.tenantId),
        eq(schema.documentSavedViews.id, input.viewId),
      ),
    );
  return { name: view.name };
}
