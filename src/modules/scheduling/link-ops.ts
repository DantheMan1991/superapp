import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import {
  allEntityTypes,
  getEntityLinkProvider,
} from "@/lib/entity-links/registry";
import type { LinkableEntity } from "@/lib/entity-links/types";
import { SchedulingError, type SchedulingCtx } from "./calendar-ops";

/**
 * What an event is about.
 *
 * Scheduling is a HOST here: it renders the "attach to…" surface, so it is one
 * of the two modules allowed to import `entity-links/registry`. It still knows
 * nothing about what an invoice is — every label, every href and every search
 * comes from the module that owns the record.
 *
 * ONE BROKEN CONTRIBUTOR MUST NOT COST THE PAGE. A provider that throws loses
 * its own section of the picker and its own links render as dangling; the event
 * still opens. That is mail's rule for the same seam, and the opposite of the
 * attention sources' rule — there, silence would tell somebody they owe nothing
 * when they owe seven things, and here it costs a chip.
 */

const SEARCH_LIMIT = 8;

export interface LinkTargetGroup {
  extensionSlug: string;
  entityType: string;
  label: string;
  pluralLabel: string;
  icon: string;
  results: LinkableEntity[];
}

/**
 * Candidates across every enabled module, grouped by kind.
 *
 * `enabledModules` is an ENTITLEMENT filter, not a security one
 * (security.md §7): a tenant who has not bought Documents should not be offered
 * files, but what they may READ is RLS's decision and `search` runs inside the
 * caller's own transaction to prove it.
 */
export async function searchLinkTargets(
  tx: Tx,
  ctx: SchedulingCtx,
  query: string,
  enabledModules: ReadonlySet<string>,
): Promise<LinkTargetGroup[]> {
  const trimmed = query.trim();
  // An empty query returns NOTHING rather than everything. This fires while
  // somebody types, and listing every customer the moment the box is focused is
  // a query per keystroke for suggestions nobody asked for.
  if (trimmed.length === 0) return [];

  const groups = await Promise.all(
    allEntityTypes()
      .filter(({ provider }) => enabledModules.has(provider.moduleSlug))
      .map(async ({ provider, type }) => {
        try {
          const results = await type.search(tx, ctx, trimmed, SEARCH_LIMIT);
          return {
            extensionSlug: provider.slug,
            entityType: type.type,
            label: type.label,
            pluralLabel: type.pluralLabel,
            icon: type.icon,
            results: results.slice(0, SEARCH_LIMIT),
          };
        } catch (err) {
          // Its own section, not the picker. See the module header.
          console.error(`entity search failed: ${provider.slug}/${type.type}`, err);
          return null;
        }
      }),
  );

  return groups
    .filter((g): g is LinkTargetGroup => g !== null)
    .filter((g) => g.results.length > 0);
}

export interface ResolvedLink {
  linkId: string;
  itemId: string;
  extensionSlug: string;
  entityType: string;
  entityId: string;
  /** Null when the record is gone, or hidden from this reader. */
  entity: LinkableEntity | null;
}

/**
 * Stored links for a set of events, resolved to something displayable.
 *
 * BATCHED PER ENTITY TYPE — one `resolve` call per type across every event on
 * the page, not one per link. The alternative is N+1 behind a list, which is
 * what `resolve`'s batched signature exists to prevent.
 *
 * A link whose record does not come back keeps its row and resolves to `null`.
 * That is not an error: it is a record somebody deleted, or one this reader may
 * not see. Both render as a dangling link rather than vanishing, because a link
 * that silently disappears looks like it was never made.
 */
export async function resolveLinks(
  tx: Tx,
  ctx: SchedulingCtx,
  itemIds: readonly string[],
): Promise<ResolvedLink[]> {
  if (itemIds.length === 0) return [];

  const rows = await tx
    .select()
    .from(schema.scheduleItemLinks)
    .where(inArray(schema.scheduleItemLinks.itemId, [...itemIds]));
  if (rows.length === 0) return [];

  const byType = new Map<string, { slug: string; type: string; ids: string[] }>();
  for (const row of rows) {
    const key = `${row.extensionSlug}:${row.entityType}`;
    const bucket = byType.get(key) ?? {
      slug: row.extensionSlug,
      type: row.entityType,
      ids: [],
    };
    bucket.ids.push(row.entityId);
    byType.set(key, bucket);
  }

  const resolved = new Map<string, LinkableEntity>();
  await Promise.all(
    [...byType.values()].map(async (bucket) => {
      const provider = getEntityLinkProvider(bucket.slug);
      // An UNINSTALLED layer's links are ignored, not repaired — the rule
      // mail_links follows. The row survives for the day the pack comes back.
      const entityType = provider?.entityTypes.find((t) => t.type === bucket.type);
      if (!entityType) return;
      try {
        const entities = await entityType.resolve(tx, ctx, bucket.ids);
        for (const entity of entities) {
          resolved.set(`${bucket.type}:${entity.entityId}`, entity);
        }
      } catch (err) {
        console.error(`entity resolve failed: ${bucket.slug}/${bucket.type}`, err);
      }
    }),
  );

  return rows.map((row) => ({
    linkId: row.id,
    itemId: row.itemId,
    extensionSlug: row.extensionSlug,
    entityType: row.entityType,
    entityId: row.entityId,
    entity: resolved.get(`${row.entityType}:${row.entityId}`) ?? null,
  }));
}

export async function attachLink(
  tx: Tx,
  ctx: SchedulingCtx,
  input: {
    itemId: string;
    extensionSlug: string;
    entityType: string;
    entityId: string;
  },
): Promise<void> {
  // The type has to be one somebody actually registered. The COLUMN is an open
  // taxonomy on purpose (P3) so a pack needs no migration, but a value arriving
  // from a form is user input and gets checked against the registry — open to
  // packs is not the same as open to whatever the browser posts.
  const provider = getEntityLinkProvider(input.extensionSlug);
  if (!provider?.entityTypes.some((t) => t.type === input.entityType)) {
    throw new SchedulingError("INVALID", "that kind of record cannot be attached");
  }

  await tx
    .insert(schema.scheduleItemLinks)
    .values({
      tenantId: ctx.tenantId,
      itemId: input.itemId,
      extensionSlug: input.extensionSlug,
      entityType: input.entityType,
      entityId: input.entityId,
      createdByClerkUserId: ctx.userId,
    })
    // Attaching the same record twice is a no-op rather than an error: two
    // people doing it at once is a race nobody should have to see.
    .onConflictDoNothing();
}

export async function detachLink(
  tx: Tx,
  ctx: SchedulingCtx,
  input: { itemId: string; linkId: string },
): Promise<void> {
  await tx
    .delete(schema.scheduleItemLinks)
    .where(
      and(
        eq(schema.scheduleItemLinks.id, input.linkId),
        eq(schema.scheduleItemLinks.itemId, input.itemId),
        eq(schema.scheduleItemLinks.tenantId, ctx.tenantId),
      ),
    );
}
