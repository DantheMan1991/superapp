import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import type { Site, SiteDomain, SitePage, SitePageVersion } from "@/db/schema";
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
 * **`lookupSiteBySlug` and `lookupSiteByDomain` are the two `withSystem`
 * reads on the public path**, and the reason is the same as for an
 * inbound-mail token: a stranger's request carries no tenant, so something
 * trusted has to turn the address into one. They return identifiers only.
 * Everything after them runs inside that tenant's context as `staff`,
 * through the ordinary member policies, so the database is still deciding
 * whose rows these are.
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
  /**
   * The first domain the business connected and Vercel confirmed, if any:
   * the address search engines are told is the real one, whatever address
   * the page was reached by.
   */
  customHost: string | null;
}

export interface SiteHit {
  id: string;
  tenantId: string;
  status: string;
}

export async function lookupSiteBySlug(slug: string): Promise<SiteHit | null> {
  const row = await withSystem((tx) =>
    tx.query.sites.findFirst({
      where: eq(schema.sites.slug, slug),
      columns: { id: true, tenantId: true, status: true },
    }),
  );
  return row ?? null;
}

/** A connected domain routes only while its row is `active` (Vercel's word). */
export async function lookupSiteByDomain(host: string): Promise<SiteHit | null> {
  const rows = await withSystem((tx) =>
    tx
      .select({
        id: schema.sites.id,
        tenantId: schema.sites.tenantId,
        status: schema.sites.status,
      })
      .from(schema.siteDomains)
      .innerJoin(
        schema.sites,
        and(
          eq(schema.sites.id, schema.siteDomains.siteId),
          eq(schema.sites.tenantId, schema.siteDomains.tenantId),
        ),
      )
      .where(
        and(eq(schema.siteDomains.domain, host), eq(schema.siteDomains.status, "active")),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

function toView(
  site: Site,
  brand: ResolvedBrand,
  pages: SitePage[],
  which: "draft" | "published",
  customHost: string | null,
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
    customHost,
  };
}

async function activeHost(tx: Tx, tenantId: string, siteId: string): Promise<string | null> {
  const row = await tx.query.siteDomains.findFirst({
    where: and(
      eq(schema.siteDomains.tenantId, tenantId),
      eq(schema.siteDomains.siteId, siteId),
      eq(schema.siteDomains.status, "active"),
    ),
    orderBy: asc(schema.siteDomains.createdAt),
    columns: { domain: true },
  });
  return row?.domain ?? null;
}

async function loadPublishedFromHit(hit: SiteHit): Promise<PublicSite | null> {
  if (hit.status !== "published") return null;
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
    const customHost = await activeHost(tx, hit.tenantId, site.id);
    return toView(site, brand, pages, "published", customHost);
  });
}

/** The site as the internet sees it: published pages only, or nothing. */
export async function loadPublishedSite(slug: string): Promise<PublicSite | null> {
  const hit = await lookupSiteBySlug(slug);
  return hit ? loadPublishedFromHit(hit) : null;
}

/** The same, reached through a domain the business connected. */
export async function loadPublishedSiteByDomain(host: string): Promise<PublicSite | null> {
  const hit = await lookupSiteByDomain(host);
  return hit ? loadPublishedFromHit(hit) : null;
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

/** The tenant's site with its drafts and domains, inside the caller's transaction. Null when none. */
export async function loadSiteDrafts(
  tx: Tx,
  tenantId: string,
): Promise<{ site: Site; pages: SitePage[]; domains: SiteDomain[]; view: PublicSite } | null> {
  const site = await tx.query.sites.findFirst({
    where: eq(schema.sites.tenantId, tenantId),
  });
  if (!site) return null;
  const pages = await tx.query.sitePages.findMany({
    where: and(eq(schema.sitePages.tenantId, tenantId), eq(schema.sitePages.siteId, site.id)),
    orderBy: asc(schema.sitePages.navOrder),
  });
  const domains = await tx.query.siteDomains.findMany({
    where: and(eq(schema.siteDomains.tenantId, tenantId), eq(schema.siteDomains.siteId, site.id)),
    orderBy: asc(schema.siteDomains.createdAt),
  });
  const brand = await resolveBrandFor(tx, tenantId, null);
  const customHost = domains.find((d) => d.status === "active")?.domain ?? null;
  return { site, pages, domains, view: toView(site, brand, pages, "draft", customHost) };
}
