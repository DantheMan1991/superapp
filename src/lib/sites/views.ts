import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { addDays, todayInTimezone } from "@/lib/timezone";
import { lookupSiteBySlug } from "./read";
import { normalizeSiteSlug } from "./slug";
import { VIEWS_WINDOW_DAYS, type ViewBeacon, type ViewRow } from "./views-core";

/**
 * Counting a page view — the second public write into a tenant, and the
 * smaller one (ADR 0022).
 *
 * The same shape as an enquiry: the slug goes through the trusted lookup,
 * only a published site counts, and the write runs as `staff` inside that
 * tenant so the member policies bound it. What it can do is add one to two
 * counters on one row — and only for a path that IS a published page of
 * the site, so a stranger cannot grow the table with made-up paths.
 *
 * Returns whether the view was counted. The route answers 204 either way:
 * whether a slug exists is not something a beacon should be able to ask.
 */
export async function recordSiteView(beacon: ViewBeacon): Promise<boolean> {
  const slug = normalizeSiteSlug(beacon.site);
  if (!slug.ok) return false;
  const hit = await lookupSiteBySlug(slug.slug);
  if (!hit || hit.status !== "published") return false;
  const path = beacon.path.startsWith("/") ? beacon.path : "/";

  return withTenant(
    hit.tenantId,
    async (tx) => {
      const page = await tx.query.sitePages.findFirst({
        where: and(
          eq(schema.sitePages.tenantId, hit.tenantId),
          eq(schema.sitePages.siteId, hit.id),
          eq(schema.sitePages.path, path),
        ),
        columns: { id: true, published: true },
      });
      if (!page || page.published === null) return false;

      const day = todayInTimezone(await getTenantTimezone(tx, hit.tenantId));
      const first = beacon.first ? 1 : 0;
      await tx
        .insert(schema.sitePageViews)
        .values({ tenantId: hit.tenantId, siteId: hit.id, day, path, views: 1, visitors: first })
        .onConflictDoUpdate({
          target: [schema.sitePageViews.siteId, schema.sitePageViews.day, schema.sitePageViews.path],
          set: {
            views: sql`${schema.sitePageViews.views} + 1`,
            visitors: sql`${schema.sitePageViews.visitors} + ${first}`,
            updatedAt: new Date(),
          },
        });
      return true;
    },
    { role: "staff" },
  );
}

/** The window's rows, for `summarizeViews`. `today` is the tenant's. */
export async function listSiteViews(
  tx: Tx,
  tenantId: string,
  siteId: string,
  today: string,
  days = VIEWS_WINDOW_DAYS,
): Promise<ViewRow[]> {
  const rows = await tx
    .select({
      day: schema.sitePageViews.day,
      path: schema.sitePageViews.path,
      views: schema.sitePageViews.views,
      visitors: schema.sitePageViews.visitors,
    })
    .from(schema.sitePageViews)
    .where(
      and(
        eq(schema.sitePageViews.tenantId, tenantId),
        eq(schema.sitePageViews.siteId, siteId),
        gte(schema.sitePageViews.day, addDays(today, -(days - 1))),
      ),
    );
  return rows;
}
