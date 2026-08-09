import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * Work RLS. The property under test is that a LIST is the unit of sharing and
 * items inherit from it — so most of these assert what somebody CANNOT see,
 * which is the only direction worth certifying.
 *
 * Fixtures are built under `withSystem` on purpose: this suite certifies what
 * the DATABASE enforces, and routing setup through the module's own helpers
 * would let a bug in them make these tests agree with it.
 */
d("work tables (RLS)", () => {
  const STAMP = `iso-work-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`; // staff in tenant A
  const EXPERT = `${STAMP}-expert`; // expert in tenant A
  const OTHER = `${STAMP}-other`; // owner of tenant B

  let tenantA: string;
  let tenantB: string;
  let teamList: string; // visibility 'members'
  let ownersList: string; // visibility 'owners'
  let teamItem: string;
  let ownersItem: string;

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asExpert = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "expert", userId: EXPERT });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Work A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Work B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const profiles = await tx
        .insert(schema.profiles)
        .values([
          { clerkUserId: OWNER, email: `${OWNER}@example.test` },
          { clerkUserId: MATE, email: `${MATE}@example.test` },
          { clerkUserId: EXPERT, email: `${EXPERT}@example.test` },
          { clerkUserId: OTHER, email: `${OTHER}@example.test` },
        ])
        .returning();
      await tx.insert(schema.memberships).values([
        { tenantId: tenantA, profileId: profiles[0].id, role: "owner" },
        { tenantId: tenantA, profileId: profiles[1].id, role: "staff" },
        { tenantId: tenantA, profileId: profiles[2].id, role: "expert" },
        { tenantId: tenantB, profileId: profiles[3].id, role: "owner" },
      ]);

      const lists = await tx
        .insert(schema.workLists)
        .values([
          { tenantId: tenantA, name: "Work", isDefault: true },
          { tenantId: tenantA, name: "Confidential", visibility: "owners" },
        ])
        .returning();
      teamList = lists[0].id;
      ownersList = lists[1].id;

      const items = await tx
        .insert(schema.workItems)
        .values([
          { tenantId: tenantA, listId: teamList, title: "Everyone's job" },
          { tenantId: tenantA, listId: ownersList, title: "Owners' eyes" },
        ])
        .returning();
      teamItem = items[0].id;
      ownersItem = items[1].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.profiles)
        .where(sql`${schema.profiles.clerkUserId} like ${`${STAMP}%`}`);
    });
  });

  it("another tenant sees none of it", async () => {
    const lists = await asOtherTenant((tx) =>
      tx.select().from(schema.workLists),
    );
    expect(lists).toHaveLength(0);

    const items = await asOtherTenant((tx) =>
      tx.select().from(schema.workItems),
    );
    expect(items).toHaveLength(0);
  });

  it("another tenant cannot write into this one", async () => {
    await expect(
      asOtherTenant((tx) =>
        tx
          .insert(schema.workLists)
          .values({ tenantId: tenantA, name: "Smuggled" }),
      ),
    ).rejects.toThrow();

    await expect(
      asOtherTenant((tx) =>
        tx
          .insert(schema.workItems)
          .values({ tenantId: tenantA, listId: teamList, title: "Smuggled" }),
      ),
    ).rejects.toThrow();
  });

  it("another tenant cannot update or delete this one's work", async () => {
    const updated = await asOtherTenant((tx) =>
      tx
        .update(schema.workItems)
        .set({ title: "Vandalised" })
        .where(eq(schema.workItems.id, teamItem))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await asOtherTenant((tx) =>
      tx
        .delete(schema.workItems)
        .where(eq(schema.workItems.id, teamItem))
        .returning(),
    );
    expect(deleted).toHaveLength(0);

    // Still there, and still called what it was called.
    const [survivor] = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.id, teamItem)),
    );
    expect(survivor?.title).toBe("Everyone's job");
  });

  it("an owners-only list is invisible to staff — AND SO IS ITS WORK", async () => {
    // The property this slice exists to certify: `work_items` states no
    // visibility rule of its own, and inherits one it never mentions.
    const lists = await asStaff((tx) => tx.select().from(schema.workLists));
    expect(lists.map((r) => r.name)).toEqual(["Work"]);

    const items = await asStaff((tx) => tx.select().from(schema.workItems));
    expect(items.map((r) => r.id)).toEqual([teamItem]);
    expect(items.map((r) => r.id)).not.toContain(ownersItem);
  });

  it("an owner sees both lists and both items", async () => {
    const lists = await asOwner((tx) => tx.select().from(schema.workLists));
    expect(lists.map((r) => r.name).sort()).toEqual(["Confidential", "Work"]);

    const items = await asOwner((tx) => tx.select().from(schema.workItems));
    expect(items.map((r) => r.id).sort()).toEqual([teamItem, ownersItem].sort());
  });

  it("an expert is not an owner", async () => {
    // Same answer Documents gives for an owners-only folder, and deliberately
    // so: an outside accountant is a member, not a principal.
    const lists = await asExpert((tx) => tx.select().from(schema.workLists));
    expect(lists.map((r) => r.name)).toEqual(["Work"]);

    const items = await asExpert((tx) => tx.select().from(schema.workItems));
    expect(items.map((r) => r.id)).not.toContain(ownersItem);
  });

  it("staff cannot create an owners-only list", async () => {
    await expect(
      asStaff((tx) =>
        tx
          .insert(schema.workLists)
          .values({ tenantId: tenantA, name: "Mine", visibility: "owners" }),
      ),
    ).rejects.toThrow();
  });

  it("staff cannot flip a list they can see to owners-only", async () => {
    // WITH CHECK repeats USING for exactly this: the row is readable now and
    // would not be after, so the write is refused rather than losing it.
    await expect(
      asStaff((tx) =>
        tx
          .update(schema.workLists)
          .set({ visibility: "owners" })
          .where(eq(schema.workLists.id, teamList)),
      ),
    ).rejects.toThrow();
  });

  it("staff cannot smuggle work onto a list they cannot see", async () => {
    await expect(
      asStaff((tx) =>
        tx.insert(schema.workItems).values({
          tenantId: tenantA,
          listId: ownersList,
          title: "Sneaking in",
        }),
      ),
    ).rejects.toThrow();
  });

  it("staff cannot MOVE work onto a list they cannot see", async () => {
    await expect(
      asStaff((tx) =>
        tx
          .update(schema.workItems)
          .set({ listId: ownersList })
          .where(eq(schema.workItems.id, teamItem)),
      ),
    ).rejects.toThrow();
  });

  it("an owner may move work into the owners-only list, and staff lose sight of it", async () => {
    await asOwner((tx) =>
      tx
        .update(schema.workItems)
        .set({ listId: ownersList })
        .where(eq(schema.workItems.id, teamItem)),
    );
    const staffSees = await asStaff((tx) =>
      tx.select().from(schema.workItems),
    );
    expect(staffSees).toHaveLength(0);

    // Put it back so the ordering of these tests does not matter to the next.
    await asOwner((tx) =>
      tx
        .update(schema.workItems)
        .set({ listId: teamList })
        .where(eq(schema.workItems.id, teamItem)),
    );
  });

  it("the default list is one per tenant, and each tenant gets its own", async () => {
    await withSystem(async (tx) => {
      await tx
        .insert(schema.workLists)
        .values({ tenantId: tenantB, name: "Work", isDefault: true });
    });
    const defaults = await withSystem((tx) =>
      tx
        .select()
        .from(schema.workLists)
        .where(
          and(
            sql`${schema.workLists.isDefault}`,
            sql`${schema.workLists.tenantId} in (${tenantA}, ${tenantB})`,
          ),
        ),
    );
    expect(defaults).toHaveLength(2);

    // And a second default for the SAME tenant is refused by the partial index,
    // which is what makes `ensureDefaultWorkList` idempotent without restating
    // its predicate.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.workLists)
          .values({ tenantId: tenantA, name: "Second", isDefault: true }),
      ),
    ).rejects.toThrow();
  });
});
