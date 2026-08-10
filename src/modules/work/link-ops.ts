import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import {
  allEntityTypes,
  getEntityLinkProvider,
} from "@/lib/entity-links/registry";
import type { LinkableEntity } from "@/lib/entity-links/types";
import { WorkError } from "./core/errors";
import type { WorkCtxLike } from "./list-ops";

/**
 * WORK AS A HOST: what a piece of work is about.
 *
 * This is the half that imports the registry, and it is why `work` is in
 * `ENTITY_LINK_HOSTS`. It still knows nothing about what an invoice is — every
 * label, href and search comes from the module that owns the record.
 *
 * ONE BROKEN CONTRIBUTOR MUST NOT COST THE PAGE. A provider that throws loses
 * its own section of the picker and its own links render as dangling; the work
 * item still opens. That is mail's and scheduling's rule for this seam, and the
 * opposite of the attention sources' rule — there, silence would tell somebody
 * they owe nothing when they owe seven things; here it costs a chip.
 *
 * A NOTE ON THE OBVIOUS SELF-REFERENCE: Work contributes `work_item`, so this
 * picker offers work items too. Attaching work to work is not the same as
 * `parent_id` — nesting says "this is part of that", a link says "this is
 * about that" — and the database has no cycle problem with the second, because
 * a link is not a tree.
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
 * files, but what they may READ is RLS's decision, and `search` runs inside the
 * caller's own transaction to prove it.
 */
export async function searchLinkTargets(
  tx: Tx,
  ctx: WorkCtxLike,
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
        } catch (error) {
          // Its own section, not the picker. See the module header.
          console.error(
            `work: entity search failed for ${provider.slug}/${type.type}`,
            error,
          );
          return null;
        }
      }),
  );

  return groups
    .filter((group): group is LinkTargetGroup => group !== null)
    .filter((group) => group.results.length > 0);
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
 * Turn stored link rows into things a person can read, BATCHED per entity type.
 *
 * One `resolve` call per type rather than per row: the alternative is N+1
 * queries behind a list of chips, which the contract's own header calls out.
 * An id that no longer resolves — deleted, or refused by RLS — comes back with
 * `entity: null` and renders as a dangling link rather than an error. That is
 * also the ONLY place a restricted record is enforced for links: the link row
 * itself carries no visibility of its own (see drizzle/0107).
 */
export async function resolveLinks(
  tx: Tx,
  ctx: WorkCtxLike,
  itemIds: readonly string[],
): Promise<ResolvedLink[]> {
  if (itemIds.length === 0) return [];

  const rows = await tx
    .select()
    .from(schema.workItemLinks)
    .where(
      and(
        eq(schema.workItemLinks.tenantId, ctx.tenantId),
        inArray(schema.workItemLinks.itemId, [...itemIds]),
      ),
    );
  if (rows.length === 0) return [];

  const byType = new Map<string, { slug: string; ids: string[] }>();
  for (const row of rows) {
    const bucket = byType.get(row.entityType);
    if (bucket) bucket.ids.push(row.entityId);
    else byType.set(row.entityType, { slug: row.extensionSlug, ids: [row.entityId] });
  }

  const resolved = new Map<string, LinkableEntity>();
  await Promise.all(
    [...byType.entries()].map(async ([entityType, { slug, ids }]) => {
      const provider = getEntityLinkProvider(slug);
      // A link written by a layer that is no longer installed. Not an error —
      // `extension_slug` exists so this can be skipped rather than repaired.
      const type = provider?.entityTypes.find((t) => t.type === entityType);
      if (!type) return;
      try {
        for (const entity of await type.resolve(tx, ctx, ids)) {
          resolved.set(`${entityType}:${entity.entityId}`, entity);
        }
      } catch (error) {
        console.error(`work: entity resolve failed for ${slug}/${entityType}`, error);
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

/**
 * Attach a record. Idempotent: the unique index makes a second attach a no-op
 * rather than a second chip.
 */
export async function attachLink(
  tx: Tx,
  ctx: WorkCtxLike,
  input: {
    itemId: string;
    extensionSlug: string;
    entityType: string;
    entityId: string;
  },
): Promise<void> {
  // Read the item under the caller's context first: an item they cannot see is
  // an item they cannot attach anything to. The policy's WITH CHECK would
  // refuse it anyway; this turns that into a sentence.
  const [item] = await tx
    .select({ id: schema.workItems.id })
    .from(schema.workItems)
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        eq(schema.workItems.id, input.itemId),
      ),
    );
  if (!item) throw new WorkError("NOT_FOUND", "work not found");

  await tx
    .insert(schema.workItemLinks)
    .values({
      tenantId: ctx.tenantId,
      itemId: input.itemId,
      extensionSlug: input.extensionSlug,
      entityType: input.entityType,
      entityId: input.entityId,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing();
}

export async function detachLink(
  tx: Tx,
  ctx: WorkCtxLike,
  linkId: string,
): Promise<void> {
  const removed = await tx
    .delete(schema.workItemLinks)
    .where(
      and(
        eq(schema.workItemLinks.tenantId, ctx.tenantId),
        eq(schema.workItemLinks.id, linkId),
      ),
    )
    .returning({ id: schema.workItemLinks.id });
  if (removed.length === 0) throw new WorkError("NOT_FOUND", "link not found");
}
