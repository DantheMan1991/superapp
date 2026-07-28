import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { MailLink } from "@/db/schema";
import type {
  LinkableEntity,
  LinkableEntityRef,
  MailExtension,
  MailExtensionCtx,
} from "@/lib/mail-extensions/types";
import { entityKey, resolveLinkEntities } from "@/lib/mail-extensions/resolve";

/**
 * `mail_links` — reads and writes, and the join that answers "what else is this
 * conversation about?".
 *
 * Every function takes the caller's `tx`. `mail_links` is one of the two
 * member-writable tables in this module (0042), scoped to the tenant rather than
 * to one person: attaching a thread to an invoice is an act of PUBLISHING, and
 * the whole point is that a colleague can see it afterwards. That asymmetry —
 * the mailbox is private, the link is not — is the reason linking has to copy
 * the message rather than point at it.
 */

export interface ThreadRef {
  /** Null only for a link whose mail account has since been disconnected. */
  mailAccountId: string | null;
  threadId: string;
}

/** Every link on one thread, in one mailbox. */
export async function listLinksForThread(
  tx: Tx,
  tenantId: string,
  ref: ThreadRef,
): Promise<MailLink[]> {
  return tx
    .select()
    .from(schema.mailLinks)
    .where(
      and(
        eq(schema.mailLinks.tenantId, tenantId),
        eq(schema.mailLinks.threadId, ref.threadId),
        // `is not distinct from` rather than `=`: a disconnected mailbox leaves
        // mail_account_id NULL (0046's ON DELETE SET NULL), and `= NULL` would
        // quietly match nothing — losing exactly the links the SET NULL was
        // written to preserve.
        sql`${schema.mailLinks.mailAccountId} is not distinct from ${ref.mailAccountId}`,
      ),
    )
    .orderBy(desc(schema.mailLinks.createdAt));
}

/** Every thread attached to one business record. The reverse view's first hop. */
export async function listLinksForEntity(
  tx: Tx,
  tenantId: string,
  ref: LinkableEntityRef,
): Promise<MailLink[]> {
  return tx
    .select()
    .from(schema.mailLinks)
    .where(
      and(
        eq(schema.mailLinks.tenantId, tenantId),
        eq(schema.mailLinks.entityType, ref.entityType),
        eq(schema.mailLinks.entityId, ref.entityId),
      ),
    )
    .orderBy(desc(schema.mailLinks.createdAt));
}

/**
 * Everything linked to any of these threads. The reverse view's second hop.
 *
 * Why two hops rather than a direct invoice → filed-copy link: the filed copy is
 * itself just another entity attached to the thread, so "the emails on this
 * invoice" and "the invoice on this email" are the same table read from two
 * ends. Nothing new was needed to express it, and an industry pack that
 * registers a `job` type gets the same view for free.
 */
export async function listLinksOnThreads(
  tx: Tx,
  tenantId: string,
  refs: readonly ThreadRef[],
): Promise<MailLink[]> {
  if (refs.length === 0) return [];
  const threadIds = [...new Set(refs.map((r) => r.threadId))];
  const rows = await tx
    .select()
    .from(schema.mailLinks)
    .where(
      and(
        eq(schema.mailLinks.tenantId, tenantId),
        inArray(schema.mailLinks.threadId, threadIds),
      ),
    )
    .orderBy(desc(schema.mailLinks.createdAt));

  // The thread id was filtered in SQL (it is the indexed column); the account
  // pairing is applied here, because a mixed IN over a nullable column is more
  // SQL than it is worth for a handful of rows.
  const allowed = new Set(refs.map((r) => `${r.mailAccountId ?? ""}:${r.threadId}`));
  return rows.filter((r) =>
    allowed.has(`${r.mailAccountId ?? ""}:${r.threadId}`),
  );
}

export async function insertLink(
  tx: Tx,
  ctx: MailExtensionCtx,
  input: ThreadRef & LinkableEntityRef & { extensionSlug: string },
): Promise<MailLink | null> {
  const rows = await tx
    .insert(schema.mailLinks)
    .values({
      tenantId: ctx.tenantId,
      mailAccountId: input.mailAccountId,
      threadId: input.threadId,
      extensionSlug: input.extensionSlug,
      entityType: input.entityType,
      entityId: input.entityId,
      createdByClerkUserId: ctx.userId,
    })
    // Linking twice is a no-op, not an error: two people attaching the same
    // thread to the same invoice have both done the right thing.
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

export async function deleteLink(
  tx: Tx,
  tenantId: string,
  linkId: string,
): Promise<MailLink | null> {
  const rows = await tx
    .delete(schema.mailLinks)
    .where(
      and(
        eq(schema.mailLinks.tenantId, tenantId),
        eq(schema.mailLinks.id, linkId),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/* -- Presentation -------------------------------------------------------- */

export interface ResolvedLink {
  linkId: string;
  extensionSlug: string;
  entityType: string;
  entityId: string;
  /** Absent when the target is gone, or hidden from this caller by RLS. */
  entity: LinkableEntity | null;
  createdAt: Date;
}

/**
 * Attach display data to link rows.
 *
 * A link whose target does not resolve is kept and rendered as unavailable
 * rather than dropped. Dropping it would make a deleted invoice look like a
 * thread nobody ever linked, and the honest statement is "this was attached to
 * something you cannot see" — which is also the only non-leaking one, since
 * "restricted" and "gone" must stay indistinguishable.
 */
export async function resolveLinks(
  tx: Tx,
  ctx: MailExtensionCtx,
  extensions: readonly MailExtension[],
  links: readonly MailLink[],
): Promise<ResolvedLink[]> {
  const entities = await resolveLinkEntities(tx, ctx, extensions, links);
  return links.map((link) => ({
    linkId: link.id,
    extensionSlug: link.extensionSlug,
    entityType: link.entityType,
    entityId: link.entityId,
    entity: entities.get(entityKey(link)) ?? null,
    createdAt: link.createdAt,
  }));
}
