import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Site } from "@/db/schema";
import type { AssembledPage } from "@/lib/sites/copy";
import { readPageContent, type SiteSettings } from "@/lib/sites/schema";
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
export async function findSite(tx: Tx, tenantId: string): Promise<Site | null> {
  const row = await tx.query.sites.findFirst({
    where: eq(schema.sites.tenantId, tenantId),
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
  input: { title: string; settings: SiteSettings },
): Promise<Site> {
  return updateSite(tx, ctx, siteId, { title: input.title, settings: input.settings });
}

export async function changeSiteSlug(
  tx: Tx,
  ctx: MarketingCtx,
  siteId: string,
  slug: string,
): Promise<Site> {
  try {
    return await updateSite(tx, ctx, siteId, { slug });
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
