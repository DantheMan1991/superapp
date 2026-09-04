import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `sites` + `site_pages` RLS — the business's public website.
 *
 * Members read; owners write; nobody sees another tenant's site. The address
 * (`slug`) is unique ACROSS tenants because it is a hostname label, which a
 * tenant transaction cannot check by reading — the unique index does it, and
 * this file proves it does. The composite FK makes a page on another
 * tenant's site unrepresentable even under `withSystem`.
 */
d("sites and site_pages (RLS)", () => {
  const STAMP = `iso-site-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;
  const SLUG_A = `${STAMP}-a`;
  const SLUG_B = `${STAMP}-b`;

  let tenantA: string;
  let tenantB: string;
  let siteA: string;
  let siteB: string;
  let pageA: string;
  let pageB: string;

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Site A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Site B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;
      const sites = await tx
        .insert(schema.sites)
        .values([
          { tenantId: tenantA, slug: SLUG_A, status: "published", publishedAt: new Date() },
          { tenantId: tenantB, slug: SLUG_B },
        ])
        .returning();
      siteA = sites[0].id;
      siteB = sites[1].id;
      const pages = await tx
        .insert(schema.sitePages)
        .values([
          {
            tenantId: tenantA,
            siteId: siteA,
            path: "/",
            title: "Home",
            draft: { description: "", sections: [{ type: "hero", headline: "A's secret draft", subheadline: "", cta: null }] },
            published: { description: "", sections: [] },
          },
          { tenantId: tenantB, siteId: siteB, path: "/", title: "Home" },
        ])
        .returning();
      pageA = pages[0].id;
      pageB = pages[1].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("staff read their own site and pages and nothing of the other tenant's", async () => {
    const sites = await asStaff((tx) => tx.select().from(schema.sites));
    expect(sites.map((s) => s.id)).toEqual([siteA]);
    const pages = await asStaff((tx) => tx.select().from(schema.sitePages));
    expect(pages.map((p) => p.id)).toEqual([pageA]);
    expect(pages.some((p) => p.id === pageB)).toBe(false);
  });

  it("staff cannot write a site or a page — the policies are owner-only", async () => {
    await expect(
      asStaff((tx) => tx.insert(schema.sites).values({ tenantId: tenantA, slug: `${STAMP}-x` })),
    ).rejects.toThrow();
    const updated = await asStaff((tx) =>
      tx.update(schema.sites).set({ status: "draft" }).where(eq(schema.sites.id, siteA)).returning(),
    );
    expect(updated).toHaveLength(0);
    const pageUpdated = await asStaff((tx) =>
      tx.update(schema.sitePages).set({ title: "Forged" }).where(eq(schema.sitePages.id, pageA)).returning(),
    );
    expect(pageUpdated).toHaveLength(0);
    const still = await withSystem((tx) =>
      tx.query.sites.findFirst({ where: eq(schema.sites.id, siteA) }),
    );
    expect(still?.status).toBe("published");
  });

  it("an owner writes their own site and pages", async () => {
    const [site] = await asOwner((tx) =>
      tx.update(schema.sites).set({ title: "Oak Row" }).where(eq(schema.sites.id, siteA)).returning(),
    );
    expect(site.title).toBe("Oak Row");
    const [page] = await asOwner((tx) =>
      tx
        .insert(schema.sitePages)
        .values({ tenantId: tenantA, siteId: siteA, path: "/about", title: "About" })
        .returning(),
    );
    expect(page.path).toBe("/about");
    const deleted = await asOwner((tx) =>
      tx.delete(schema.sitePages).where(eq(schema.sitePages.id, page.id)).returning(),
    );
    expect(deleted).toHaveLength(1);
  });

  it("another tenant's owner cannot read, update or delete tenant A's site", async () => {
    const seen = await asOtherTenant((tx) => tx.select().from(schema.sites));
    expect(seen.map((s) => s.id)).toEqual([siteB]);
    const updated = await asOtherTenant((tx) =>
      tx.update(schema.sites).set({ status: "draft" }).where(eq(schema.sites.id, siteA)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asOtherTenant((tx) =>
      tx.delete(schema.sitePages).where(eq(schema.sitePages.id, pageA)).returning(),
    );
    expect(deleted).toHaveLength(0);
    // A's draft is invisible to B by every route, including reading the page row.
    const drafts = await asOtherTenant((tx) =>
      tx.select({ draft: schema.sitePages.draft }).from(schema.sitePages).where(eq(schema.sitePages.id, pageA)),
    );
    expect(drafts).toHaveLength(0);
  });

  it("an address is unique across tenants, and a tenant holds one site", async () => {
    await expect(
      withSystem((tx) => tx.insert(schema.sites).values({ tenantId: tenantB, slug: SLUG_A })),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) => tx.insert(schema.sites).values({ tenantId: tenantA, slug: `${STAMP}-second` })),
    ).rejects.toThrow();
  });

  it("a page on another tenant's site is unrepresentable, even under withSystem", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.sitePages).values({ tenantId: tenantB, siteId: siteA, path: "/x", title: "X" }),
      ),
    ).rejects.toThrow();
  });

  it("the CHECKs refuse a bad address, a bad status and a bad page path", async () => {
    await expect(
      withSystem((tx) => tx.insert(schema.sites).values({ tenantId: tenantB, slug: "-bad-" })),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) => tx.update(schema.sites).set({ status: "live" }).where(eq(schema.sites.id, siteA))),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) =>
        tx.insert(schema.sitePages).values({ tenantId: tenantA, siteId: siteA, path: "about", title: "No slash" }),
      ),
    ).rejects.toThrow();
  });

  it("pages go with their site", async () => {
    const [extra] = await withSystem((tx) =>
      tx.insert(schema.tenants).values({ clerkOrgId: `${STAMP}-c`, name: "Site C", slug: `${STAMP}-c` }).returning(),
    );
    const [site] = await withSystem((tx) =>
      tx.insert(schema.sites).values({ tenantId: extra.id, slug: `${STAMP}-c` }).returning(),
    );
    const [page] = await withSystem((tx) =>
      tx.insert(schema.sitePages).values({ tenantId: extra.id, siteId: site.id, path: "/", title: "Home" }).returning(),
    );
    await withSystem((tx) => tx.delete(schema.sites).where(eq(schema.sites.id, site.id)));
    const gone = await withSystem((tx) =>
      tx.query.sitePages.findFirst({ where: and(eq(schema.sitePages.tenantId, extra.id), eq(schema.sitePages.id, page.id)) }),
    );
    expect(gone).toBeUndefined();
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, extra.id)));
  });

  it("default-deny: no context sees no sites and no pages", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      const s = await tx.select().from(schema.sites);
      const p = await tx.select().from(schema.sitePages);
      return s.length + p.length;
    });
    expect(rows).toBe(0);
  });
});
