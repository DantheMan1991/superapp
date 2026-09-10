import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d, seedParty } from "./_shared";

/**
 * `ps_engagements`, `ps_engagement_allotments` and `ps_time_entries` — RLS.
 *
 * There is nothing special in this file, and that is the point: a capability
 * pack's tables get exactly the treatment a core module's do — tenant_id,
 * FORCE RLS, default-deny with no context, no cross-tenant read, write or
 * enumeration.
 *
 * It also certifies the two composite FKs this pack has that a flat table
 * would not: an engagement's CLIENT is always a same-tenant party, and an
 * entry's ENGAGEMENT is always a same-tenant engagement — so a cross-tenant
 * engagement is unrepresentable even under `withSystem`.
 *
 * Fixtures are built under `withSystem` on purpose: this suite certifies what
 * the DATABASE enforces, and routing setup through
 * `src/packs/professional-services/ops.ts` would let a bug in that file make
 * these tests agree with it.
 */
d("professional-services tables (RLS)", () => {
  const STAMP = `iso-ps-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`; // staff in tenant A
  const OTHER = `${STAMP}-other`; // owner of tenant B

  let tenantA = "";
  let tenantB = "";
  let clientA = "";
  let clientB = "";
  let engagementA = "";
  let engagementB = "";
  let entryA = "";

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
          { clerkOrgId: `${STAMP}-a`, name: "Services A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Services B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      clientA = await seedParty(tx, tenantA, "Hollis & Co");
      clientB = await seedParty(tx, tenantB, "Other Client");

      const [a] = await tx
        .insert(schema.psEngagements)
        .values({
          tenantId: tenantA,
          partyId: clientA,
          name: "Monthly bookkeeping",
          kind: "retainer",
          startsOn: "2026-09-01",
          retainerMinutesMonthly: 600,
          rateCents: 12_000,
        })
        .returning();
      engagementA = a.id;

      const [b] = await tx
        .insert(schema.psEngagements)
        .values({
          tenantId: tenantB,
          partyId: clientB,
          name: "Their project",
          kind: "project",
          startsOn: "2026-09-01",
        })
        .returning();
      engagementB = b.id;

      await tx.insert(schema.psEngagementAllotments).values({
        tenantId: tenantA,
        engagementId: engagementA,
        effectiveMonth: "2026-09",
        includedMinutes: 600,
      });

      const [entry] = await tx
        .insert(schema.psTimeEntries)
        .values({
          tenantId: tenantA,
          engagementId: engagementA,
          minutes: 90,
          workDate: "2026-09-03",
          note: "Bank reconciliation",
          actorClerkUserId: MATE,
        })
        .returning();
      entryA = entry.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.profiles)
        .where(inArray(schema.profiles.clerkUserId, [OWNER, MATE, OTHER]));
    });
  });

  it("a tenant sees only its own engagements", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.psEngagements));
    expect(mine.map((e) => e.name)).toEqual(["Monthly bookkeeping"]);
    expect(mine.map((e) => e.id)).not.toContain(engagementB);

    const theirs = await asOtherTenant((tx) => tx.select().from(schema.psEngagements));
    expect(theirs.map((e) => e.name)).toEqual(["Their project"]);
  });

  it("staff read engagements, allotments and time — the row level is member-wide", async () => {
    // What a colleague may SEE is the whole engagement: somebody logging their
    // afternoon has to find it, and the retainer is what makes the entry worth
    // making. Which VERB needs which role is the action layer's business.
    const [engagements, allotments, entries] = await asStaff((tx) =>
      Promise.all([
        tx.select().from(schema.psEngagements),
        tx.select().from(schema.psEngagementAllotments),
        tx.select().from(schema.psTimeEntries),
      ]),
    );
    expect(engagements).toHaveLength(1);
    expect(allotments).toHaveLength(1);
    expect(entries).toHaveLength(1);
  });

  it("cannot read another tenant's engagement even by id", async () => {
    const found = await asOwner((tx) =>
      tx.select().from(schema.psEngagements).where(eq(schema.psEngagements.id, engagementB)),
    );
    expect(found).toHaveLength(0);
  });

  it("cannot read another tenant's time entries", async () => {
    const found = await asOtherTenant((tx) =>
      tx.select().from(schema.psTimeEntries).where(eq(schema.psTimeEntries.id, entryA)),
    );
    expect(found).toHaveLength(0);
  });

  it("cannot update another tenant's engagement", async () => {
    const updated = await asOwner((tx) =>
      tx
        .update(schema.psEngagements)
        .set({ name: "Stolen" })
        .where(eq(schema.psEngagements.id, engagementB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const actual = await withSystem((tx) =>
      tx.select().from(schema.psEngagements).where(eq(schema.psEngagements.id, engagementB)),
    );
    expect(actual[0].name).toBe("Their project");
  });

  it("cannot delete another tenant's time entry", async () => {
    const deleted = await asOtherTenant((tx) =>
      tx.delete(schema.psTimeEntries).where(eq(schema.psTimeEntries.id, entryA)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("cannot insert a row stamped with another tenant", async () => {
    // WITH CHECK, not USING: the row would be invisible afterwards, but the
    // policy has to refuse it outright or a tenant could write into another's
    // data and simply not be able to read it back.
    await expect(
      asOwner((tx) =>
        tx.insert(schema.psEngagements).values({
          tenantId: tenantB,
          partyId: clientB,
          name: "Smuggled",
          kind: "project",
          startsOn: "2026-09-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move an engagement into another tenant", async () => {
    // THROWS rather than returning zero rows: the row is visible, and the new
    // values leave the tenant, so WITH CHECK refuses it outright.
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.psEngagements)
          .set({ tenantId: tenantB })
          .where(eq(schema.psEngagements.id, engagementA)),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's engagement cannot be for B's client", async () => {
    // The wall that matters — and it holds under the god view, where RLS is
    // not watching, because it is the DATABASE saying no.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.psEngagements).values({
          tenantId: tenantA,
          partyId: clientB,
          name: "Cross-tenant client",
          kind: "project",
          startsOn: "2026-09-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's time cannot be logged against B's engagement", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.psTimeEntries).values({
          tenantId: tenantA,
          engagementId: engagementB,
          minutes: 60,
          workDate: "2026-09-03",
          actorClerkUserId: MATE,
        }),
      ),
    ).rejects.toThrow();
  });

  it("no context, no rows — FORCE row level security", async () => {
    // Default-deny: the connection's own role sees nothing without a tenant.
    for (const table of [
      schema.psEngagements,
      schema.psEngagementAllotments,
      schema.psTimeEntries,
    ]) {
      const rows = await withTenant(
        "00000000-0000-0000-0000-000000000000",
        (tx) => tx.select().from(table),
        { role: "owner", userId: OWNER },
      );
      expect(rows).toHaveLength(0);
    }
  });

  it("deleting the tenant takes its engagements and their time with it", async () => {
    // The cascades that DO exist: tenant → engagement → allotments and time.
    // The one that deliberately does not is the party FK, certified in
    // tests/engagements-ops.test.ts.
    const [victim] = await withSystem((tx) =>
      tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-c`, name: "Services C", slug: `${STAMP}-c` })
        .returning(),
    );
    const engagementId = await withSystem(async (tx) => {
      const party = await seedParty(tx, victim.id, "Doomed");
      const [row] = await tx
        .insert(schema.psEngagements)
        .values({
          tenantId: victim.id,
          partyId: party,
          name: "Doomed work",
          kind: "project",
          startsOn: "2026-09-01",
        })
        .returning();
      await tx.insert(schema.psTimeEntries).values({
        tenantId: victim.id,
        engagementId: row.id,
        minutes: 30,
        workDate: "2026-09-03",
        actorClerkUserId: OWNER,
      });
      return row.id;
    });

    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, victim.id)));
    const left = await withSystem((tx) =>
      tx
        .select()
        .from(schema.psTimeEntries)
        .where(eq(schema.psTimeEntries.engagementId, engagementId)),
    );
    expect(left).toHaveLength(0);
  });
});
