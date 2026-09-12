import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `social_channels` RLS — the accounts a brand posts to (slice S0, ADR 0047).
 *
 * Members read; OWNERS insert, update and delete; nobody sees another
 * tenant's. UPDATE is proven here as well as INSERT and DELETE, which is what
 * separates this table's posture from `site_images` — a channel is edited, a
 * photo never is.
 *
 * **TENANT A DELIBERATELY HOLDS TWO WEBSITES AND A BUSINESS-LEVEL CHANNEL.**
 * A one-site fixture cannot tell a row hung off the tenant from one hung off
 * the site, which is the entire question ADR 0047 answers — the same reason
 * `brand.test.ts` insists on two companies. The nullable composite FK is the
 * other half: it must refuse a channel naming ANOTHER tenant's site even under
 * `withSystem`, where RLS is not watching, while letting a null through.
 */
d("social_channels (RLS)", () => {
  const STAMP = `iso-social-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let siteA1: string;
  let siteA2: string;
  let siteB: string;
  let channelA1: string;
  let channelA2: string;
  let businessChannelA: string;
  let channelB: string;

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
          { clerkOrgId: `${STAMP}-a`, name: "Social A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Social B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;
      const sites = await tx
        .insert(schema.sites)
        .values([
          { tenantId: tenantA, slug: `${STAMP}-a1`, title: "Hilltop Farm" },
          { tenantId: tenantA, slug: `${STAMP}-a2`, title: "Hilltop Store" },
          { tenantId: tenantB, slug: `${STAMP}-b1`, title: "B Farm" },
        ])
        .returning();
      siteA1 = sites[0].id;
      siteA2 = sites[1].id;
      siteB = sites[2].id;
      const channels = await tx
        .insert(schema.socialChannels)
        .values([
          { tenantId: tenantA, siteId: siteA1, network: "facebook", handle: "hilltopfarm" },
          { tenantId: tenantA, siteId: siteA2, network: "instagram", handle: "hilltopstore" },
          // The business's own: no site at all, which is the case the
          // nullable FK and the null-safe reads exist for.
          { tenantId: tenantA, siteId: null, network: "linkedin", handle: "hilltop" },
          { tenantId: tenantB, siteId: siteB, network: "facebook", handle: "bfarm" },
        ])
        .returning();
      channelA1 = channels[0].id;
      channelA2 = channels[1].id;
      businessChannelA = channels[2].id;
      channelB = channels[3].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // Channels and sites cascade from the tenant.
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("staff read their own tenant's channels — both sites' and the business's — and nothing of the other's", async () => {
    const seen = await asStaff((tx) => tx.select().from(schema.socialChannels));
    expect(seen.map((c) => c.id).sort()).toEqual(
      [channelA1, channelA2, businessChannelA].sort(),
    );
    expect(seen.some((c) => c.id === channelB)).toBe(false);
    expect(seen.some((c) => c.tenantId !== tenantA)).toBe(false);
  });

  it("staff cannot insert, update or delete a channel — the policy is owner-only", async () => {
    await expect(
      asStaff((tx) =>
        tx
          .insert(schema.socialChannels)
          .values({ tenantId: tenantA, siteId: siteA1, network: "x", handle: "forged" }),
      ),
    ).rejects.toThrow();
    const updated = await asStaff((tx) =>
      tx
        .update(schema.socialChannels)
        .set({ handle: "forged" })
        .where(eq(schema.socialChannels.id, channelA1))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asStaff((tx) =>
      tx.delete(schema.socialChannels).where(eq(schema.socialChannels.id, channelA2)).returning(),
    );
    expect(deleted).toHaveLength(0);
    const still = await withSystem((tx) =>
      tx.query.socialChannels.findFirst({ where: eq(schema.socialChannels.id, channelA1) }),
    );
    expect(still?.handle).toBe("hilltopfarm");
  });

  it("an owner inserts, edits and removes their own tenant's channels", async () => {
    const [created] = await asOwner((tx) =>
      tx
        .insert(schema.socialChannels)
        .values({
          tenantId: tenantA,
          siteId: siteA1,
          network: "tiktok",
          handle: "hilltopvideo",
          audience: "Anyone who has never seen a calf",
        })
        .returning(),
    );
    expect(created.siteId).toBe(siteA1);
    const updated = await asOwner((tx) =>
      tx
        .update(schema.socialChannels)
        .set({ voice: "Short, plain, no exclamation marks" })
        .where(eq(schema.socialChannels.id, created.id))
        .returning(),
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].voice).toBe("Short, plain, no exclamation marks");
    const removed = await asOwner((tx) =>
      tx.delete(schema.socialChannels).where(eq(schema.socialChannels.id, created.id)).returning(),
    );
    expect(removed).toHaveLength(1);
  });

  it("another tenant's owner cannot read, update or delete tenant A's channels", async () => {
    const seen = await asOtherTenant((tx) => tx.select().from(schema.socialChannels));
    expect(seen.map((c) => c.id)).toEqual([channelB]);
    const updated = await asOtherTenant((tx) =>
      tx
        .update(schema.socialChannels)
        .set({ handle: "takenover" })
        .where(eq(schema.socialChannels.id, channelA1))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asOtherTenant((tx) =>
      tx.delete(schema.socialChannels).where(eq(schema.socialChannels.id, channelA1)).returning(),
    );
    expect(deleted).toHaveLength(0);
    // And cannot write into A's namespace under their own context either.
    await expect(
      asOtherTenant((tx) =>
        tx
          .insert(schema.socialChannels)
          .values({ tenantId: tenantA, siteId: siteA1, network: "x", handle: "smuggled" }),
      ),
    ).rejects.toThrow();
  });

  it("a channel naming another tenant's site is unrepresentable, even under withSystem", async () => {
    // The composite FK is (tenant_id, site_id) → (sites.tenant_id, sites.id),
    // so tenant A's row cannot claim tenant B's site however it is written.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.socialChannels)
          .values({ tenantId: tenantA, siteId: siteB, network: "pinterest", handle: "crossed" }),
      ),
    ).rejects.toThrow();
  });

  it("a business-level channel has no site and is refused by nothing", async () => {
    // MATCH SIMPLE: a composite FK with any column null is not checked at all,
    // which is exactly what a channel belonging to the business needs.
    const [created] = await withSystem((tx) =>
      tx
        .insert(schema.socialChannels)
        .values({ tenantId: tenantA, siteId: null, network: "pinterest", handle: "hilltoppins" })
        .returning(),
    );
    expect(created.siteId).toBeNull();
    const businessOnes = await asStaff((tx) =>
      tx.select().from(schema.socialChannels).where(isNull(schema.socialChannels.siteId)),
    );
    expect(businessOnes.map((c) => c.id).sort()).toEqual([businessChannelA, created.id].sort());
    await withSystem((tx) =>
      tx.delete(schema.socialChannels).where(eq(schema.socialChannels.id, created.id)),
    );
  });

  it("one account is one row across the workspace, whichever brand claims it", async () => {
    // The rule ADR 0047 states — the same Facebook page cannot be filed under
    // two brands — made mechanical by the unique index rather than remembered.
    await expect(
      asOwner((tx) =>
        tx
          .insert(schema.socialChannels)
          .values({ tenantId: tenantA, siteId: siteA2, network: "facebook", handle: "hilltopfarm" }),
      ),
    ).rejects.toThrow();
    // The SAME handle on a DIFFERENT network is a different account and is fine.
    const [created] = await asOwner((tx) =>
      tx
        .insert(schema.socialChannels)
        .values({ tenantId: tenantA, siteId: siteA2, network: "pinterest", handle: "hilltopfarm" })
        .returning(),
    );
    expect(created.id).toBeTruthy();
    await asOwner((tx) =>
      tx.delete(schema.socialChannels).where(eq(schema.socialChannels.id, created.id)),
    );
    // And another TENANT may hold the same handle: the index is per workspace.
    const [elsewhere] = await asOtherTenant((tx) =>
      tx
        .insert(schema.socialChannels)
        .values({ tenantId: tenantB, siteId: siteB, network: "facebook", handle: "hilltopfarm" })
        .returning(),
    );
    expect(elsewhere.tenantId).toBe(tenantB);
    await asOtherTenant((tx) =>
      tx.delete(schema.socialChannels).where(eq(schema.socialChannels.id, elsewhere.id)),
    );
  });

  it("the checks refuse a nameless `other`, an unknown network and an over-long note", async () => {
    // `other` is the one network with no name of its own, so it must bring a
    // label — otherwise the list would draw a row that says nothing.
    await expect(
      asOwner((tx) =>
        tx
          .insert(schema.socialChannels)
          .values({ tenantId: tenantA, siteId: siteA1, network: "other", handle: "somewhere" }),
      ),
    ).rejects.toThrow();
    const [named] = await asOwner((tx) =>
      tx
        .insert(schema.socialChannels)
        .values({
          tenantId: tenantA,
          siteId: siteA1,
          network: "other",
          handle: "somewhere",
          label: "Our Substack",
        })
        .returning(),
    );
    expect(named.label).toBe("Our Substack");
    await asOwner((tx) =>
      tx.delete(schema.socialChannels).where(eq(schema.socialChannels.id, named.id)),
    );
    await expect(
      asOwner((tx) =>
        tx
          .insert(schema.socialChannels)
          .values({ tenantId: tenantA, siteId: siteA1, network: "myspace", handle: "retro" }),
      ),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) =>
        tx.insert(schema.socialChannels).values({
          tenantId: tenantA,
          siteId: siteA1,
          network: "youtube",
          handle: "hilltoptube",
          voice: "x".repeat(401),
        }),
      ),
    ).rejects.toThrow();
  });

  it("a channel dies with the website it belongs to, and the business's own survives", async () => {
    const [site] = await withSystem((tx) =>
      tx
        .insert(schema.sites)
        .values({ tenantId: tenantA, slug: `${STAMP}-tmp`, title: "Temporary" })
        .returning(),
    );
    const [doomed] = await withSystem((tx) =>
      tx
        .insert(schema.socialChannels)
        .values({ tenantId: tenantA, siteId: site.id, network: "x", handle: "temporary" })
        .returning(),
    );
    await withSystem((tx) => tx.delete(schema.sites).where(eq(schema.sites.id, site.id)));
    const gone = await withSystem((tx) =>
      tx.query.socialChannels.findFirst({ where: eq(schema.socialChannels.id, doomed.id) }),
    );
    expect(gone).toBeUndefined();
    const survivor = await withSystem((tx) =>
      tx.query.socialChannels.findFirst({
        where: eq(schema.socialChannels.id, businessChannelA),
      }),
    );
    expect(survivor?.id).toBe(businessChannelA);
  });
});
