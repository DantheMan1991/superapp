import "server-only";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import type { Site, SiteDomain, SiteImage, SitePage, SitePageVersion } from "@/db/schema";
import type { ResolvedBrand } from "@/lib/brand/core";
import { resolveBrandForSite } from "@/lib/brand/read";
import { findManagedCalendarId, itemsOnCalendar } from "@/lib/schedule/managed-calendars";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { loadSiteBlocks } from "@/lib/site-blocks/resolve";
import type { BlockView } from "@/lib/site-blocks/types";
import { EVENTS_LOAD_DAYS, type LiveEvent } from "./events-core";
import {
  readPageContent,
  readSiteSettings,
  type Section,
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
  /** The site's photos by id, as the renderer needs them: a section whose photo is not here draws none. */
  images: Record<string, { width: number; height: number }>;
  /** The business's timezone: what an event's day and time are said in. */
  timezone: string;
  /**
   * What is on the Events calendar for the next `EVENTS_LOAD_DAYS`, loaded
   * only when a page on show has an events section; empty otherwise, and
   * empty when Scheduling has never made the calendar.
   */
  events: LiveEvent[];
  /**
   * What each pack block on show lists, by `blockKey`, loaded through the
   * declared slot only for the blocks a page on show carries and only
   * while their pack is on (slice 9b); a block with no entry draws nothing.
   */
  blocks: Record<string, BlockView>;
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

/**
 * A site that USED to be at this address (slice 11b), so the old address
 * can send people on: the current slug and status, identifiers only, under
 * `withSystem` like the lookup above. A current slug elsewhere is looked up
 * first by the caller, so it wins over a previous one here.
 */
export async function lookupSiteByPreviousSlug(slug: string): Promise<{ slug: string; status: string } | null> {
  const rows = await withSystem((tx) =>
    tx
      .select({ slug: schema.sites.slug, status: schema.sites.status })
      .from(schema.sites)
      .where(sql`${schema.sites.previousSlugs} @> ARRAY[${slug}]::text[]`)
      .limit(1),
  );
  return rows[0] ?? null;
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

/**
 * What these sections would show live, whether or not they are saved: the
 * blocks' views and the events when one asks for them (the editor's live
 * preview, slice 13). The same two reads the site makes for a page on show.
 */
export async function loadLiveData(
  tx: Tx,
  tenantId: string,
  sections: Section[],
  now = new Date(),
): Promise<{ blocks: Record<string, BlockView>; events: LiveEvent[] }> {
  const blocks = await loadSiteBlocks(tx, tenantId, sections, now);
  const events = sections.some((s) => s.type === "events") ? await liveEvents(tx, tenantId, now) : [];
  return { blocks, events };
}

/** Every section of every page on show, for the slot to pick its blocks from. */
function sectionsOnShow(pages: SitePage[], which: "draft" | "published"): Section[] {
  return pages.flatMap((p) => readPageContent(which === "draft" ? p.draft : p.published).sections);
}

/** Whether any page on show carries a live events block, so the calendar is read only when it is drawn. */
function wantsEvents(pages: SitePage[], which: "draft" | "published"): boolean {
  return pages.some((p) =>
    readPageContent(which === "draft" ? p.draft : p.published).sections.some((s) => s.type === "events"),
  );
}

/** The Events calendar's next months, as the renderer takes them; nothing when there is no such calendar. */
export async function liveEvents(tx: Tx, tenantId: string, now = new Date()): Promise<LiveEvent[]> {
  const calendarId = await findManagedCalendarId(tx, tenantId, "events");
  if (!calendarId) return [];
  const items = await itemsOnCalendar(tx, calendarId, now, new Date(now.getTime() + EVENTS_LOAD_DAYS * 86_400_000));
  return items.map((item) => ({
    id: item.id,
    occurrenceDate: item.occurrenceDate,
    title: item.title ?? "",
    location: item.location ?? "",
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    allDay: item.allDay,
  }));
}

function toView(
  site: Site,
  brand: ResolvedBrand,
  pages: SitePage[],
  which: "draft" | "published",
  customHost: string | null,
  images: SiteImage[],
  timezone: string,
  events: LiveEvent[],
  blocks: Record<string, BlockView>,
): PublicSite {
  return {
    images: Object.fromEntries(images.map((i) => [i.id, { width: i.width, height: i.height }])),
    timezone,
    events,
    blocks,
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
    const brand = await resolveBrandForSite(tx, hit.tenantId, hit.id);
    const customHost = await activeHost(tx, hit.tenantId, site.id);
    const images = await listSiteImages(tx, hit.tenantId, site.id);
    const timezone = await getTenantTimezone(tx, hit.tenantId);
    const events = wantsEvents(pages, "published") ? await liveEvents(tx, hit.tenantId) : [];
    const blocks = await loadSiteBlocks(tx, hit.tenantId, sectionsOnShow(pages, "published"));
    return toView(site, brand, pages, "published", customHost, images, timezone, events, blocks);
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
  images: SiteImage[];
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
  const images = await listSiteImages(tx, tenantId, site.id);
  return { site, page, siblings, versions, images };
}

/** The tenant's site with its drafts and domains, inside the caller's transaction. Null when none. */
export async function loadSiteDrafts(
  tx: Tx,
  tenantId: string,
  siteId: string,
): Promise<{ site: Site; pages: SitePage[]; domains: SiteDomain[]; images: SiteImage[]; view: PublicSite } | null> {
  // NAMED, not found: a tenant may have several sites (ADR 0045). Null when
  // the id is not this tenant's, which the screen shows as "no website".
  const site = await tx.query.sites.findFirst({
    where: and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.id, siteId)),
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
  const brand = await resolveBrandForSite(tx, tenantId, site.id);
  const customHost = domains.find((d) => d.status === "active")?.domain ?? null;
  const images = await listSiteImages(tx, tenantId, site.id);
  const timezone = await getTenantTimezone(tx, tenantId);
  const events = wantsEvents(pages, "draft") ? await liveEvents(tx, tenantId) : [];
  const blocks = await loadSiteBlocks(tx, tenantId, sectionsOnShow(pages, "draft"));
  return { site, pages, domains, images, view: toView(site, brand, pages, "draft", customHost, images, timezone, events, blocks) };
}

/** The site's photo library, newest last, inside the caller's transaction. */
export async function listSiteImages(tx: Tx, tenantId: string, siteId: string): Promise<SiteImage[]> {
  return tx.query.siteImages.findMany({
    where: and(eq(schema.siteImages.tenantId, tenantId), eq(schema.siteImages.siteId, siteId)),
    orderBy: asc(schema.siteImages.createdAt),
  });
}
