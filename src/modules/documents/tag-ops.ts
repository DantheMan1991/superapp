import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { DocumentTag } from "@/db/schema";
import { DocsError } from "./core/errors";
import type { DocsCtx } from "./folder-ops";
import {
  diffTags,
  normalizeTags,
  slugifyTag,
  TAG_NAME_MAX,
  TAGS_PER_TENANT_MAX,
} from "./core/tags";

/**
 * The tag registry and the one door through which `documents.tags` is written.
 *
 * The design in one sentence: `documents.tags` stores SLUGS, the registry owns
 * display names, and the slug is immutable — which is what makes renaming a tag
 * a single-row update instead of a rewrite of every document carrying it.
 *
 * Postgres cannot foreign-key an array element, so the registry is enforced by
 * `setDocumentTags` resolving every slug inside the transaction rather than by
 * a constraint. Anything that writes `documents.tags` and does not go through
 * here can create a slug the registry has never heard of.
 */

/** Reject a name that slugifies to nothing usable, and hand back both forms. */
function parseName(raw: string): { name: string; slug: string } {
  const name = raw.trim().slice(0, TAG_NAME_MAX);
  const slug = slugifyTag(name);
  // A name of only punctuation or emoji leaves nothing a slug can be built
  // from. Refusing beats storing a tag that can never be matched.
  if (!name || !slug) {
    throw new DocsError("TAG_NAME_INVALID", `unusable tag name: ${raw}`);
  }
  return { name, slug };
}

export async function listTags(tx: Tx, tenantId: string): Promise<DocumentTag[]> {
  return tx
    .select()
    .from(schema.documentTags)
    .where(eq(schema.documentTags.tenantId, tenantId))
    .orderBy(asc(schema.documentTags.name));
}

/**
 * How many live documents carry each slug.
 *
 * Runs under the caller's role, so a staff member's counts exclude owners-only
 * documents. That is the honest number for them — and it means the delete
 * confirmation an owner sees ("removes the tag from 12 files") is the only one
 * that claims to be complete.
 */
export async function countDocumentsByTag(
  tx: Tx,
  tenantId: string,
): Promise<Record<string, number>> {
  const rows = await tx.execute(sql`
    select tag, count(*)::int as n
      from documents d, unnest(d.tags) as tag
     where d.tenant_id = ${tenantId}
       and d.status <> 'trashed'
     group by tag
  `);
  const counts: Record<string, number> = {};
  for (const row of (rows.rows ?? []) as Array<Record<string, unknown>>) {
    counts[String(row.tag)] = Number(row.n ?? 0);
  }
  return counts;
}

/**
 * Create a registry entry. Open to staff: a tag is not visibility-bearing, and
 * a crew member who needs "as-built" should not have to file a request.
 */
export async function createTag(
  tx: Tx,
  ctx: DocsCtx,
  input: { name: string; color?: string },
): Promise<DocumentTag> {
  const { name, slug } = parseName(input.name);

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.documentTags)
    .where(eq(schema.documentTags.tenantId, ctx.tenantId));
  if (count >= TAGS_PER_TENANT_MAX) {
    throw new DocsError("TAG_LIMIT", `${count} tags`);
  }

  const inserted = await tx
    .insert(schema.documentTags)
    .values({
      tenantId: ctx.tenantId,
      slug,
      name,
      color: input.color ?? "",
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) return inserted[0];
  // The (tenant, slug) unique arbitrates. "Contracts" and "contracts" produce
  // the same slug and are therefore the same tag, which is the intended
  // behaviour — but say so rather than silently returning the other one.
  throw new DocsError("TAG_NAME_TAKEN", `slug ${slug} exists`);
}

/**
 * Rename or recolour. The SLUG NEVER CHANGES — it is the tag's identity, and
 * every document referencing it stores that string. Changing it here would
 * orphan every document carrying the tag, silently, with no error anywhere.
 * A user who truly wants a different slug creates a new tag.
 */
export async function updateTag(
  tx: Tx,
  ctx: DocsCtx,
  input: {
    tagId: string;
    expectedVersion: number;
    name?: string;
    color?: string;
  },
): Promise<DocumentTag> {
  const patch: Partial<typeof schema.documentTags.$inferInsert> = {};
  if (input.name !== undefined) {
    // Validated through the same door as create, so a rename cannot leave a
    // name that would have been refused at creation.
    patch.name = parseName(input.name).name;
  }
  if (input.color !== undefined) patch.color = input.color;

  const rows = await tx
    .update(schema.documentTags)
    .set({
      ...patch,
      version: input.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documentTags.tenantId, ctx.tenantId),
        eq(schema.documentTags.id, input.tagId),
        eq(schema.documentTags.version, input.expectedVersion),
      ),
    )
    .returning();

  if (rows.length === 0) {
    // Either it is gone or somebody else edited it first. Distinguish, because
    // "reload and try again" is useless advice for a deleted tag.
    const exists = await tx.query.documentTags.findFirst({
      where: and(
        eq(schema.documentTags.tenantId, ctx.tenantId),
        eq(schema.documentTags.id, input.tagId),
      ),
    });
    throw exists
      ? new DocsError("STALE_VERSION", "tag changed")
      : new DocsError("TAG_NOT_FOUND", "tag missing");
  }
  return rows[0];
}

/**
 * Delete a tag and strip its slug from every document carrying it.
 *
 * OWNER-ONLY, and for the same correctness reason structural folder operations
 * are: this rewrites rows across the whole tenant, and RLS hides owners-only
 * documents from staff. A staff-run delete would remove the registry entry
 * while silently skipping exactly the documents it could not see, leaving them
 * carrying a slug that resolves to nothing. Owner-only means the sweep always
 * sees everything it is responsible for.
 */
export async function deleteTag(
  tx: Tx,
  ctx: DocsCtx,
  input: { tagId: string; expectedVersion: number },
): Promise<{ slug: string; documentsUpdated: number }> {
  if (ctx.role !== "owner") throw new DocsError("FORBIDDEN", "owner required");

  const tag = await tx.query.documentTags.findFirst({
    where: and(
      eq(schema.documentTags.tenantId, ctx.tenantId),
      eq(schema.documentTags.id, input.tagId),
    ),
  });
  if (!tag) throw new DocsError("TAG_NOT_FOUND", "tag missing");
  if (tag.version !== input.expectedVersion) {
    throw new DocsError("STALE_VERSION", "tag changed");
  }

  // Strip first, delete second. If this transaction rolls back nothing moved;
  // if it commits there is no window in which documents reference a registry
  // entry that is already gone.
  const stripped = await tx
    .update(schema.documents)
    .set({
      tags: sql`array_remove(${schema.documents.tags}, ${tag.slug})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.documents.tenantId, ctx.tenantId),
        sql`${schema.documents.tags} @> ARRAY[${tag.slug}]::text[]`,
      ),
    )
    .returning({ id: schema.documents.id });

  await tx
    .delete(schema.documentTags)
    .where(
      and(
        eq(schema.documentTags.tenantId, ctx.tenantId),
        eq(schema.documentTags.id, input.tagId),
      ),
    );

  return { slug: tag.slug, documentsUpdated: stripped.length };
}

/**
 * Set a document's tags. THE single door onto `documents.tags`.
 *
 * Every slug is resolved against the registry inside this transaction, so an
 * unknown slug is refused rather than stored. That check is the substitute for
 * the foreign key Postgres cannot give an array element, and it is why nothing
 * else in the module may write the column.
 */
export async function setDocumentTags(
  tx: Tx,
  ctx: DocsCtx,
  input: { documentId: string; slugs: readonly string[] },
): Promise<{ before: string[]; after: string[] }> {
  const doc = await tx.query.documents.findFirst({
    where: and(
      eq(schema.documents.tenantId, ctx.tenantId),
      eq(schema.documents.id, input.documentId),
    ),
  });
  // RLS may have hidden it. "Restricted" and "gone" are indistinguishable by
  // design; NOT_FOUND is the only non-leaking answer.
  if (!doc) throw new DocsError("DOCUMENT_NOT_FOUND", "document not visible");
  if (doc.status === "trashed") {
    throw new DocsError("DOCUMENT_TRASHED", "document is in the trash");
  }

  // Dedupe, drop malformed, sort and cap before touching the registry, so the
  // membership check runs over the exact strings that will be stored.
  const after = normalizeTags(input.slugs);

  if (after.length > 0) {
    // inArray, not a hand-written `= any(...)`: interpolating a JS array into a
    // sql template flattens it into separate parameters, which Postgres then
    // rejects as a malformed array literal.
    const known = await tx
      .select({ slug: schema.documentTags.slug })
      .from(schema.documentTags)
      .where(
        and(
          eq(schema.documentTags.tenantId, ctx.tenantId),
          inArray(schema.documentTags.slug, after),
        ),
      );
    const knownSet = new Set(known.map((k) => k.slug));
    const unknown = after.filter((slug) => !knownSet.has(slug));
    if (unknown.length > 0) {
      throw new DocsError("TAG_NOT_FOUND", `unknown slugs: ${unknown.join(",")}`);
    }
  }

  const before = doc.tags;
  await tx
    .update(schema.documents)
    .set({ tags: after, updatedAt: new Date() })
    .where(
      and(
        eq(schema.documents.tenantId, ctx.tenantId),
        eq(schema.documents.id, input.documentId),
      ),
    );

  return { before, after };
}

/** Slugs added and removed, for audit meta. Re-exported so callers need one import. */
export { diffTags };
