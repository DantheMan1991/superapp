import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Site } from "@/db/schema";
import type { AssembledPage } from "@/lib/sites/copy";
import { readPageContent, type SiteSettings } from "@/lib/sites/schema";
import { withPreviousSlug } from "@/lib/sites/slug";
import { MarketingError } from "./core/errors";
import type { MarketingCtx } from "./kit-ops";
import { recordVersion } from "./page-ops";

/**
 * Writing the site. Takes the caller's `tx`; the action layer owns the
 * transaction, the gate and the audit row.
 *
 * The slug's uniqueness is platform-wide, which a tenant transaction cannot
 * check by reading — RLS hides every other tenant's site. The unique index
 * checks it instead, and `isUniqueViolation` turns the constraint error
 * into the friendly answer. That is the right order: a pre-read would be a
 * race the index has to settle anyway.
 */
/**
 * Every site the tenant has, oldest first — the order the Website screen
 * lists them, so a site does not move when another is added or renamed.
 *
 * MANY SITES PER TENANT since ADR 0045. There used to be a `findSite(tx,
 * tenantId)` here and a UNIQUE index making it answerable; both are gone,
 * because "the tenant's site" is no longer a question with an answer. A
 * caller that wants one names it.
 */
export async function listSites(tx: Tx, tenantId: string): Promise<Site[]> {
  return tx.query.sites.findMany({
    where: eq(schema.sites.tenantId, tenantId),
    orderBy: (s, { asc }) => [asc(s.createdAt), asc(s.id)],
  });
}

/**
 * One site, by id. The tenant predicate is belt to RLS's braces: a site id
 * arriving from a form is a CLAIM, and this is where it stops being one.
 * Null when the id is not this tenant's, which every caller turns into the
 * same refusal a missing site gets.
 */
export async function findSiteById(
  tx: Tx,
  tenantId: string,
  siteId: string,
): Promise<Site | null> {
  const row = await tx.query.sites.findFirst({
    where: and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.id, siteId)),
  });
  return row ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code
    ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export async function createSite(
  tx: Tx,
  ctx: MarketingCtx,
  input: { slug: string; settings: SiteSettings; copySource: "model" | "standard" },
): Promise<Site> {
  try {
    const [created] = await tx
      .insert(schema.sites)
      .values({
        tenantId: ctx.tenantId,
        slug: input.slug,
        settings: input.settings,
        copySource: input.copySource,
      })
      .returning();
    if (!created) throw new MarketingError("FORBIDDEN", "site not created");
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw new MarketingError("SLUG_TAKEN", input.slug);
    throw err;
  }
}

async function updateSite(
  tx: Tx,
  ctx: MarketingCtx,
  siteId: string,
  patch: Partial<typeof schema.sites.$inferInsert>,
): Promise<Site> {
  const [updated] = await tx
    .update(schema.sites)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.sites.tenantId, ctx.tenantId), eq(schema.sites.id, siteId)))
    .returning();
  // Zero rows is how RLS says no to an UPDATE; treat it as the refusal it is.
  if (!updated) throw new MarketingError("FORBIDDEN", "site not updated");
  return updated;
}

/**
 * Write the assembled pages as DRAFTS, by path: an existing page keeps its
 * published snapshot and gets a new draft; a new path is inserted. Nothing
 * is deleted — a page the writer did not produce this time is still the
 * owner's page.
 */
export async function replaceDrafts(
  tx: Tx,
  ctx: MarketingCtx,
  siteId: string,
  pages: AssembledPage[],
  copySource: "model" | "standard",
): Promise<void> {
  for (const page of pages) {
    const existing = await tx.query.sitePages.findFirst({
      where: and(
        eq(schema.sitePages.tenantId, ctx.tenantId),
        eq(schema.sitePages.siteId, siteId),
        eq(schema.sitePages.path, page.path),
      ),
      columns: { id: true },
    });
    if (existing) {
      const [updated] = await tx
        .update(schema.sitePages)
        .set({
          title: page.title,
          navOrder: page.navOrder,
          inNav: page.inNav,
          draft: page.content,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, existing.id)))
        .returning({ id: schema.sitePages.id });
      if (!updated) throw new MarketingError("FORBIDDEN", "page not updated");
    } else {
      await tx.insert(schema.sitePages).values({
        tenantId: ctx.tenantId,
        siteId,
        path: page.path,
        title: page.title,
        navOrder: page.navOrder,
        inNav: page.inNav,
        draft: page.content,
      });
    }
  }
  await updateSite(tx, ctx, siteId, { copySource });
}

export async function updateSiteSettings(
  tx: Tx,
  ctx: MarketingCtx,
  siteId: string,
  input: { title?: string; settings: SiteSettings },
): Promise<Site> {
  return updateSite(tx, ctx, siteId, {
    ...(input.title === undefined ? {} : { title: input.title }),
    settings: input.settings,
  });
}

export async function changeSiteSlug(
  tx: Tx,
  ctx: MarketingCtx,
  site: Pick<Site, "id" | "slug" | "previousSlugs">,
  slug: string,
): Promise<Site> {
  try {
    // The old address is kept (slice 11b) so it can send people on.
    return await updateSite(tx, ctx, site.id, {
      slug,
      previousSlugs: withPreviousSlug(site.previousSlugs, site.slug, slug),
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new MarketingError("SLUG_TAKEN", slug);
    throw err;
  }
}

/**
 * Every draft becomes the published snapshot, and the site goes live. Each
 * page records a `publish` version, so history shows what was on the
 * internet when, not only what was saved.
 */
export async function publishSite(tx: Tx, ctx: MarketingCtx, siteId: string): Promise<Site> {
  const pages = await tx.query.sitePages.findMany({
    where: and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.siteId, siteId)),
    columns: { id: true, draft: true, published: true },
  });
  if (pages.length === 0) throw new MarketingError("SITE_EMPTY", "no pages to publish");
  for (const page of pages) {
    const [updated] = await tx
      .update(schema.sitePages)
      .set({ published: page.draft, updatedAt: new Date() })
      .where(and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, page.id)))
      .returning({ id: schema.sitePages.id });
    if (!updated) throw new MarketingError("FORBIDDEN", "page not published");
    // Only when something went live that was not live before; re-publishing
    // an unchanged page is not a step worth a history row.
    if (JSON.stringify(page.published) !== JSON.stringify(page.draft)) {
      await recordVersion(tx, ctx, page.id, "publish", readPageContent(page.draft));
    }
  }
  return updateSite(tx, ctx, siteId, { status: "published", publishedAt: new Date() });
}

/** Off the internet; the drafts and the last snapshot stay for the next publish. */
export async function unpublishSite(tx: Tx, ctx: MarketingCtx, siteId: string): Promise<Site> {
  return updateSite(tx, ctx, siteId, { status: "draft" });
}

/**
 * What a deleted website takes with it, and what the caller must still do.
 *
 * The blobs are the one thing the database cannot clean up: `site_images` and
 * the site's own logo are ROWS pointing at files in blob storage, and a
 * cascade deletes the rows and leaves the files. They come back here so the
 * action can discard them AFTER the transaction commits — the house rule that
 * a transaction never waits on the network, and the ordering that means a
 * rolled-back delete has not already destroyed the files.
 */
export interface SiteRemoval {
  blobs: string[];
  /** What went, for the audit row. */
  counts: { pages: number; enquiries: number; photos: number };
}

/**
 * Remove a website: its pages and their history, its messages, its visitor
 * counts, its photos and its own look — everything that hangs off it cascades
 * (`src/db/schema/sites.ts`).
 *
 * TWO REFUSALS, BOTH SO THE DESTRUCTIVE ACT IS NEVER THE FIRST ONE:
 *
 *   - **A published site is refused.** Unpublishing is one click and it is
 *     reversible; deleting is neither. Requiring both means nobody takes a
 *     live site off the internet by accident, and a visitor mid-page gets a
 *     site that stops existing only after somebody decided twice.
 *   - **A connected domain is refused.** The domain has to come off Vercel as
 *     well as out of the table, and `removeDomainAction` is the tested path
 *     that does both. Cascading the row here would leave the project holding
 *     a domain pointing at a site that is gone — half a delete, and the half
 *     nobody can see from inside the app.
 *
 * WHAT SURVIVES, and it is the part worth knowing before pressing: every
 * enquiry already became a customer in the CRM and a follow-up in Work, and
 * the follow-up's notes carry the message itself (`enquiryNotes`). Those live
 * in their own tables and are untouched. What goes is the enquiry ROW — the
 * structured record of which page it came from and what the answers were.
 */
export async function deleteSite(
  tx: Tx,
  ctx: MarketingCtx,
  siteId: string,
): Promise<SiteRemoval> {
  const site = await findSiteById(tx, ctx.tenantId, siteId);
  if (!site) throw new MarketingError("SITE_MISSING", "no site");
  if (site.status === "published") {
    throw new MarketingError("SITE_PUBLISHED", "unpublish first");
  }

  const domains = await tx.query.siteDomains.findMany({
    where: and(eq(schema.siteDomains.tenantId, ctx.tenantId), eq(schema.siteDomains.siteId, siteId)),
    columns: { id: true },
  });
  if (domains.length > 0) throw new MarketingError("SITE_HAS_DOMAIN", "remove the domain first");

  const photos = await tx.query.siteImages.findMany({
    where: and(eq(schema.siteImages.tenantId, ctx.tenantId), eq(schema.siteImages.siteId, siteId)),
    columns: { pathname: true },
  });
  const pages = await tx.query.sitePages.findMany({
    where: and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.siteId, siteId)),
    columns: { id: true },
  });
  const enquiries = await tx.query.siteEnquiries.findMany({
    where: and(eq(schema.siteEnquiries.tenantId, ctx.tenantId), eq(schema.siteEnquiries.siteId, siteId)),
    columns: { id: true },
  });
  // The site's own look, if it was given one (ADR 0045). The row cascades;
  // its logo is a blob and does not.
  const kit = await tx.query.brandKits.findFirst({
    where: and(eq(schema.brandKits.tenantId, ctx.tenantId), eq(schema.brandKits.siteId, siteId)),
    columns: { logoPathname: true },
  });

  const [deleted] = await tx
    .delete(schema.sites)
    .where(and(eq(schema.sites.tenantId, ctx.tenantId), eq(schema.sites.id, siteId)))
    .returning({ id: schema.sites.id });
  // Zero rows is how RLS says no to a DELETE; treat it as the refusal it is.
  if (!deleted) throw new MarketingError("FORBIDDEN", "site not deleted");

  const blobs = [...photos.map((p) => p.pathname), kit?.logoPathname]
    .filter((p): p is string => Boolean(p));
  return {
    blobs,
    counts: { pages: pages.length, enquiries: enquiries.length, photos: photos.length },
  };
}
