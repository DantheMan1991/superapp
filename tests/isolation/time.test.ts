import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `time_workers`, `time_entries` and `time_settings` — RLS.
 *
 * There is nothing special in this file, and that is the point: a core module's
 * tables get exactly the treatment a pack's do — tenant_id, FORCE RLS,
 * default-deny with no context, no cross-tenant read, write or enumeration.
 *
 * It also certifies the two composite FKs this module has that flat tables
 * would not: a worker's PERSON is always a same-tenant party, and an entry's
 * WORKER is always a same-tenant worker — so a cross-tenant entry is
 * unrepresentable even under `withSystem`, where RLS is not watching.
 *
 * And one thing that is genuinely this module's: the partial unique index on
 * `(tenant_id, clerk_user_id)`. One worker per sign-in WITHIN a tenant, while
 * many workers with no sign-in at all coexist happily — the ordinary case, and
 * the reason the column is nullable rather than an empty-string sentinel.
 *
 * Fixtures are built under `withSystem` on purpose: this suite certifies what
 * the DATABASE enforces, and routing setup through `worker-ops.ts` would let a
 * bug in that file make these tests agree with it.
 */

/**
 * A PERSON, where `_shared.seedParty` mints an organization. A worker is
 * always a person, and a fixture that said otherwise would be certifying
 * something the product cannot produce. Raw insert for the reason every
 * fixture here is one: this suite proves what the DATABASE enforces.
 */
async function seedPerson(tx: Tx, tenantId: string, displayName: string) {
  const [row] = await tx
    .insert(schema.parties)
    .values({ tenantId, kind: "person", displayName })
    .returning({ id: schema.parties.id });
  return row.id;
}

d("time tables (RLS)", () => {
  const STAMP = `iso-time-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`; // staff in tenant A
  const OTHER = `${STAMP}-other`; // owner of tenant B

  let tenantA = "";
  let tenantB = "";
  let personA = "";
  let personB = "";
  let workerA = "";
  let workerB = "";
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
          { clerkOrgId: `${STAMP}-a`, name: "Time A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Time B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      personA = await seedPerson(tx, tenantA, "Jo Okafor");
      personB = await seedPerson(tx, tenantB, "Someone Else");

      const [a] = await tx
        .insert(schema.timeWorkers)
        .values({ tenantId: tenantA, partyId: personA, clerkUserId: MATE })
        .returning();
      workerA = a.id;

      const [b] = await tx
        .insert(schema.timeWorkers)
        .values({ tenantId: tenantB, partyId: personB })
        .returning();
      workerB = b.id;

      const [entry] = await tx
        .insert(schema.timeEntries)
        .values({
          tenantId: tenantA,
          workerId: workerA,
          minutes: 450,
          workDate: "2026-09-10",
          payType: "worked",
          note: "Fencing",
          enteredByClerkUserId: MATE,
        })
        .returning();
      entryA = entry.id;

      await tx
        .insert(schema.timeSettings)
        .values({ tenantId: tenantA, weekStartsOn: 1 });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // Entries, workers and settings all cascade from the tenant.
      await tx
        .delete(schema.tenants)
        .where(inArray(schema.tenants.id, [tenantA, tenantB]));
    });
  });

  it("a member sees their own tenant's workers, entries and settings", async () => {
    const seen = await asStaff(async (tx) => ({
      workers: await tx.select().from(schema.timeWorkers),
      entries: await tx.select().from(schema.timeEntries),
      settings: await tx.select().from(schema.timeSettings),
    }));
    expect(seen.workers.map((w) => w.id)).toEqual([workerA]);
    expect(seen.entries.map((e) => e.id)).toEqual([entryA]);
    expect(seen.settings.map((s) => s.weekStartsOn)).toEqual([1]);
  });

  it("the other tenant sees none of it", async () => {
    const seen = await asOtherTenant(async (tx) => ({
      workers: await tx.select().from(schema.timeWorkers),
      entries: await tx.select().from(schema.timeEntries),
      settings: await tx.select().from(schema.timeSettings),
    }));
    expect(seen.workers.map((w) => w.id)).toEqual([workerB]);
    expect(seen.entries).toEqual([]);
    expect(seen.settings).toEqual([]);
  });

  it("naming another tenant's entry by id finds nothing", async () => {
    const found = await asOtherTenant((tx) =>
      tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, entryA)),
    );
    expect(found).toEqual([]);
  });

  it("a cross-tenant update writes no rows", async () => {
    await asOtherTenant((tx) =>
      tx
        .update(schema.timeEntries)
        .set({ minutes: 1 })
        .where(eq(schema.timeEntries.id, entryA)),
    );
    const after = await asStaff((tx) =>
      tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, entryA)),
    );
    expect(after[0].minutes).toBe(450);
  });

  it("a cross-tenant delete removes nothing", async () => {
    await asOtherTenant((tx) =>
      tx.delete(schema.timeEntries).where(eq(schema.timeEntries.id, entryA)),
    );
    const after = await asStaff((tx) =>
      tx.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, entryA)),
    );
    expect(after).toHaveLength(1);
  });

  it("an entry cannot be written against another tenant's worker", async () => {
    // WITH CHECK refuses the row: the tenant_id must be this tenant's, and the
    // composite FK then refuses a worker that is not in it.
    await expect(
      asOwner((tx) =>
        tx.insert(schema.timeEntries).values({
          tenantId: tenantA,
          workerId: workerB,
          minutes: 60,
          workDate: "2026-09-10",
          enteredByClerkUserId: OWNER,
        }),
      ),
    ).rejects.toThrow();
  });

  it("the composite FK holds even under withSystem", async () => {
    // The god view bypasses RLS, and the foreign key is what still makes a
    // cross-tenant entry unrepresentable.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.timeEntries).values({
          tenantId: tenantA,
          workerId: workerB,
          minutes: 60,
          workDate: "2026-09-10",
          enteredByClerkUserId: OWNER,
        }),
      ),
    ).rejects.toThrow();
  });

  it("a worker cannot point at another tenant's person", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.timeWorkers)
          .values({ tenantId: tenantA, partyId: personB }),
      ),
    ).rejects.toThrow();
  });

  it("one worker per sign-in, and any number with none", async () => {
    await withSystem(async (tx) => {
      const spare = await seedPerson(tx, tenantA, "Spare Hand");
      // Same sign-in as workerA, same tenant: refused.
      await expect(
        tx
          .insert(schema.timeWorkers)
          .values({ tenantId: tenantA, partyId: spare, clerkUserId: MATE }),
      ).rejects.toThrow();
    });

    // Two workers with NO sign-in coexist — the partial index makes NULLs
    // distinct, which is the ordinary case for anybody who never opens the app.
    await withSystem(async (tx) => {
      const one = await seedPerson(tx, tenantA, "Hand One");
      const two = await seedPerson(tx, tenantA, "Hand Two");
      const rows = await tx
        .insert(schema.timeWorkers)
        .values([
          { tenantId: tenantA, partyId: one },
          { tenantId: tenantA, partyId: two },
        ])
        .returning({ id: schema.timeWorkers.id });
      expect(rows).toHaveLength(2);
      await tx
        .delete(schema.timeWorkers)
        .where(inArray(schema.timeWorkers.id, rows.map((r) => r.id)));
    });
  });

  it("the same sign-in may be a worker in two tenants", async () => {
    // A bookkeeper working for two businesses is one human with two worker
    // rows. The sign-in index is scoped to the tenant, which is what allows it.
    //
    // A FRESH PERSON IN TENANT B, because `personB` already has `workerB`:
    // reusing them would trip `time_workers_tenant_party_idx` and prove the
    // wrong index. The first draft of this test did exactly that.
    await withSystem(async (tx) => {
      const alsoB = await seedPerson(tx, tenantB, "Shared Bookkeeper");
      const [row] = await tx
        .insert(schema.timeWorkers)
        .values({ tenantId: tenantB, partyId: alsoB, clerkUserId: MATE })
        .returning({ id: schema.timeWorkers.id });
      expect(row.id).toBeTruthy();
    });
  });

  it("with no tenant context there are no rows at all", async () => {
    const seen = await withSystem(async (tx) => {
      // Clear the god flag AND the tenant, so this is the "connected, but
      // nobody said who" case the FORCE policy must deny. Same two statements
      // the accounting and banking suites use.
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return {
        workers: await tx.select().from(schema.timeWorkers),
        entries: await tx.select().from(schema.timeEntries),
        settings: await tx.select().from(schema.timeSettings),
      };
    });
    expect(seen.workers).toEqual([]);
    expect(seen.entries).toEqual([]);
    expect(seen.settings).toEqual([]);
  });
});
