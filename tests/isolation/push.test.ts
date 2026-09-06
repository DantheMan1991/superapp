import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * push_devices (RLS) — a phone belongs to a PERSON, not a business, so the
 * table is not tenant-scoped; the only rule is "your own rows and nobody
 * else's", through app_current_user(). No tier of membership reaches somebody
 * else's phone in either direction, and forgetting the user id denies rather
 * than widens.
 */
d("push_devices (RLS)", () => {
  const STAMP = `iso-push-${process.pid}-${Date.now()}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  let tenantA: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asMate = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [a] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `org_${STAMP}`, name: `Push ${STAMP}`, slug: STAMP })
        .returning();
      tenantA = a.id;
      await tx.insert(schema.pushDevices).values([
        { clerkUserId: OWNER, platform: "ios", token: `${STAMP}-owner-phone` },
        { clerkUserId: MATE, platform: "android", token: `${STAMP}-mate-phone` },
      ]);
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      for (const user of [OWNER, MATE]) {
        await tx.delete(schema.pushDevices).where(eq(schema.pushDevices.clerkUserId, user));
      }
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
    });
  });

  it("each person sees only their own phone, whatever their role", async () => {
    const mine = await asMate((tx) => tx.select().from(schema.pushDevices));
    expect(mine.map((r) => r.clerkUserId)).toEqual([MATE]);
    const owners = await asOwner((tx) => tx.select().from(schema.pushDevices));
    expect(owners.map((r) => r.clerkUserId)).toEqual([OWNER]);
  });

  it("an owner cannot disable or delete somebody else's phone", async () => {
    const updated = await asOwner((tx) =>
      tx
        .update(schema.pushDevices)
        .set({ disabledAt: new Date() })
        .where(eq(schema.pushDevices.clerkUserId, MATE))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await asOwner((tx) =>
      tx.delete(schema.pushDevices).where(eq(schema.pushDevices.clerkUserId, MATE)).returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("a person cannot register a phone as somebody else", async () => {
    await expect(
      asMate((tx) =>
        tx.insert(schema.pushDevices).values({
          clerkUserId: OWNER,
          platform: "android",
          token: `${STAMP}-forged`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("forgetting the user id denies rather than widens", async () => {
    const rows = await withTenant(tenantA, (tx) => tx.select().from(schema.pushDevices), {
      role: "owner",
    });
    expect(rows).toHaveLength(0);
  });

  it("one token exists once, whoever holds the phone", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.pushDevices).values({
          clerkUserId: OWNER,
          platform: "android",
          token: `${STAMP}-mate-phone`,
        }),
      ),
    ).rejects.toThrow();
  });

  it("the system view, which the sender uses, sees every phone", async () => {
    const rows = await withSystem((tx) =>
      tx.select().from(schema.pushDevices).where(eq(schema.pushDevices.clerkUserId, MATE)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].disabledAt).toBeNull();
  });
});
