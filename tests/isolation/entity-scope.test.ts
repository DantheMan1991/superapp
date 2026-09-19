import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * WHICH COMPANY'S ROWS A PERSON MAY READ (ADR 0094).
 *
 * The other isolation files ask whether one TENANT can see another's rows. This
 * one asks whether one PERSON can see another company's rows **inside the
 * tenant they legitimately belong to** — which is a different question, and the
 * only one an owner limiting their bookkeeper actually cares about.
 *
 * ── TWO HALVES, BOTH TESTED, BECAUSE EITHER ONE FAILING IS A LEAK ───────────
 *
 * 1. **Resolution** — `app_entity_ids_for(tenant, user)` turns a membership
 *    into the list. Tested directly, because in a test there is no request and
 *    therefore no `auth()`, so `withTenant` resolves an empty user.
 * 2. **Enforcement** — the restrictive policies. Tested by setting
 *    `app.entity_ids` inside the transaction, which is exactly what
 *    `withTenant` does for a real request.
 *
 * Splitting them is not a convenience: a test that only set the GUC would pass
 * while the lookup returned the wrong person's companies, and a test that only
 * checked the lookup would pass while no policy existed at all.
 */
const STAMP = `iso-escope-${process.pid}`;

/** Set the scope the way `withTenant` does, then run the reads. */
async function asScope<T>(
  tenantId: string,
  entityIds: string[],
  fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>,
  role: "owner" | "staff" = "staff",
): Promise<T> {
  return withTenant(
    tenantId,
    async (tx) => {
      await tx.execute(
        sql`select set_config('app.entity_ids', ${entityIds.join(",")}, true)`,
      );
      return fn(tx);
    },
    { role },
  );
}

const clerkUserId = `${STAMP}-dave`;

d("entity scope (RLS: one person, some of the companies)", () => {
  let tenantId: string;
  let premier: string;
  let prefab: string;
  let membershipId: string;

  async function seedCompany(name: string, isDefault: boolean): Promise<string> {
    return withSystem(async (tx) => {
      const [entity] = await tx
        .insert(schema.entities)
        .values({ tenantId, name, isDefault })
        .returning();
      const [account] = await tx
        .insert(schema.accounts)
        .values({
          tenantId,
          code: isDefault ? "1000" : "1001",
          name: `Cash ${name}`,
          accountType: "asset",
          subtype: "bank",
        })
        .returning();
      const [entry] = await tx
        .insert(schema.journalEntries)
        .values({
          tenantId,
          entityId: entity.id,
          entryDate: "2026-06-01",
          memo: `Entry for ${name}`,
          status: "posted",
          createdByClerkUserId: clerkUserId,
        })
        .returning();
      // `line_no` is unique per entry and does not default usefully for a
      // two-line insert, so the fixture numbers them.
      await tx.insert(schema.journalLines).values([
        { tenantId, entryId: entry.id, accountId: account.id, amountCents: 5000, lineNo: 1 },
        { tenantId, entryId: entry.id, accountId: account.id, amountCents: -5000, lineNo: 2 },
      ]);
      return entity.id;
    });
  }

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Shrock Group", slug: STAMP })
        .returning();
      return row.id;
    });
    premier = await seedCompany("Shrock Premier", true);
    prefab = await seedCompany("Shrock Prefab", false);

    membershipId = await withSystem(async (tx) => {
      const [profile] = await tx
        .insert(schema.profiles)
        .values({ clerkUserId, email: `${STAMP}@example.test` })
        .returning();
      const [m] = await tx
        .insert(schema.memberships)
        .values({ tenantId, profileId: profile.id, role: "staff", entityIds: [prefab] })
        .returning();
      return m.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      await tx.delete(schema.profiles).where(eq(schema.profiles.clerkUserId, clerkUserId));
    });
  });

  /* -- half one: the list is read off the right membership --------------- */

  it("turns a membership into the company list", async () => {
    const [row] = await withSystem((tx) =>
      tx.execute(sql`select app_entity_ids_for(${tenantId}::uuid, ${clerkUserId}) as ids`),
    ).then((r) => r.rows as { ids: string }[]);
    expect(row.ids).toBe(prefab);
  });

  it("answers EMPTY for somebody with no membership here", async () => {
    const [row] = await withSystem((tx) =>
      tx.execute(sql`select app_entity_ids_for(${tenantId}::uuid, 'nobody') as ids`),
    ).then((r) => r.rows as { ids: string }[]);
    expect(row.ids).toBe("");
  });

  /**
   * **THE SOFT EDGE, ASSERTED RATHER THAN LEFT IMPLIED.** No request means no
   * `auth()` means an empty acting user, which reads as unrestricted. Scripts,
   * seeds, crons and this very suite depend on that, and it is safe only
   * because nothing reaches a page without `requireTenant()` first.
   */
  it("answers EMPTY when there is no acting user at all", async () => {
    const [row] = await withSystem((tx) =>
      tx.execute(sql`select app_entity_ids_for(${tenantId}::uuid, '') as ids`),
    ).then((r) => r.rows as { ids: string }[]);
    expect(row.ids).toBe("");
  });

  it("does not hand one tenant another tenant's list", async () => {
    const [row] = await withSystem((tx) =>
      tx.execute(
        sql`select app_entity_ids_for('00000000-0000-0000-0000-000000000000'::uuid, ${clerkUserId}) as ids`,
      ),
    ).then((r) => r.rows as { ids: string }[]);
    expect(row.ids).toBe("");
  });

  /* -- half two: the policies ------------------------------------------- */

  it("shows both companies to somebody with no scope", async () => {
    const seen = await asScope(tenantId, [], (tx) =>
      tx.select({ name: schema.entities.name }).from(schema.entities),
    );
    expect(seen.map((r) => r.name).sort()).toEqual(["Shrock Prefab", "Shrock Premier"]);
  });

  it("shows only their own company to somebody scoped to one", async () => {
    const seen = await asScope(tenantId, [prefab], (tx) =>
      tx.select({ name: schema.entities.name }).from(schema.entities),
    );
    expect(seen.map((r) => r.name)).toEqual(["Shrock Prefab"]);
  });

  it("hides the other company's entries", async () => {
    const seen = await asScope(tenantId, [prefab], (tx) =>
      tx.select({ memo: schema.journalEntries.memo }).from(schema.journalEntries),
    );
    expect(seen.map((r) => r.memo)).toEqual(["Entry for Shrock Prefab"]);
  });

  /**
   * **THE CHILD-TABLE HALF, which is the one an EXISTS clause exists for.**
   * `journal_lines` carries no `entity_id`; it inherits one through its entry.
   * Scoping only the parents would leave every line amount readable on its own,
   * which is most of what a ledger is.
   */
  it("hides the other company's journal LINES, which carry no company", async () => {
    const both = await asScope(tenantId, [], (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(schema.journalLines),
    );
    expect(both[0].n).toBe(4);
    const mine = await asScope(tenantId, [prefab], (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(schema.journalLines),
    );
    expect(mine[0].n).toBe(2);
  });

  /**
   * **NAMED, NOT MERELY THROWN.** A bare `rejects.toThrow()` here passed even
   * with the predicate replaced by `SELECT true` — it was catching some other
   * error entirely, which is a test passing for the wrong reason and worse than
   * no test. The assertion is now the row-level-security violation itself.
   */
  it("REFUSES an entry posted into a company they are not on", async () => {
    let raised: unknown;
    try {
      await asScope(tenantId, [prefab], (tx) =>
        tx.insert(schema.journalEntries).values({
          tenantId,
          entityId: premier,
          entryDate: "2026-06-02",
          memo: "sneaking into Premier",
          status: "posted",
          createdByClerkUserId: clerkUserId,
        }),
      );
    } catch (err) {
      raised = err;
    }
    // Drizzle wraps the driver error, so the sentence Postgres wrote is on
    // `cause` — matching the wrapper's "Failed query:" would assert nothing.
    const why = String((raised as { cause?: { message?: string } })?.cause?.message ?? raised);
    expect(why).toMatch(/row-level security/i);
  });

  it("ALLOWS an entry posted into a company they are on", async () => {
    const made = await asScope(tenantId, [prefab], (tx) =>
      tx
        .insert(schema.journalEntries)
        .values({
          tenantId,
          entityId: prefab,
          entryDate: "2026-06-02",
          memo: "their own",
          status: "draft",
          createdByClerkUserId: clerkUserId,
        })
        .returning({ id: schema.journalEntries.id }),
    );
    expect(made).toHaveLength(1);
    await withSystem((tx) =>
      tx.delete(schema.journalEntries).where(eq(schema.journalEntries.id, made[0].id)),
    );
  });

  /**
   * **A RESTRICTIVE POLICY APPLIES TO THE SUPERADMIN TOO**, so
   * `app_entity_allows` starts with `app_is_superadmin()`. Without that clause
   * every webhook, cron, seed and migration on this platform stops seeing rows.
   */
  it("leaves withSystem seeing everything", async () => {
    const seen = await withSystem((tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.entities)
        .where(eq(schema.entities.tenantId, tenantId)),
    );
    expect(seen[0].n).toBe(2);
  });

  /* -- the escalation ---------------------------------------------------- */

  /**
   * Empty means EVERY company, so a staff member who could write their own
   * membership row would clear the list and be done. Closed by the same
   * owners-only policy `access_level_id` relies on (`drizzle/0385`).
   */
  it("REFUSES staff widening their own company list", async () => {
    const changed = await withTenant(
      tenantId,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ entityIds: [] })
          .where(eq(schema.memberships.id, membershipId))
          .returning({ id: schema.memberships.id }),
      { role: "staff" },
    );
    expect(changed).toHaveLength(0);
    const after = await withSystem((tx) =>
      tx.query.memberships.findFirst({ where: eq(schema.memberships.id, membershipId) }),
    );
    expect(after!.entityIds).toEqual([prefab]);
  });

  it("still lets an owner change it", async () => {
    const changed = await withTenant(
      tenantId,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ entityIds: [premier, prefab] })
          .where(eq(schema.memberships.id, membershipId))
          .returning({ id: schema.memberships.id }),
      { role: "owner" },
    );
    expect(changed).toHaveLength(1);
    await withSystem((tx) =>
      tx
        .update(schema.memberships)
        .set({ entityIds: [prefab] })
        .where(eq(schema.memberships.id, membershipId)),
    );
  });

  /* -- and the tenant boundary is untouched ------------------------------ */

  it("still shows nothing with no tenant context at all", async () => {
    const seen = await asScope("00000000-0000-0000-0000-000000000000", [prefab], (tx) =>
      tx
        .select()
        .from(schema.entities)
        .where(eq(schema.entities.tenantId, tenantId)),
    );
    expect(seen).toHaveLength(0);
  });
});
