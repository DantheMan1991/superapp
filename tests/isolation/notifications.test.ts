import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

d("notification tables (RLS)", () => {
  const STAMP3 = `iso-notif-${process.pid}`;
  let tenantA: string;
  let tenantB: string;
  let profileMe: string;
  let profileColleague: string;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP3}-a`, name: "Notif A", slug: `${STAMP3}-a` },
          { clerkOrgId: `${STAMP3}-b`, name: "Notif B", slug: `${STAMP3}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const profiles = await tx
        .insert(schema.profiles)
        .values([
          { clerkUserId: `${STAMP3}-me`, email: `${STAMP3}-me@example.test` },
          { clerkUserId: `${STAMP3}-you`, email: `${STAMP3}-you@example.test` },
        ])
        .returning();
      profileMe = profiles[0].id;
      profileColleague = profiles[1].id;

      await tx.insert(schema.memberships).values([
        { tenantId: tenantA, profileId: profileMe, role: "staff" },
        { tenantId: tenantA, profileId: profileColleague, role: "staff" },
      ]);
      await tx.insert(schema.notificationPreferences).values([
        { tenantId: tenantA, profileId: profileMe, digest: "daily" },
        { tenantId: tenantA, profileId: profileColleague, digest: "daily" },
      ]);
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.profiles)
        .where(sql`${schema.profiles.clerkUserId} like ${`${STAMP3}%`}`);
    });
  });

  it("you can read your OWN preference and only yours", async () => {
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.notificationPreferences),
      { role: "staff", userId: `${STAMP3}-me` },
    );
    // Deliberately unscoped select — the policy is what narrows it to one row.
    expect(rows).toHaveLength(1);
    expect(rows[0].profileId).toBe(profileMe);
  });

  it("you cannot UPDATE a colleague's preference (0 rows)", async () => {
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.notificationPreferences)
          .set({ digest: "off" })
          .where(eq(schema.notificationPreferences.profileId, profileColleague))
          .returning(),
      { role: "staff", userId: `${STAMP3}-me` },
    );
    expect(updated).toHaveLength(0);

    const after = await withSystem((tx) =>
      tx
        .select({ digest: schema.notificationPreferences.digest })
        .from(schema.notificationPreferences)
        .where(eq(schema.notificationPreferences.profileId, profileColleague)),
    );
    expect(after[0].digest).toBe("daily");
  });

  it("an OWNER cannot switch a staff member's digest off either", async () => {
    // Not a tenant-scoped setting. Being the owner does not make somebody
    // else's notification preferences yours to change.
    const updated = await withTenant(
      tenantA,
      (tx) =>
        tx
          .update(schema.notificationPreferences)
          .set({ digest: "off" })
          .where(eq(schema.notificationPreferences.profileId, profileColleague))
          .returning(),
      { role: "owner", userId: `${STAMP3}-me` },
    );
    expect(updated).toHaveLength(0);
  });

  it("you cannot INSERT a preference row for somebody else", async () => {
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx
            .insert(schema.notificationPreferences)
            .values({
              tenantId: tenantA,
              profileId: profileColleague,
              digest: "off",
            })
            .returning(),
        { role: "staff", userId: `${STAMP3}-me` },
      ),
    ).rejects.toThrow();
  });

  it("forgetting userId denies the read rather than widening it", async () => {
    // app_current_user() returns NULL, which matches no profile. The direction
    // every per-person policy in this codebase must fail in.
    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.notificationPreferences),
      { role: "owner" },
    );
    expect(rows).toHaveLength(0);
  });

  it("the digest log is invisible to tenant context entirely", async () => {
    await withSystem((tx) =>
      tx.insert(schema.notificationDigestLog).values({
        tenantId: tenantA,
        profileId: profileMe,
        localDate: "2026-08-06",
        itemCount: 3,
        itemKeys: ["crm_task:x", "invoice:y", "bill:z"],
      }),
    );

    const rows = await withTenant(
      tenantA,
      (tx) => tx.select().from(schema.notificationDigestLog),
      { role: "owner", userId: `${STAMP3}-me` },
    );
    expect(rows).toHaveLength(0);

    // And it cannot be written from tenant context either.
    await expect(
      withTenant(
        tenantA,
        (tx) =>
          tx
            .insert(schema.notificationDigestLog)
            .values({
              tenantId: tenantA,
              profileId: profileMe,
              localDate: "2026-08-07",
            })
            .returning(),
        { role: "owner", userId: `${STAMP3}-me` },
      ),
    ).rejects.toThrow();
  });

  it("the log's unique index is what makes a second send a no-op", async () => {
    const first = await withSystem((tx) =>
      tx
        .insert(schema.notificationDigestLog)
        .values({
          tenantId: tenantB,
          profileId: profileMe,
          localDate: "2026-08-06",
          itemCount: 1,
        })
        .onConflictDoNothing({
          target: [
            schema.notificationDigestLog.tenantId,
            schema.notificationDigestLog.profileId,
            schema.notificationDigestLog.localDate,
          ],
        })
        .returning(),
    );
    expect(first).toHaveLength(1);

    const second = await withSystem((tx) =>
      tx
        .insert(schema.notificationDigestLog)
        .values({
          tenantId: tenantB,
          profileId: profileMe,
          localDate: "2026-08-06",
          itemCount: 99,
        })
        .onConflictDoNothing({
          target: [
            schema.notificationDigestLog.tenantId,
            schema.notificationDigestLog.profileId,
            schema.notificationDigestLog.localDate,
          ],
        })
        .returning(),
    );
    expect(second).toHaveLength(0);
  });
});
