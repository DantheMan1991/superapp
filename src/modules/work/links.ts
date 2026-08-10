import "server-only";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  EntityLinkCtx,
  EntityLinkProvider,
  LinkableEntity,
} from "@/lib/entity-links/types";

/**
 * WORK AS A CONTRIBUTOR: a work item, offered to everybody else's pickers.
 *
 * ============================================================================
 * THIS FILE MUST NEVER IMPORT `@/lib/entity-links/registry`.
 * ============================================================================
 *
 * The registry imports THIS file. Work is also a host — `link-ops.ts` renders
 * its own "attach to…" surface and does import the registry — and that
 * combination is new: no module has been both before. The per-module eslint
 * rule exempts a host's whole directory, so this file has its own rule putting
 * the ban back (`contributorFileInHost` in eslint.config.mjs). Without it,
 * `registry -> work/links -> registry` is a real cycle, and JavaScript resolves
 * a cycle by handing one side a half-built module: `undefined is not a
 * function`, at request time, on one route, in production.
 *
 * Named `links.ts` rather than `mail/extension.ts`. The three older
 * contributors still live at that path because mail was the only consumer when
 * they were written, and `entity-links/registry.ts` records the rename as a
 * debt. A new contributor should not inherit the wrong name to be consistent
 * with it.
 *
 * `search` and `resolve` take the CALLER'S `tx` and never open their own. What
 * they can find is exactly what that person may see — so a work item on an
 * owners-only list is absent from a staff member's picker without this file
 * containing a single predicate about visibility.
 */

const WORK_ITEM_TYPE = "work_item";

/** Where a link to a work item goes: the module home, with the sheet open. */
function hrefFor(id: string): string {
  return `/dashboard/m/work?item=${id}`;
}

function sublabelFor(row: {
  listName: string | null;
  dueOn: string | null;
  state: string;
}): string | undefined {
  const parts: string[] = [];
  if (row.listName) parts.push(row.listName);
  if (row.dueOn) parts.push(`due ${row.dueOn}`);
  // Only worth saying when it is not the ordinary case; a chip reading "To do"
  // on every row is furniture.
  if (row.state === "done" || row.state === "cancelled") parts.push(row.state);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

async function searchWorkItems(
  tx: Tx,
  ctx: EntityLinkCtx,
  query: string,
  limit: number,
): Promise<LinkableEntity[]> {
  const pattern = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const rows = await tx
    .select({
      id: schema.workItems.id,
      title: schema.workItems.title,
      dueOn: schema.workItems.dueOn,
      state: schema.workItems.state,
      listName: schema.workLists.name,
    })
    .from(schema.workItems)
    .innerJoin(
      schema.workLists,
      and(
        eq(schema.workLists.tenantId, schema.workItems.tenantId),
        eq(schema.workLists.id, schema.workItems.listId),
      ),
    )
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        or(
          ilike(schema.workItems.title, pattern),
          ilike(schema.workItems.description, pattern),
        ),
      ),
    )
    // Open work first: attaching a record to something already finished is the
    // rarer intent, and a picker that leads with last year's closed items reads
    // as broken.
    .orderBy(sql`${schema.workItems.closedAt} is not null`, schema.workItems.dueOn)
    .limit(limit);

  return rows.map((row) => ({
    entityType: WORK_ITEM_TYPE,
    entityId: row.id,
    label: row.title,
    sublabel: sublabelFor(row),
    href: hrefFor(row.id),
  }));
}

async function resolveWorkItems(
  tx: Tx,
  ctx: EntityLinkCtx,
  ids: readonly string[],
): Promise<LinkableEntity[]> {
  if (ids.length === 0) return [];
  // `inArray`, never a JS array interpolated into a `sql` template — that
  // flattens into one parameter per element and Postgres rejects it
  // (documents.md).
  const rows = await tx
    .select({
      id: schema.workItems.id,
      title: schema.workItems.title,
      dueOn: schema.workItems.dueOn,
      state: schema.workItems.state,
      listName: schema.workLists.name,
    })
    .from(schema.workItems)
    .innerJoin(
      schema.workLists,
      and(
        eq(schema.workLists.tenantId, schema.workItems.tenantId),
        eq(schema.workLists.id, schema.workItems.listId),
      ),
    )
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        inArray(schema.workItems.id, [...ids]),
      ),
    );

  return rows.map((row) => ({
    entityType: WORK_ITEM_TYPE,
    entityId: row.id,
    label: row.title,
    sublabel: sublabelFor(row),
    href: hrefFor(row.id),
  }));
}

export const workEntityLinks: EntityLinkProvider = {
  slug: "work",
  moduleSlug: "work",
  name: "Work",
  entityTypes: [
    {
      type: WORK_ITEM_TYPE,
      label: "Work",
      pluralLabel: "Work",
      icon: "check-square",
      search: searchWorkItems,
      resolve: resolveWorkItems,
    },
  ],
};
