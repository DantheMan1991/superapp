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

/**
 * `site_page_versions` RLS — a page's history. Same posture as the page:
 * members read, owners write, the composite FK makes another tenant's page
 * unreachable even under `withSystem`, and history dies with its page.
 */
d("site_page_versions (RLS)", () => {
  const STAMP = `iso-sitever-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;
  const EMPTY = { description: "", sections: [] };

  let tenantA: string;
  let tenantB: string;
  let pageA: string;
  let pageB: string;
  let versionA: string;
  let versionB: string;

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
          { clerkOrgId: `${STAMP}-a`, name: "Ver A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Ver B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;
      const sites = await tx
        .insert(schema.sites)
        .values([
          { tenantId: tenantA, slug: `${STAMP}-a` },
          { tenantId: tenantB, slug: `${STAMP}-b` },
        ])
        .returning();
      const pages = await tx
        .insert(schema.sitePages)
        .values([
          { tenantId: tenantA, siteId: sites[0].id, path: "/", title: "Home" },
          { tenantId: tenantB, siteId: sites[1].id, path: "/", title: "Home" },
        ])
        .returning();
      pageA = pages[0].id;
      pageB = pages[1].id;
      const versions = await tx
        .insert(schema.sitePageVersions)
        .values([
          { tenantId: tenantA, pageId: pageA, kind: "save", content: EMPTY },
          { tenantId: tenantB, pageId: pageB, kind: "publish", content: EMPTY },
        ])
        .returning();
      versionA = versions[0].id;
      versionB = versions[1].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("staff read their own page's history and nothing of the other tenant's", async () => {
    const seen = await asStaff((tx) => tx.select().from(schema.sitePageVersions));
    expect(seen.map((v) => v.id)).toEqual([versionA]);
    expect(seen.some((v) => v.id === versionB)).toBe(false);
  });

  it("staff cannot add or delete a version; an owner can do both", async () => {
    await expect(
      asStaff((tx) =>
        tx.insert(schema.sitePageVersions).values({ tenantId: tenantA, pageId: pageA, content: EMPTY }),
      ),
    ).rejects.toThrow();
    const deleted = await asStaff((tx) =>
      tx.delete(schema.sitePageVersions).where(eq(schema.sitePageVersions.id, versionA)).returning(),
    );
    expect(deleted).toHaveLength(0);
    const [added] = await asOwner((tx) =>
      tx
        .insert(schema.sitePageVersions)
        .values({ tenantId: tenantA, pageId: pageA, kind: "restore", content: EMPTY })
        .returning(),
    );
    expect(added.kind).toBe("restore");
    const gone = await asOwner((tx) =>
      tx.delete(schema.sitePageVersions).where(eq(schema.sitePageVersions.id, added.id)).returning(),
    );
    expect(gone).toHaveLength(1);
  });

  it("another tenant cannot read or delete tenant A's history", async () => {
    const seen = await asOtherTenant((tx) => tx.select().from(schema.sitePageVersions));
    expect(seen.map((v) => v.id)).toEqual([versionB]);
    const deleted = await asOtherTenant((tx) =>
      tx.delete(schema.sitePageVersions).where(eq(schema.sitePageVersions.id, versionA)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("a version on another tenant's page is unrepresentable, and an unknown kind is refused", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.sitePageVersions).values({ tenantId: tenantB, pageId: pageA, content: EMPTY }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.sitePageVersions).values({ tenantId: tenantA, pageId: pageA, kind: "draft", content: EMPTY }),
      ),
    ).rejects.toThrow();
  });

  it("history goes with its page", async () => {
    const [page] = await withSystem(async (tx) => {
      const site = await tx.query.sites.findFirst({ where: eq(schema.sites.tenantId, tenantA) });
      return tx
        .insert(schema.sitePages)
        .values({ tenantId: tenantA, siteId: site!.id, path: "/gone", title: "Gone" })
        .returning();
    });
    const [version] = await withSystem((tx) =>
      tx.insert(schema.sitePageVersions).values({ tenantId: tenantA, pageId: page.id, content: EMPTY }).returning(),
    );
    await withSystem((tx) => tx.delete(schema.sitePages).where(eq(schema.sitePages.id, page.id)));
    const left = await withSystem((tx) =>
      tx.query.sitePageVersions.findFirst({ where: eq(schema.sitePageVersions.id, version.id) }),
    );
    expect(left).toBeUndefined();
  });
});

/**
 * `site_domains` RLS — a domain the business connected. Members read, owners
 * write, one hostname points at one site across the platform, and a domain
 * on another tenant's site is unrepresentable even under `withSystem`.
 */
d("site_domains (RLS)", () => {
  const STAMP = `iso-sitedom-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;
  const DOMAIN_A = `www.${STAMP}-a.example`;
  const DOMAIN_B = `www.${STAMP}-b.example`;

  let tenantA: string;
  let tenantB: string;
  let siteA: string;
  let siteB: string;
  let domainA: string;
  let domainB: string;

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
          { clerkOrgId: `${STAMP}-a`, name: "Dom A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Dom B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;
      const sites = await tx
        .insert(schema.sites)
        .values([
          { tenantId: tenantA, slug: `${STAMP}-a` },
          { tenantId: tenantB, slug: `${STAMP}-b` },
        ])
        .returning();
      siteA = sites[0].id;
      siteB = sites[1].id;
      const domains = await tx
        .insert(schema.siteDomains)
        .values([
          { tenantId: tenantA, siteId: siteA, domain: DOMAIN_A, status: "active" },
          { tenantId: tenantB, siteId: siteB, domain: DOMAIN_B, apex: false },
        ])
        .returning();
      domainA = domains[0].id;
      domainB = domains[1].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("staff read their own domains and nothing of the other tenant's", async () => {
    const seen = await asStaff((tx) => tx.select().from(schema.siteDomains));
    expect(seen.map((d) => d.id)).toEqual([domainA]);
    expect(seen.some((d) => d.id === domainB)).toBe(false);
  });

  it("staff cannot connect, change or remove a domain; an owner can", async () => {
    await expect(
      asStaff((tx) =>
        tx.insert(schema.siteDomains).values({ tenantId: tenantA, siteId: siteA, domain: `x.${STAMP}-a.example` }),
      ),
    ).rejects.toThrow();
    const updated = await asStaff((tx) =>
      tx.update(schema.siteDomains).set({ status: "error" }).where(eq(schema.siteDomains.id, domainA)).returning(),
    );
    expect(updated).toHaveLength(0);
    const [added] = await asOwner((tx) =>
      tx
        .insert(schema.siteDomains)
        .values({ tenantId: tenantA, siteId: siteA, domain: `shop.${STAMP}-a.example` })
        .returning(),
    );
    expect(added.status).toBe("pending");
    const gone = await asOwner((tx) =>
      tx.delete(schema.siteDomains).where(eq(schema.siteDomains.id, added.id)).returning(),
    );
    expect(gone).toHaveLength(1);
  });

  it("another tenant cannot read, update or delete tenant A's domain", async () => {
    const seen = await asOtherTenant((tx) => tx.select().from(schema.siteDomains));
    expect(seen.map((d) => d.id)).toEqual([domainB]);
    const updated = await asOtherTenant((tx) =>
      tx.update(schema.siteDomains).set({ status: "error" }).where(eq(schema.siteDomains.id, domainA)).returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asOtherTenant((tx) =>
      tx.delete(schema.siteDomains).where(eq(schema.siteDomains.id, domainA)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("a hostname points at one site across tenants, and a domain on another tenant's site is unrepresentable", async () => {
    await expect(
      withSystem((tx) => tx.insert(schema.siteDomains).values({ tenantId: tenantB, siteId: siteB, domain: DOMAIN_A })),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.siteDomains).values({ tenantId: tenantB, siteId: siteA, domain: `y.${STAMP}.example` })),
    ).rejects.toThrow();
  });

  it("the CHECKs refuse a bad hostname and an unknown status", async () => {
    await expect(
      asOwner((tx) => tx.insert(schema.siteDomains).values({ tenantId: tenantA, siteId: siteA, domain: "Not A Domain" })),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) => tx.update(schema.siteDomains).set({ status: "live" }).where(eq(schema.siteDomains.id, domainA))),
    ).rejects.toThrow();
  });

  it("domains go with their site", async () => {
    // A tenant holds one site, so the throwaway site needs a tenant of its own.
    const [extra] = await withSystem((tx) =>
      tx.insert(schema.tenants).values({ clerkOrgId: `${STAMP}-c`, name: "Dom C", slug: `${STAMP}-c` }).returning(),
    );
    const [site] = await withSystem((tx) =>
      tx.insert(schema.sites).values({ tenantId: extra.id, slug: `${STAMP}-c` }).returning(),
    );
    const [domain] = await withSystem((tx) =>
      tx.insert(schema.siteDomains).values({ tenantId: extra.id, siteId: site.id, domain: `c.${STAMP}.example` }).returning(),
    );
    await withSystem((tx) => tx.delete(schema.sites).where(eq(schema.sites.id, site.id)));
    const left = await withSystem((tx) =>
      tx.query.siteDomains.findFirst({ where: eq(schema.siteDomains.id, domain.id) }),
    );
    expect(left).toBeUndefined();
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, extra.id)));
  });
});

/**
 * `site_enquiries` RLS — what a site's form received.
 *
 * Members read; MEMBERS insert, because the public path writes as `staff`
 * inside the tenant it resolved (ADR 0021); owners delete; nobody updates.
 * The composite FK makes an enquiry on another tenant's site unrepresentable
 * even under `withSystem`, and the row goes with its site.
 */
d("site_enquiries (RLS)", () => {
  const STAMP = `iso-enq-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let siteA: string;
  let siteB: string;
  let enquiryA: string;
  let enquiryB: string;

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asExpert = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "expert", userId: MATE });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });
  const message = (tenantId: string, siteId: string, name: string) => ({
    tenantId,
    siteId,
    name,
    email: `${name.toLowerCase()}@example.com`,
    message: "Do you have half a beef this autumn?",
  });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Enq A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Enq B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;
      const sites = await tx
        .insert(schema.sites)
        .values([
          { tenantId: tenantA, slug: `${STAMP}-a` },
          { tenantId: tenantB, slug: `${STAMP}-b` },
        ])
        .returning();
      siteA = sites[0].id;
      siteB = sites[1].id;
      const rows = await tx
        .insert(schema.siteEnquiries)
        .values([message(tenantA, siteA, "Ann"), message(tenantB, siteB, "Bob")])
        .returning();
      enquiryA = rows[0].id;
      enquiryB = rows[1].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("staff read their own messages and nothing of the other tenant's", async () => {
    const seen = await asStaff((tx) => tx.select().from(schema.siteEnquiries));
    expect(seen.map((e) => e.id)).toEqual([enquiryA]);
    expect(seen.some((e) => e.id === enquiryB)).toBe(false);
  });

  it("staff insert (the public path's role); an accountant cannot; nobody updates", async () => {
    const [added] = await asStaff((tx) =>
      tx.insert(schema.siteEnquiries).values(message(tenantA, siteA, "Cid")).returning(),
    );
    expect(added.notifyVia).toBe("none");
    await expect(
      asExpert((tx) => tx.insert(schema.siteEnquiries).values(message(tenantA, siteA, "Dee"))),
    ).rejects.toThrow();
    const updated = await asOwner((tx) =>
      tx.update(schema.siteEnquiries).set({ name: "Changed" }).where(eq(schema.siteEnquiries.id, added.id)).returning(),
    );
    expect(updated).toHaveLength(0);
    const byStaff = await asStaff((tx) =>
      tx.delete(schema.siteEnquiries).where(eq(schema.siteEnquiries.id, added.id)).returning(),
    );
    expect(byStaff).toHaveLength(0);
    const byOwner = await asOwner((tx) =>
      tx.delete(schema.siteEnquiries).where(eq(schema.siteEnquiries.id, added.id)).returning(),
    );
    expect(byOwner).toHaveLength(1);
  });

  it("another tenant cannot read or delete tenant A's messages", async () => {
    const seen = await asOtherTenant((tx) => tx.select().from(schema.siteEnquiries));
    expect(seen.map((e) => e.id)).toEqual([enquiryB]);
    const deleted = await asOtherTenant((tx) =>
      tx.delete(schema.siteEnquiries).where(eq(schema.siteEnquiries.id, enquiryA)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("a message on another tenant's site is unrepresentable, and the CHECKs hold", async () => {
    await expect(
      withSystem((tx) => tx.insert(schema.siteEnquiries).values(message(tenantB, siteA, "Eve"))),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) => tx.insert(schema.siteEnquiries).values({ ...message(tenantA, siteA, "Fay"), message: "" })),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) => tx.insert(schema.siteEnquiries).values({ ...message(tenantA, siteA, "Gus"), notifyVia: "sms" })),
    ).rejects.toThrow();
  });

  it("messages go with their site", async () => {
    const [extra] = await withSystem((tx) =>
      tx.insert(schema.tenants).values({ clerkOrgId: `${STAMP}-c`, name: "Enq C", slug: `${STAMP}-c` }).returning(),
    );
    const [site] = await withSystem((tx) =>
      tx.insert(schema.sites).values({ tenantId: extra.id, slug: `${STAMP}-c` }).returning(),
    );
    const [row] = await withSystem((tx) =>
      tx.insert(schema.siteEnquiries).values(message(extra.id, site.id, "Hal")).returning(),
    );
    await withSystem((tx) => tx.delete(schema.sites).where(eq(schema.sites.id, site.id)));
    const left = await withSystem((tx) =>
      tx.query.siteEnquiries.findFirst({ where: eq(schema.siteEnquiries.id, row.id) }),
    );
    expect(left).toBeUndefined();
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, extra.id)));
  });

  it("default-deny: no context sees no messages", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", (tx) =>
      tx.select().from(schema.siteEnquiries),
    );
    expect(seen).toHaveLength(0);
  });
});

/**
 * `site_page_views` RLS — one row per page per day, counters only.
 *
 * Members read; MEMBERS insert and update, because the public beacon
 * upserts as `staff` inside the tenant it resolved (ADR 0022); nobody
 * deletes. An accountant cannot write; another tenant sees nothing; a row
 * on another tenant's site is unrepresentable; rows go with their site.
 */
d("site_page_views (RLS)", () => {
  const STAMP = `iso-views-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let siteA: string;
  let siteB: string;
  let rowA: string;
  let rowB: string;

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asExpert = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "expert", userId: MATE });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Views A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Views B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;
      const sites = await tx
        .insert(schema.sites)
        .values([
          { tenantId: tenantA, slug: `${STAMP}-a` },
          { tenantId: tenantB, slug: `${STAMP}-b` },
        ])
        .returning();
      siteA = sites[0].id;
      siteB = sites[1].id;
      const rows = await tx
        .insert(schema.sitePageViews)
        .values([
          { tenantId: tenantA, siteId: siteA, day: "2026-09-04", path: "/", views: 3, visitors: 1 },
          { tenantId: tenantB, siteId: siteB, day: "2026-09-04", path: "/", views: 5, visitors: 2 },
        ])
        .returning();
      rowA = rows[0].id;
      rowB = rows[1].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("staff read their own counts and nothing of the other tenant's", async () => {
    const seen = await asStaff((tx) => tx.select().from(schema.sitePageViews));
    expect(seen.map((r) => r.id)).toEqual([rowA]);
    expect(seen.some((r) => r.id === rowB)).toBe(false);
  });

  it("staff upsert a day's row (the beacon's role); an accountant cannot; nobody deletes", async () => {
    const upsert = (visitors: number) =>
      asStaff((tx) =>
        tx
          .insert(schema.sitePageViews)
          .values({ tenantId: tenantA, siteId: siteA, day: "2026-09-04", path: "/", views: 1, visitors })
          .onConflictDoUpdate({
            target: [schema.sitePageViews.siteId, schema.sitePageViews.day, schema.sitePageViews.path],
            set: { views: sql`${schema.sitePageViews.views} + 1`, visitors: sql`${schema.sitePageViews.visitors} + ${visitors}` },
          })
          .returning(),
      );
    const [after] = await upsert(1);
    expect(after.id).toBe(rowA);
    expect(after.views).toBe(4);
    expect(after.visitors).toBe(2);
    const [again] = await upsert(0);
    expect(again.views).toBe(5);
    expect(again.visitors).toBe(2);
    await expect(
      asExpert((tx) => tx.insert(schema.sitePageViews).values({ tenantId: tenantA, siteId: siteA, day: "2026-09-05", path: "/" })),
    ).rejects.toThrow();
    const byOwner = await asOwner((tx) =>
      tx.delete(schema.sitePageViews).where(eq(schema.sitePageViews.id, rowA)).returning(),
    );
    expect(byOwner).toHaveLength(0);
  });

  it("another tenant cannot read or update tenant A's counts", async () => {
    const seen = await asOtherTenant((tx) => tx.select().from(schema.sitePageViews));
    expect(seen.map((r) => r.id)).toEqual([rowB]);
    const updated = await asOtherTenant((tx) =>
      tx.update(schema.sitePageViews).set({ views: 0 }).where(eq(schema.sitePageViews.id, rowA)).returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("a row on another tenant's site is unrepresentable, and a negative count is refused", async () => {
    await expect(
      withSystem((tx) => tx.insert(schema.sitePageViews).values({ tenantId: tenantB, siteId: siteA, day: "2026-09-04", path: "/x" })),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) => tx.insert(schema.sitePageViews).values({ tenantId: tenantA, siteId: siteA, day: "2026-09-06", path: "/", views: -1 })),
    ).rejects.toThrow();
  });

  it("counts go with their site", async () => {
    const [extra] = await withSystem((tx) =>
      tx.insert(schema.tenants).values({ clerkOrgId: `${STAMP}-c`, name: "Views C", slug: `${STAMP}-c` }).returning(),
    );
    const [site] = await withSystem((tx) =>
      tx.insert(schema.sites).values({ tenantId: extra.id, slug: `${STAMP}-c` }).returning(),
    );
    const [row] = await withSystem((tx) =>
      tx.insert(schema.sitePageViews).values({ tenantId: extra.id, siteId: site.id, day: "2026-09-04", path: "/" }).returning(),
    );
    await withSystem((tx) => tx.delete(schema.sites).where(eq(schema.sites.id, site.id)));
    const left = await withSystem((tx) =>
      tx.query.sitePageViews.findFirst({ where: eq(schema.sitePageViews.id, row.id) }),
    );
    expect(left).toBeUndefined();
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, extra.id)));
  });

  it("default-deny: no context sees no counts", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", (tx) =>
      tx.select().from(schema.sitePageViews),
    );
    expect(seen).toHaveLength(0);
  });
});

/**
 * `site_images` RLS — the site's photo library.
 *
 * Members read; owners insert and delete; nobody updates; another tenant
 * sees nothing; a photo on another tenant's site is unrepresentable; one
 * blob is one row; photos go with their site.
 */
d("site_images (RLS)", () => {
  const STAMP = `iso-img-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let siteA: string;
  let siteB: string;
  let imageA: string;
  let imageB: string;

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });
  const photo = (tenantId: string, siteId: string, name: string) => ({
    tenantId,
    siteId,
    pathname: `sites/${tenantId}/photos/${STAMP}-${name}.jpg`,
    mimeType: "image/jpeg",
    width: 1600,
    height: 1067,
    bytes: 245_000,
  });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Img A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Img B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;
      const sites = await tx
        .insert(schema.sites)
        .values([
          { tenantId: tenantA, slug: `${STAMP}-a` },
          { tenantId: tenantB, slug: `${STAMP}-b` },
        ])
        .returning();
      siteA = sites[0].id;
      siteB = sites[1].id;
      const rows = await tx
        .insert(schema.siteImages)
        .values([photo(tenantA, siteA, "barn"), photo(tenantB, siteB, "field")])
        .returning();
      imageA = rows[0].id;
      imageB = rows[1].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("staff read their own photos and nothing of the other tenant's", async () => {
    const seen = await asStaff((tx) => tx.select().from(schema.siteImages));
    expect(seen.map((r) => r.id)).toEqual([imageA]);
    expect(seen.some((r) => r.id === imageB)).toBe(false);
  });

  it("staff cannot add, change or remove a photo; an owner adds and removes, nobody changes", async () => {
    await expect(
      asStaff((tx) => tx.insert(schema.siteImages).values(photo(tenantA, siteA, "staff"))),
    ).rejects.toThrow();
    const byStaff = await asStaff((tx) =>
      tx.delete(schema.siteImages).where(eq(schema.siteImages.id, imageA)).returning(),
    );
    expect(byStaff).toHaveLength(0);
    const [added] = await asOwner((tx) =>
      tx.insert(schema.siteImages).values(photo(tenantA, siteA, "owner")).returning(),
    );
    expect(added.width).toBe(1600);
    const changed = await asOwner((tx) =>
      tx.update(schema.siteImages).set({ width: 1 }).where(eq(schema.siteImages.id, added.id)).returning(),
    );
    expect(changed).toHaveLength(0);
    const gone = await asOwner((tx) =>
      tx.delete(schema.siteImages).where(eq(schema.siteImages.id, added.id)).returning(),
    );
    expect(gone).toHaveLength(1);
  });

  it("another tenant cannot read or delete tenant A's photos", async () => {
    const seen = await asOtherTenant((tx) => tx.select().from(schema.siteImages));
    expect(seen.map((r) => r.id)).toEqual([imageB]);
    const deleted = await asOtherTenant((tx) =>
      tx.delete(schema.siteImages).where(eq(schema.siteImages.id, imageA)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("a photo on another tenant's site is unrepresentable, one blob is one row, and the CHECKs hold", async () => {
    await expect(
      withSystem((tx) => tx.insert(schema.siteImages).values(photo(tenantB, siteA, "cross"))),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) => tx.insert(schema.siteImages).values(photo(tenantA, siteA, "barn"))),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) => tx.insert(schema.siteImages).values({ ...photo(tenantA, siteA, "svg"), mimeType: "image/svg+xml" })),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) => tx.insert(schema.siteImages).values({ ...photo(tenantA, siteA, "flat"), height: 0 })),
    ).rejects.toThrow();
  });

  it("photos go with their site", async () => {
    const [extra] = await withSystem((tx) =>
      tx.insert(schema.tenants).values({ clerkOrgId: `${STAMP}-c`, name: "Img C", slug: `${STAMP}-c` }).returning(),
    );
    const [site] = await withSystem((tx) =>
      tx.insert(schema.sites).values({ tenantId: extra.id, slug: `${STAMP}-c` }).returning(),
    );
    const [row] = await withSystem((tx) =>
      tx.insert(schema.siteImages).values(photo(extra.id, site.id, "c")).returning(),
    );
    await withSystem((tx) => tx.delete(schema.sites).where(eq(schema.sites.id, site.id)));
    const left = await withSystem((tx) =>
      tx.query.siteImages.findFirst({ where: eq(schema.siteImages.id, row.id) }),
    );
    expect(left).toBeUndefined();
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, extra.id)));
  });

  it("default-deny: no context sees no photos", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", (tx) =>
      tx.select().from(schema.siteImages),
    );
    expect(seen).toHaveLength(0);
  });
});
