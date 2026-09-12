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
  let punchA = "";

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
        .values({ tenantId: tenantA, weekStartsOn: 1, roundingMinutes: 15 });

      const [punch] = await tx
        .insert(schema.timePunches)
        .values({
          tenantId: tenantA,
          workerId: workerA,
          startedAt: new Date("2026-09-11T13:00:00Z"),
          startedByClerkUserId: MATE,
        })
        .returning();
      punchA = punch.id;
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
      punches: await tx.select().from(schema.timePunches),
    }));
    expect(seen.punches.map((p) => p.id)).toEqual([punchA]);
    expect(seen.workers.map((w) => w.id)).toEqual([workerA]);
    expect(seen.entries.map((e) => e.id)).toEqual([entryA]);
    expect(seen.settings.map((s) => s.weekStartsOn)).toEqual([1]);
  });

  it("the other tenant sees none of it", async () => {
    const seen = await asOtherTenant(async (tx) => ({
      workers: await tx.select().from(schema.timeWorkers),
      entries: await tx.select().from(schema.timeEntries),
      settings: await tx.select().from(schema.timeSettings),
      punches: await tx.select().from(schema.timePunches),
    }));
    expect(seen.workers.map((w) => w.id)).toEqual([workerB]);
    expect(seen.entries).toEqual([]);
    expect(seen.settings).toEqual([]);
    expect(seen.punches).toEqual([]);
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
        punches: await tx.select().from(schema.timePunches),
      };
    });
    expect(seen.workers).toEqual([]);
    expect(seen.entries).toEqual([]);
    expect(seen.settings).toEqual([]);
    expect(seen.punches).toEqual([]);
  });

  /* ── the clock (slice 1) ──────────────────────────────────────────────── */

  it("one open punch per worker, enforced by the database", async () => {
    // THE invariant of the clock. Two running clocks on one person
    // double-count an afternoon, and no amount of care in the action layer can
    // win a race that the index settles.
    await expect(
      asStaff((tx) =>
        tx.insert(schema.timePunches).values({
          tenantId: tenantA,
          workerId: workerA,
          startedAt: new Date("2026-09-11T15:00:00Z"),
          startedByClerkUserId: MATE,
        }),
      ),
    ).rejects.toThrow();
  });

  it("a worker may have any number of CLOSED punches", async () => {
    // The index is partial. Without that, a second shift on the same day would
    // be refused, which is the opposite of what the invariant is for.
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.timePunches)
        .values([
          {
            tenantId: tenantA,
            workerId: workerA,
            startedAt: new Date("2026-09-09T13:00:00Z"),
            endedAt: new Date("2026-09-09T17:00:00Z"),
            startedByClerkUserId: MATE,
          },
          {
            tenantId: tenantA,
            workerId: workerA,
            startedAt: new Date("2026-09-10T13:00:00Z"),
            endedAt: new Date("2026-09-10T17:00:00Z"),
            startedByClerkUserId: MATE,
          },
        ])
        .returning({ id: schema.timePunches.id });
      expect(rows).toHaveLength(2);
      await tx.delete(schema.timePunches).where(
        inArray(
          schema.timePunches.id,
          rows.map((r) => r.id),
        ),
      );
    });
  });

  it("a clock cannot stop before it started", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.timePunches).values({
          tenantId: tenantA,
          workerId: workerB,
          startedAt: new Date("2026-09-11T17:00:00Z"),
          endedAt: new Date("2026-09-11T13:00:00Z"),
          startedByClerkUserId: OTHER,
        }),
      ),
    ).rejects.toThrow();
  });

  it("a punch cannot belong to another tenant's worker, even under withSystem", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.timePunches).values({
          tenantId: tenantA,
          workerId: workerB,
          startedAt: new Date("2026-09-11T13:00:00Z"),
          startedByClerkUserId: OWNER,
        }),
      ),
    ).rejects.toThrow();
  });

  it("an entry cannot claim another tenant's punch", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.timeEntries).values({
          tenantId: tenantB,
          workerId: workerB,
          minutes: 60,
          workDate: "2026-09-11",
          enteredByClerkUserId: OTHER,
          source: "timer",
          punchId: punchA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("one entry per punch", async () => {
    await withSystem(async (tx) => {
      const [punch] = await tx
        .insert(schema.timePunches)
        .values({
          tenantId: tenantA,
          workerId: workerA,
          startedAt: new Date("2026-09-08T13:00:00Z"),
          endedAt: new Date("2026-09-08T17:00:00Z"),
          startedByClerkUserId: MATE,
        })
        .returning({ id: schema.timePunches.id });

      const entry = {
        tenantId: tenantA,
        workerId: workerA,
        minutes: 240,
        workDate: "2026-09-08",
        enteredByClerkUserId: MATE,
        source: "timer",
        punchId: punch.id,
      };
      await tx.insert(schema.timeEntries).values(entry);
      await expect(tx.insert(schema.timeEntries).values(entry)).rejects.toThrow();
    });
  });

  it("deleting a punch keeps its entry and clears the link", async () => {
    // The COLUMN-LIST form of ON DELETE SET NULL, which is the whole reason
    // 0302 was hand-edited: a bare SET NULL on a composite key would try to
    // null `tenant_id` and could never run. The entry is the payable fact and
    // must survive losing its evidence.
    await withSystem(async (tx) => {
      const [punch] = await tx
        .insert(schema.timePunches)
        .values({
          tenantId: tenantA,
          workerId: workerA,
          startedAt: new Date("2026-09-07T13:00:00Z"),
          endedAt: new Date("2026-09-07T17:00:00Z"),
          startedByClerkUserId: MATE,
        })
        .returning({ id: schema.timePunches.id });
      const [entry] = await tx
        .insert(schema.timeEntries)
        .values({
          tenantId: tenantA,
          workerId: workerA,
          minutes: 240,
          workDate: "2026-09-07",
          enteredByClerkUserId: MATE,
          source: "timer",
          punchId: punch.id,
        })
        .returning({ id: schema.timeEntries.id });

      await tx
        .delete(schema.timePunches)
        .where(eq(schema.timePunches.id, punch.id));

      const after = await tx.query.timeEntries.findFirst({
        where: eq(schema.timeEntries.id, entry.id),
      });
      expect(after).toBeTruthy();
      expect(after!.punchId).toBeNull();
      expect(after!.minutes).toBe(240);
      expect(after!.tenantId).toBe(tenantA);

      await tx.delete(schema.timeEntries).where(eq(schema.timeEntries.id, entry.id));
    });
  });

  it("refuses a source and a rounding nobody offers", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.timeEntries).values({
          tenantId: tenantA,
          workerId: workerA,
          minutes: 60,
          workDate: "2026-09-11",
          enteredByClerkUserId: MATE,
          source: "kiosk", // arrives in slice 7, with the door that writes it
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withSystem((tx) =>
        tx
          .update(schema.timeSettings)
          .set({ roundingMinutes: 7 })
          .where(eq(schema.timeSettings.tenantId, tenantA)),
      ),
    ).rejects.toThrow();
  });
});
