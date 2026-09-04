import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import type { Site, SitePage, SitePageVersion } from "@/db/schema";
import type { ResolvedBrand } from "@/lib/brand/core";
import { resolveBrandFor } from "@/lib/brand/read";
import {
  readPageContent,
  readSiteSettings,
  type SitePageView,
  type SiteSettings,
} from "./schema";

/**
 * Reading a site — for the public renderer, the draft preview and the
 * Marketing screen.
 *
 * **`lookupSiteBySlug` is the one `withSystem` read on the public path**, and
 * the reason is the same as for an inbound-mail token: a stranger's request
 * carries no tenant, so something trusted has to turn the address into one.
 * It returns identifiers only. Everything after it runs inside that tenant's
 * context as `staff`, through the ordinary member policies, so the database
 * is still deciding whose rows these are.
 */
export interface PublicSite {
  id: string;
  slug: string;
  /** The header name: the site's own title, else the brand's display name. */
  title: string;
  status: string;
  publishedAt: Date | null;
  settings: SiteSettings;
  brand: ResolvedBrand;
  pages: SitePageView[];
}

export async function lookupSiteBySlug(
  slug: string,
): Promise<{ id: string; tenantId: string; status: string } | null> {
  const row = await withSystem((tx) =>
    tx.query.sites.findFirst({
      where: eq(schema.sites.slug, slug),
      columns: { id: true, tenantId: true, status: true },
    }),
  );
  return row ?? null;
}

function toView(
  site: Site,
  brand: ResolvedBrand,
  pages: SitePage[],
  which: "draft" | "published",
): PublicSite {
  return {
    id: site.id,
    slug: site.slug,
    title: site.title || brand.displayName,
    status: site.status,
    publishedAt: site.publishedAt,
    settings: readSiteSettings(site.settings),
    brand,
    pages: pages
      .filter((p) => which === "draft" || p.published !== null)
      .map((p) => ({
        path: p.path,
        title: p.title,
        inNav: p.inNav,
        navOrder: p.navOrder,
        content: readPageContent(which === "draft" ? p.draft : p.published),
      })),
  };
}

/** The site as the internet sees it: published pages only, or nothing. */
export async function loadPublishedSite(slug: string): Promise<PublicSite | null> {
  const hit = await lookupSiteBySlug(slug);
  if (!hit || hit.status !== "published") return null;
  return withTenant(hit.tenantId, async (tx) => {
    const site = await tx.query.sites.findFirst({
      where: and(eq(schema.sites.tenantId, hit.tenantId), eq(schema.sites.id, hit.id)),
    });
    if (!site || site.status !== "published") return null;
    const pages = await tx.query.sitePages.findMany({
      where: and(
        eq(schema.sitePages.tenantId, hit.tenantId),
        eq(schema.sitePages.siteId, site.id),
        isNotNull(schema.sitePages.published),
      ),
      orderBy: asc(schema.sitePages.navOrder),
    });
    const brand = await resolveBrandFor(tx, hit.tenantId, null);
    return toView(site, brand, pages, "published");
  });
}

/** One page and its history, for the editor. Null when it is not this tenant's. */
export async function loadPageEditor(
  tx: Tx,
  tenantId: string,
  pageId: string,
): Promise<{
  site: Site;
  page: SitePage;
  siblings: Array<{ id: string; path: string; title: string }>;
  versions: SitePageVersion[];
} | null> {
  const page = await tx.query.sitePages.findFirst({
    where: and(eq(schema.sitePages.tenantId, tenantId), eq(schema.sitePages.id, pageId)),
  });
  if (!page) return null;
  const site = await tx.query.sites.findFirst({
    where: and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.id, page.siteId)),
  });
  if (!site) return null;
  const siblings = await tx.query.sitePages.findMany({
    where: and(eq(schema.sitePages.tenantId, tenantId), eq(schema.sitePages.siteId, site.id)),
    columns: { id: true, path: true, title: true },
    orderBy: asc(schema.sitePages.navOrder),
  });
  const versions = await tx.query.sitePageVersions.findMany({
    where: and(
      eq(schema.sitePageVersions.tenantId, tenantId),
      eq(schema.sitePageVersions.pageId, page.id),
    ),
    orderBy: desc(schema.sitePageVersions.createdAt),
  });
  return { site, page, siblings, versions };
}

/** The tenant's site with its drafts, inside the caller's transaction. Null when none. */
export async function loadSiteDrafts(
  tx: Tx,
  tenantId: string,
): Promise<{ site: Site; pages: SitePage[]; view: PublicSite } | null> {
  const site = await tx.query.sites.findFirst({
    where: eq(schema.sites.tenantId, tenantId),
  });
  if (!site) return null;
  const pages = await tx.query.sitePages.findMany({
    where: and(eq(schema.sitePages.tenantId, tenantId), eq(schema.sitePages.siteId, site.id)),
    orderBy: asc(schema.sitePages.navOrder),
  });
  const brand = await resolveBrandFor(tx, tenantId, null);
  return { site, pages, view: toView(site, brand, pages, "draft") };
}
