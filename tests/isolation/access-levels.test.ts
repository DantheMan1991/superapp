import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * ACCESS LEVELS: tenant isolation, and the two policies the whole feature
 * rests on (ADR 0093).
 *
 * The ordinary isolation half is here for the reason every table's is. The
 * other half is what makes this file worth reading: an access level is a
 * CAPABILITY, and the people it restricts are inside the tenant it belongs to.
 * RLS against another tenant is not the interesting question — RLS against the
 * restricted person is.
 *
 * Two escalations must be impossible from tenant context, and app code must not
 * be the only thing preventing either:
 *
 *  1. Rewriting the level itself, to give it back what it took away.
 *  2. Rewriting your own membership's `access_level_id` — and NULL is the
 *     unrestricted value, so that one is a single UPDATE from the run of the
 *     workspace.
 *
 * Both are asserted below under a STAFF context, which is the role a restricted
 * person actually has.
 */
const STAMP = `iso-access-${process.pid}`;

d("access level isolation (RLS + the two escalations)", () => {
  let tenantA: string;
  let tenantB: string;
  let levelA: string;
  let membershipA: string;

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Access A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Access B", slug: `${STAMP}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });

    // The level and the person on it. Seeded under withSystem, because the
    // write policies being owners-only is one of the things under test.
    await withSystem(async (tx) => {
      const [level] = await tx
        .insert(schema.accessLevels)
        .values({ tenantId: tenantA, name: "Field crew", denied: ["marketing"] })
        .returning();
      levelA = level.id;
      const [profile] = await tx
        .insert(schema.profiles)
        .values({ clerkUserId: `${STAMP}-user`, email: `${STAMP}@example.test` })
        .returning();
      const [membership] = await tx
        .insert(schema.memberships)
        .values({
          tenantId: tenantA,
          profileId: profile.id,
          role: "staff",
          accessLevelId: level.id,
        })
        .returning();
      membershipA = membership.id;

      await tx
        .insert(schema.accessLevels)
        .values({ tenantId: tenantB, name: "Bookkeeper", denied: ["jobs"] });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.profiles)
        .where(eq(schema.profiles.clerkUserId, `${STAMP}-user`));
    });
  });

  /* -- the ordinary half -------------------------------------------------- */

  it("shows a tenant only its own levels", async () => {
    const seen = await withTenant(tenantA, (tx) =>
      tx.select({ name: schema.accessLevels.name }).from(schema.accessLevels),
    );
    expect(seen.map((r) => r.name)).toEqual(["Field crew"]);
  });

  it("cannot read another tenant's level by id", async () => {
    const other = await withSystem((tx) =>
      tx.query.accessLevels.findFirst({
        where: eq(schema.accessLevels.tenantId, tenantB),
      }),
    );
    const seen = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.accessLevels).where(eq(schema.accessLevels.id, other!.id)),
    );
    expect(seen).toHaveLength(0);
  });

  /* -- escalation 1: rewriting the level ---------------------------------- */

  /**
   * SELECT is member-wide on purpose: the gate on every request reads the
   * caller's own level, and what you may not open is not a secret from you.
   */
  it("lets staff READ the level they are on", async () => {
    const seen = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.accessLevels),
      { role: "staff" },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].denied).toEqual(["marketing"]);
  });

  it("REFUSES staff an update to the level restricting them", async () => {
    const changed = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.accessLevels)
          .set({ denied: [] })
          .where(eq(schema.accessLevels.id, levelA))
          .returning({ id: schema.accessLevels.id }),
      { role: "staff" },
    );
    expect(changed).toHaveLength(0);
    // And the row is untouched, not merely unreturned.
    const after = await withSystem((tx) =>
      tx.query.accessLevels.findFirst({ where: eq(schema.accessLevels.id, levelA) }),
    );
    expect(after!.denied).toEqual(["marketing"]);
  });

  it("REFUSES staff a new level of their own", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx.insert(schema.accessLevels).values({ tenantId: tenantA, name: "Mine" }),
        { role: "staff" },
      ),
    ).rejects.toThrow();
  });

  it("REFUSES staff a delete", async () => {
    const gone = await withTenant(
      tenantA,
      (tx) =>
        tx
          .delete(schema.accessLevels)
          .where(eq(schema.accessLevels.id, levelA))
          .returning({ id: schema.accessLevels.id }),
      { role: "staff" },
    );
    expect(gone).toHaveLength(0);
  });

  it("lets an OWNER do all three", async () => {
    const changed = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.accessLevels)
          .set({ denied: ["marketing", "retail"] })
          .where(eq(schema.accessLevels.id, levelA))
          .returning({ id: schema.accessLevels.id }),
      { role: "owner" },
    );
    expect(changed).toHaveLength(1);
    // Put it back, so the escalation tests below read the fixture they expect.
    await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.accessLevels)
          .set({ denied: ["marketing"] })
          .where(eq(schema.accessLevels.id, levelA)),
      { role: "owner" },
    );
  });

  /* -- escalation 2: rewriting your own membership ------------------------ */

  /**
   * **THE ONE THAT WOULD HAVE BEEN ONE UPDATE WIDE.** `access_level_id` is
   * nullable and null means unrestricted — that is what lets the feature ship
   * without changing anybody's access — so a staff member who could write their
   * own membership row would simply null it and be done. `drizzle/0385` narrows
   * the memberships UPDATE policy to owners for exactly this.
   */
  it("REFUSES staff taking themselves off their own level", async () => {
    const changed = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ accessLevelId: null })
          .where(eq(schema.memberships.id, membershipA))
          .returning({ id: schema.memberships.id }),
      { role: "staff" },
    );
    expect(changed).toHaveLength(0);
    const after = await withSystem((tx) =>
      tx.query.memberships.findFirst({ where: eq(schema.memberships.id, membershipA) }),
    );
    expect(after!.accessLevelId).toBe(levelA);
  });

  it("still lets an OWNER move somebody between levels", async () => {
    const changed = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ accessLevelId: null })
          .where(eq(schema.memberships.id, membershipA))
          .returning({ id: schema.memberships.id }),
      { role: "owner" },
    );
    expect(changed).toHaveLength(1);
    await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.memberships)
          .set({ accessLevelId: levelA })
          .where(eq(schema.memberships.id, membershipA)),
      { role: "owner" },
    );
  });

  /* -- the composite FK --------------------------------------------------- */

  it("REFUSES a membership pointing at another tenant's level", async () => {
    const other = await withSystem((tx) =>
      tx.query.accessLevels.findFirst({
        where: eq(schema.accessLevels.tenantId, tenantB),
      }),
    );
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.memberships)
          .set({ accessLevelId: other!.id })
          .where(eq(schema.memberships.id, membershipA)),
      ),
    ).rejects.toThrow();
  });

  /**
   * NO ACTION rather than SET NULL, and this is the assertion that says why:
   * a cascade to null would hand everybody on a deleted level the run of the
   * workspace, silently. The database refuses instead.
   */
  it("REFUSES deleting a level somebody is still on, even under withSystem", async () => {
    await expect(
      withSystem((tx) =>
        tx.delete(schema.accessLevels).where(eq(schema.accessLevels.id, levelA)),
      ),
    ).rejects.toThrow();
  });

  /* -- default deny ------------------------------------------------------- */

  it("shows nothing with no tenant context at all", async () => {
    const seen = await withTenant(
      "00000000-0000-0000-0000-000000000000",
      (tx) =>
        tx
          .select()
          .from(schema.accessLevels)
          .where(
            and(
              eq(schema.accessLevels.tenantId, tenantA),
              eq(schema.accessLevels.id, levelA),
            ),
          ),
    );
    expect(seen).toHaveLength(0);
  });
});
