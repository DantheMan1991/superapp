import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * Scheduling RLS. The property under test is that a calendar is the unit of
 * sharing and everything else inherits from it — so most of these assert what
 * somebody CANNOT see, which is the only direction worth certifying.
 *
 * Fixtures are built under `withSystem` on purpose: this suite certifies what
 * the DATABASE enforces, and routing setup through the module's own helpers
 * would let a bug in them make these tests agree with it.
 */
d("scheduling tables (RLS)", () => {
  const STAMP = `iso-sched-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let ownerCal: string; // OWNER's primary, never shared
  let sharedCal: string; // OWNER's, shared with MATE at a level per test
  let teamCal: string; // business-owned, shared with everyone
  let ownerItem: string;
  let sharedItem: string;
  let privateItem: string;
  let inviteItem: string; // on ownerCal, MATE attends

  const FROM = new Date("2026-09-01T00:00:00Z");
  const TO = new Date("2026-09-30T00:00:00Z");

  interface ProjectedRow {
    id: string;
    title: string | null;
    location: string | null;
    access: string;
  }

  async function seedItem(
    tx: Tx,
    calendarId: string,
    title: string,
    sensitivity: "normal" | "private" = "normal",
  ): Promise<string> {
    const [row] = await tx
      .insert(schema.scheduleItems)
      .values({
        tenantId: tenantA,
        calendarId,
        title,
        description: `${title} body`,
        location: `${title} place`,
        startsAt: new Date("2026-09-10T14:00:00Z"),
        endsAt: new Date("2026-09-10T15:00:00Z"),
        timeZone: "America/New_York",
        sensitivity,
      })
      .returning();
    return row.id;
  }

  const asMate = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });

  /** Re-point MATE's grant on `Projects` at one level, or remove it. */
  async function shareProjectsAt(
    access: "busy" | "titles" | "details" | "write" | null,
  ) {
    await withSystem(async (tx) => {
      await tx
        .delete(schema.scheduleShares)
        .where(
          and(
            eq(schema.scheduleShares.calendarId, sharedCal),
            eq(schema.scheduleShares.granteeClerkUserId, MATE),
          ),
        );
      if (access) {
        await tx.insert(schema.scheduleShares).values({
          tenantId: tenantA,
          calendarId: sharedCal,
          granteeClerkUserId: MATE,
          access,
          grantedByClerkUserId: OWNER,
        });
      }
    });
  }

  async function projectedAsMate(): Promise<ProjectedRow[]> {
    const result = await asMate((tx) =>
      tx.execute(sql`select * from app_schedule_range(${FROM}, ${TO})`),
    );
    return (result as unknown as { rows: ProjectedRow[] }).rows;
  }

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Sched A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Sched B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const profiles = await tx
        .insert(schema.profiles)
        .values([
          { clerkUserId: OWNER, email: `${OWNER}@example.test` },
          { clerkUserId: MATE, email: `${MATE}@example.test` },
          { clerkUserId: OTHER, email: `${OTHER}@example.test` },
        ])
        .returning();
      await tx.insert(schema.memberships).values([
        { tenantId: tenantA, profileId: profiles[0].id, role: "owner" },
        { tenantId: tenantA, profileId: profiles[1].id, role: "staff" },
        { tenantId: tenantB, profileId: profiles[2].id, role: "owner" },
      ]);

      const cals = await tx
        .insert(schema.scheduleCalendars)
        .values([
          {
            tenantId: tenantA,
            ownerClerkUserId: OWNER,
            name: "Calendar",
            kind: "personal",
            isPrimary: true,
          },
          { tenantId: tenantA, ownerClerkUserId: OWNER, name: "Projects" },
          {
            tenantId: tenantA,
            ownerClerkUserId: null,
            name: "Team",
            extensionSlug: "test-pack",
            extensionKey: "team",
          },
        ])
        .returning();
      ownerCal = cals[0].id;
      sharedCal = cals[1].id;
      teamCal = cals[2].id;

      // How a pack publishes a business-wide calendar: one share row with the
      // sentinel grantee, carrying a level like any other grant.
      await tx.insert(schema.scheduleShares).values({
        tenantId: tenantA,
        calendarId: teamCal,
        granteeClerkUserId: "",
        access: "details",
        grantedByClerkUserId: OWNER,
      });

      ownerItem = await seedItem(tx, ownerCal, "Owner only");
      sharedItem = await seedItem(tx, sharedCal, "Shared thing");
      privateItem = await seedItem(tx, sharedCal, "Confidential", "private");
      inviteItem = await seedItem(tx, ownerCal, "You are invited");

      await tx.insert(schema.scheduleItemAttendees).values({
        tenantId: tenantA,
        itemId: inviteItem,
        clerkUserId: MATE,
      });
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
    const cals = await withTenant(
      tenantB,
      (tx) => tx.select().from(schema.scheduleCalendars),
      { role: "owner", userId: OTHER },
    );
    expect(cals).toHaveLength(0);

    const items = await withTenant(
      tenantB,
      (tx) => tx.select().from(schema.scheduleItems),
      { role: "owner", userId: OTHER },
    );
    expect(items).toHaveLength(0);
  });

  it("a calendar is PRIVATE by default — a colleague sees only the shared one", async () => {
    await shareProjectsAt(null);
    const rows = await asMate((tx) =>
      tx.select().from(schema.scheduleCalendars),
    );
    expect(rows.map((r) => r.name).sort()).toEqual(["Team"]);
  });

  it("a tenant OWNER gets no override on somebody else's calendar", async () => {
    // Departs from CRM deliberately and follows mail (0043): a calendar is
    // correspondence-shaped, so being the boss is not a way in.
    await withSystem((tx) =>
      tx.insert(schema.scheduleCalendars).values({
        tenantId: tenantA,
        ownerClerkUserId: MATE,
        name: "Mate private",
      }),
    );
    const seen = await asOwner((tx) =>
      tx.select().from(schema.scheduleCalendars),
    );
    expect(seen.map((r) => r.name)).not.toContain("Mate private");
  });

  it("`details` shows the item row; `busy` and `titles` hide it entirely", async () => {
    await shareProjectsAt("details");
    const visible = await asMate((tx) =>
      tx.select().from(schema.scheduleItems),
    );
    expect(visible.map((r) => r.id)).toContain(sharedItem);

    for (const level of ["busy", "titles"] as const) {
      await shareProjectsAt(level);
      const rows = await asMate((tx) =>
        tx.select().from(schema.scheduleItems),
      );
      expect(rows.map((r) => r.id)).not.toContain(sharedItem);
    }
  });

  it("the projection gives times at `busy` and adds the title at `titles`", async () => {
    await shareProjectsAt("busy");
    const busy = (await projectedAsMate()).find((r) => r.id === sharedItem);
    expect(busy).toBeDefined();
    expect(busy?.title).toBeNull();
    expect(busy?.location).toBeNull();

    await shareProjectsAt("titles");
    const titled = (await projectedAsMate()).find((r) => r.id === sharedItem);
    expect(titled?.title).toBe("Shared thing");
    expect(titled?.location).toBe("Shared thing place");
  });

  it("the projection stops at `details` so nothing is returned twice", async () => {
    await shareProjectsAt("details");
    const rows = await projectedAsMate();
    expect(rows.map((r) => r.id)).not.toContain(sharedItem);
  });

  it("a PRIVATE item stays hidden from somebody with full details access", async () => {
    await shareProjectsAt("details");
    const rows = await asMate((tx) => tx.select().from(schema.scheduleItems));
    expect(rows.map((r) => r.id)).toContain(sharedItem);
    expect(rows.map((r) => r.id)).not.toContain(privateItem);
  });

  it("an ATTENDEE sees the item without seeing its calendar", async () => {
    await shareProjectsAt(null);
    const items = await asMate((tx) => tx.select().from(schema.scheduleItems));
    expect(items.map((r) => r.id)).toContain(inviteItem);
    // …and still not the owner's other item on that same calendar.
    expect(items.map((r) => r.id)).not.toContain(ownerItem);

    const cals = await asMate((tx) =>
      tx.select().from(schema.scheduleCalendars),
    );
    expect(cals.map((r) => r.id)).not.toContain(ownerCal);
  });

  it("a grantee cannot re-grant, and cannot DELETE a grant either", async () => {
    await shareProjectsAt("write");

    // WITH CHECK is not consulted for DELETE (0067, 0077). This is the
    // assertion that keeps the USING clause honest.
    const deleted = await asMate((tx) =>
      tx.delete(schema.scheduleShares).returning(),
    );
    expect(deleted).toHaveLength(0);

    await expect(
      asMate((tx) =>
        tx
          .insert(schema.scheduleShares)
          .values({
            tenantId: tenantA,
            calendarId: sharedCal,
            granteeClerkUserId: OTHER,
            access: "write",
          })
          .returning(),
      ),
    ).rejects.toThrow();
  });

  it("`write` may edit an item and `details` may not", async () => {
    await shareProjectsAt("write");
    const ok = await asMate((tx) =>
      tx
        .update(schema.scheduleItems)
        .set({ title: "Edited by mate" })
        .where(eq(schema.scheduleItems.id, sharedItem))
        .returning(),
    );
    expect(ok).toHaveLength(1);

    await shareProjectsAt("details");
    const denied = await asMate((tx) =>
      tx
        .update(schema.scheduleItems)
        .set({ title: "Should not stick" })
        .where(eq(schema.scheduleItems.id, sharedItem))
        .returning(),
    );
    expect(denied).toHaveLength(0);
  });

  it("the HIGHEST of a personal and a workspace-wide grant wins", async () => {
    // The Team calendar is already shared with everyone at `details`. Add a
    // personal grant BELOW that and the person must not be demoted by it —
    // app_calendar_access orders the levels and takes the top one.
    await withSystem((tx) =>
      tx.insert(schema.scheduleShares).values({
        tenantId: tenantA,
        calendarId: teamCal,
        granteeClerkUserId: MATE,
        access: "busy",
        grantedByClerkUserId: OWNER,
      }),
    );
    const teamItem = await withSystem((tx) =>
      seedItem(tx, teamCal, "Team thing"),
    );

    const rows = await asMate((tx) => tx.select().from(schema.scheduleItems));
    expect(rows.map((r) => r.id)).toContain(teamItem);

    await withSystem((tx) =>
      tx
        .delete(schema.scheduleShares)
        .where(
          and(
            eq(schema.scheduleShares.calendarId, teamCal),
            eq(schema.scheduleShares.granteeClerkUserId, MATE),
          ),
        ),
    );
  });

  it("forgetting the user id denies rather than widens", async () => {
    await shareProjectsAt("details");
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.scheduleCalendars),
      { role: "owner" },
    );
    // Only the workspace-wide one survives; nothing personal does.
    expect(rows.map((r) => r.name).sort()).toEqual(["Team"]);
  });

  it("a foreign tenant context sees nothing (FORCE row level security)", async () => {
    const rows = await withTenant(
      "00000000-0000-0000-0000-000000000000",
      (tx) => tx.select().from(schema.scheduleItems),
      { role: "staff", userId: MATE },
    );
    expect(rows).toHaveLength(0);
  });

  /* -- Links (0098/0099) --------------------------------------------------- */

  /** Attach a record to an item as OWNER, returning the link id. */
  async function attachAs(itemId: string, entityId: string) {
    const [row] = await withSystem((tx) =>
      tx
        .insert(schema.scheduleItemLinks)
        .values({
          tenantId: tenantA,
          itemId,
          extensionSlug: "accounting",
          entityType: "invoice",
          entityId,
        })
        .returning(),
    );
    return row.id;
  }

  it("a link INHERITS the item's visibility and never restates it", async () => {
    await shareProjectsAt(null);
    const linkId = await attachAs(
      sharedItem,
      "11111111-1111-4111-8111-111111111111",
    );

    // Not shared: the item is invisible, so its links are too.
    let seen = await asMate((tx) => tx.select().from(schema.scheduleItemLinks));
    expect(seen.map((r) => r.id)).not.toContain(linkId);

    // Shared at details: the item appears, and the link with it.
    await shareProjectsAt("details");
    seen = await asMate((tx) => tx.select().from(schema.scheduleItemLinks));
    expect(seen.map((r) => r.id)).toContain(linkId);

    // Shared at titles: the item ROW is invisible, so the link is too — the
    // four-level model applies to links for free.
    await shareProjectsAt("titles");
    seen = await asMate((tx) => tx.select().from(schema.scheduleItemLinks));
    expect(seen.map((r) => r.id)).not.toContain(linkId);
  });

  it("another tenant sees no links at all", async () => {
    await attachAs(sharedItem, "22222222-2222-4222-8222-222222222222");
    const rows = await withTenant(
      tenantB,
      (tx) => tx.select().from(schema.scheduleItemLinks),
      { role: "owner", userId: OTHER },
    );
    expect(rows).toHaveLength(0);
  });

  it("`details` may READ a link and may not DETACH it", async () => {
    await shareProjectsAt("details");
    const linkId = await attachAs(
      sharedItem,
      "33333333-3333-4333-8333-333333333333",
    );

    // WITH CHECK is not consulted for DELETE, so this is the assertion that
    // keeps the USING clause on schedule_item_links_write honest.
    const deleted = await asMate((tx) =>
      tx
        .delete(schema.scheduleItemLinks)
        .where(eq(schema.scheduleItemLinks.id, linkId))
        .returning(),
    );
    expect(deleted).toHaveLength(0);

    await expect(
      asMate((tx) =>
        tx
          .insert(schema.scheduleItemLinks)
          .values({
            tenantId: tenantA,
            itemId: sharedItem,
            extensionSlug: "accounting",
            entityType: "invoice",
            entityId: "44444444-4444-4444-8444-444444444444",
          })
          .returning(),
      ),
    ).rejects.toThrow();
  });

  it("`write` may attach and detach", async () => {
    await shareProjectsAt("write");
    const attached = await asMate((tx) =>
      tx
        .insert(schema.scheduleItemLinks)
        .values({
          tenantId: tenantA,
          itemId: sharedItem,
          extensionSlug: "accounting",
          entityType: "invoice",
          entityId: "55555555-5555-4555-8555-555555555555",
        })
        .returning(),
    );
    expect(attached).toHaveLength(1);

    const removed = await asMate((tx) =>
      tx
        .delete(schema.scheduleItemLinks)
        .where(eq(schema.scheduleItemLinks.id, attached[0].id))
        .returning(),
    );
    expect(removed).toHaveLength(1);
  });

  it("entity_type is an OPEN taxonomy, but must look like one", async () => {
    // A pack registers `rfi` by writing the string — no migration, no core file
    // naming it. That is primitive P3 and this is what proves it.
    const ok = await withSystem((tx) =>
      tx
        .insert(schema.scheduleItemLinks)
        .values({
          tenantId: tenantA,
          itemId: sharedItem,
          extensionSlug: "trades-pack",
          entityType: "rfi",
          entityId: "66666666-6666-4666-8666-666666666666",
        })
        .returning(),
    );
    expect(ok).toHaveLength(1);

    // The format check is the only constraint, and it still applies.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.scheduleItemLinks)
          .values({
            tenantId: tenantA,
            itemId: sharedItem,
            extensionSlug: "accounting",
            entityType: "Not A Valid Type",
            entityId: "77777777-7777-4777-8777-777777777777",
          })
          .returning(),
      ),
    ).rejects.toThrow();
  });

  /* -- Subscribe feed tokens (0100/0101) ------------------------------------ */

  it("a feed token is YOURS, and an owner is no exception", async () => {
    // A token is a credential to one person's calendar. Being the boss is not a
    // way into somebody's phone, so unlike every other table in this module
    // there is no role term at all.
    await withSystem((tx) =>
      tx.insert(schema.scheduleFeedTokens).values([
        { tenantId: tenantA, clerkUserId: MATE, tokenHash: `${STAMP}-mate-hash`, label: "Mate phone" },
        { tenantId: tenantA, clerkUserId: OWNER, tokenHash: `${STAMP}-owner-hash`, label: "Owner phone" },
      ]),
    );

    const mineAsMate = await asMate((tx) =>
      tx.select().from(schema.scheduleFeedTokens),
    );
    expect(mineAsMate.map((r) => r.label)).toEqual(["Mate phone"]);

    const mineAsOwner = await asOwner((tx) =>
      tx.select().from(schema.scheduleFeedTokens),
    );
    expect(mineAsOwner.map((r) => r.label)).toEqual(["Owner phone"]);
  });

  it("an owner cannot REVOKE somebody else's subscription", async () => {
    // WITH CHECK is not consulted for DELETE, and an UPDATE that set
    // revoked_at would be the same silent unsubscribe. Both are refused.
    const updated = await asOwner((tx) =>
      tx
        .update(schema.scheduleFeedTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.scheduleFeedTokens.clerkUserId, MATE))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await asOwner((tx) =>
      tx
        .delete(schema.scheduleFeedTokens)
        .where(eq(schema.scheduleFeedTokens.clerkUserId, MATE))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("another tenant sees no feed tokens", async () => {
    const rows = await withTenant(
      tenantB,
      (tx) => tx.select().from(schema.scheduleFeedTokens),
      { role: "owner", userId: OTHER },
    );
    expect(rows).toHaveLength(0);
  });

  it("forgetting the user id denies feed tokens rather than widening them", async () => {
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.scheduleFeedTokens),
      { role: "owner" },
    );
    expect(rows).toHaveLength(0);
  });

  it("one hash can exist only once, across every tenant", async () => {
    // The route has no tenant context until the hash resolves, so the hash is
    // the entire lookup key — a collision across tenants would be a
    // cross-tenant read.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.scheduleFeedTokens)
          .values({
            tenantId: tenantB,
            clerkUserId: OTHER,
            tokenHash: `${STAMP}-mate-hash`,
          })
          .returning(),
      ),
    ).rejects.toThrow();
  });

  it("one primary calendar per person, enforced by the index", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.scheduleCalendars)
          .values({
            tenantId: tenantA,
            ownerClerkUserId: OWNER,
            name: "Second primary",
            isPrimary: true,
          })
          .returning(),
      ),
    ).rejects.toThrow();
  });
});
