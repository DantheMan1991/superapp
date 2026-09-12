import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * device_grants + device_grant_uses (RLS) — ADR 0048.
 *
 * A grant is a CREDENTIAL: holding it lets a phone write to a workspace with
 * no session behind it. So the posture is `push_devices`' rather than an
 * ordinary tenant table's — your own rows in your own tenant, both clauses,
 * and no tier of membership reaches somebody else's phone in either
 * direction. An owner cannot see or switch off a colleague's grant HERE; the
 * lever they have is bigger and lives elsewhere (removing the person, which
 * `redeem.ts` honours through its INNER JOIN).
 *
 * The uses table is append-only, like `audit_log`: what a phone did last
 * Tuesday is not a thing anybody may rewrite.
 */
d("device_grants (RLS)", () => {
  const STAMP = `iso-grant-${process.pid}-${Date.now()}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OUTSIDER = `${STAMP}-outsider`;
  let tenantA: string;
  let tenantB: string;
  let ownerGrant: string;
  let mateGrant: string;

  const soon = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000);

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asMate = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOutsider = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OUTSIDER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [a] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `org_${STAMP}_a`, name: `Grant A ${STAMP}`, slug: `${STAMP}-a` })
        .returning();
      const [b] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `org_${STAMP}_b`, name: `Grant B ${STAMP}`, slug: `${STAMP}-b` })
        .returning();
      tenantA = a.id;
      tenantB = b.id;

      const rows = await tx
        .insert(schema.deviceGrants)
        .values([
          {
            tenantId: tenantA,
            clerkUserId: OWNER,
            tokenHash: `${STAMP}-owner-hash`,
            platform: "ios",
            label: "Owner phone",
            expiresAt: soon(),
          },
          {
            tenantId: tenantA,
            clerkUserId: MATE,
            tokenHash: `${STAMP}-mate-hash`,
            platform: "android",
            label: "Mate phone",
            expiresAt: soon(),
          },
        ])
        .returning();
      ownerGrant = rows[0].id;
      mateGrant = rows[1].id;

      await tx.insert(schema.deviceGrantUses).values({
        tenantId: tenantA,
        grantId: mateGrant,
        clerkUserId: MATE,
        idempotencyKey: `${STAMP}-mate-use`,
        outcome: "recorded",
        actionSlugs: ["livestock.move"],
        effectiveAt: new Date(),
      });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      for (const id of [tenantA, tenantB]) {
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, id));
      }
    });
  });

  it("each person sees only their own grant, whatever their role", async () => {
    const mine = await asMate((tx) => tx.select().from(schema.deviceGrants));
    expect(mine.map((r) => r.clerkUserId)).toEqual([MATE]);
    const theirs = await asOwner((tx) => tx.select().from(schema.deviceGrants));
    expect(theirs.map((r) => r.clerkUserId)).toEqual([OWNER]);
  });

  it("another business sees nothing at all", async () => {
    const rows = await asOutsider((tx) => tx.select().from(schema.deviceGrants));
    expect(rows).toHaveLength(0);
  });

  it("an owner cannot revoke a colleague's phone from this table", async () => {
    const updated = await asOwner((tx) =>
      tx
        .update(schema.deviceGrants)
        .set({ revokedAt: new Date() })
        .where(eq(schema.deviceGrants.id, mateGrant))
        .returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("a person cannot mint a grant as somebody else", async () => {
    await expect(
      asMate((tx) =>
        tx.insert(schema.deviceGrants).values({
          tenantId: tenantA,
          clerkUserId: OWNER,
          tokenHash: `${STAMP}-forged`,
          platform: "android",
          label: "Forged",
          expiresAt: soon(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("a grant is revoked, never deleted — there is no DELETE policy", async () => {
    const deleted = await asOwner((tx) =>
      tx.delete(schema.deviceGrants).where(eq(schema.deviceGrants.id, ownerGrant)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("its own holder can revoke it, and slide its expiry", async () => {
    const slid = await asMate((tx) =>
      tx
        .update(schema.deviceGrants)
        .set({ lastUsedAt: new Date(), expiresAt: soon() })
        .where(eq(schema.deviceGrants.id, mateGrant))
        .returning(),
    );
    expect(slid).toHaveLength(1);
  });

  it("forgetting the user id denies rather than widens", async () => {
    const rows = await withTenant(tenantA, (tx) => tx.select().from(schema.deviceGrants), {
      role: "owner",
    });
    expect(rows).toHaveLength(0);
  });

  it("one token hash exists once across the whole platform", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.deviceGrants).values({
          tenantId: tenantB,
          clerkUserId: OUTSIDER,
          tokenHash: `${STAMP}-mate-hash`,
          platform: "ios",
          label: "Collision",
          expiresAt: soon(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("a use belongs to its own person, and to nobody else", async () => {
    const mine = await asMate((tx) => tx.select().from(schema.deviceGrantUses));
    expect(mine).toHaveLength(1);
    const theirs = await asOwner((tx) => tx.select().from(schema.deviceGrantUses));
    expect(theirs).toHaveLength(0);
  });

  it("a use is append-only: no update, no delete, by anybody", async () => {
    const updated = await asMate((tx) =>
      tx
        .update(schema.deviceGrantUses)
        .set({ outcome: "refused" })
        .where(eq(schema.deviceGrantUses.grantId, mateGrant))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await asMate((tx) =>
      tx
        .delete(schema.deviceGrantUses)
        .where(eq(schema.deviceGrantUses.grantId, mateGrant))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("the same sentence cannot be recorded twice against one grant", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.deviceGrantUses).values({
          tenantId: tenantA,
          grantId: mateGrant,
          clerkUserId: MATE,
          idempotencyKey: `${STAMP}-mate-use`,
          outcome: "recorded",
          actionSlugs: [],
          effectiveAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });
});
