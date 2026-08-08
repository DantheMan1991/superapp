import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

const STAMP_CLOSE = `iso-close-${process.pid}`;

interface CloseFixture {
  closeId: string;
  noteId: string;
  membershipId: string;
}

d("close-tools isolation (RLS + composite tenant FKs)", () => {
  let tenantA: string;
  let tenantB: string;
  const fx: Record<string, CloseFixture> = {};

  async function seedClose(tenantId: string, tag: string): Promise<CloseFixture> {
    // Membership rows are created under withSystem (webhook-sync precedent).
    const membershipId = await withSystem(async (tx) => {
      const [profile] = await tx
        .insert(schema.profiles)
        .values({ clerkUserId: `${STAMP_CLOSE}-${tag}`, email: `${STAMP_CLOSE}-${tag}@x.test` })
        .returning();
      const [m] = await tx
        .insert(schema.memberships)
        .values({ tenantId, profileId: profile.id, role: "staff" })
        .returning();
      return m.id;
    });
    return withTenant(tenantId, async (tx) => {
      const [close] = await tx
        .insert(schema.periodCloses)
        .values({
          tenantId,
          periodEnd: "2026-06-30",
          checklist: { items: [], blockerCount: 0 },
          completedByClerkUserId: `user-${tag}`,
        })
        .returning();
      const [note] = await tx
        .insert(schema.closeNotes)
        .values({ tenantId, closeId: close.id, authorClerkUserId: `user-${tag}`, body: `note ${tag}` })
        .returning();
      return { closeId: close.id, noteId: note.id, membershipId };
    });
  }

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_CLOSE}-a`, name: "Close Iso A", slug: `${STAMP_CLOSE}-a` },
          { clerkOrgId: `${STAMP_CLOSE}-b`, name: "Close Iso B", slug: `${STAMP_CLOSE}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    fx.a = await seedClose(tenantA, "A");
    fx.b = await seedClose(tenantB, "B");
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // Profiles are global rows — clean them explicitly.
      await tx.execute(
        sql`delete from profiles where clerk_user_id like ${`${STAMP_CLOSE}-%`}`,
      );
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("unscoped selects on close tables return only the tenant's rows", async () => {
    await withTenant(tenantA, async (tx) => {
      const closes = await tx.select().from(schema.periodCloses);
      expect(closes.length).toBeGreaterThan(0);
      expect(closes.every((r) => r.tenantId === tenantA)).toBe(true);
      const notes = await tx.select().from(schema.closeNotes);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((r) => r.tenantId === tenantA)).toBe(true);
    });
  });

  it("cannot INSERT close rows attributed to the other tenant", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.periodCloses).values({
          tenantId: tenantB,
          periodEnd: "2026-05-31",
          checklist: {},
          completedByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("composite FK: A's close_note cannot point at B's close", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.closeNotes).values({
          tenantId: tenantA,
          closeId: fx.b.closeId,
          authorClerkUserId: "attacker",
          body: "smuggled note",
        }),
      ),
    ).rejects.toThrow();
  });

  it("one completed close per period end (partial unique)", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.periodCloses).values({
          tenantId: tenantA,
          periodEnd: "2026-06-30",
          checklist: {},
          completedByClerkUserId: "user-A",
        }),
      ),
    ).rejects.toThrow();
  });

  it("memberships UPDATE under tenant context is scoped to the tenant", async () => {
    // In-tenant update works (the new memberships_member_update policy)…
    const own = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "expert" })
        .where(eq(schema.memberships.id, fx.a.membershipId))
        .returning(),
    );
    expect(own).toHaveLength(1);
    expect(own[0].role).toBe("expert");
    // …but cannot touch the other tenant's rows (0 rows affected).
    const cross = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "expert" })
        .where(eq(schema.memberships.id, fx.b.membershipId))
        .returning(),
    );
    expect(cross).toHaveLength(0);
  });

  it("cross-tenant UPDATE and DELETE affect zero close rows", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.periodCloses)
        .set({ status: "reopened" })
        .where(eq(schema.periodCloses.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.closeNotes)
        .where(eq(schema.closeNotes.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("default-deny: no context sees no close rows", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return Promise.all([
        tx.select().from(schema.periodCloses),
        tx.select().from(schema.closeNotes),
      ]);
    });
    for (const r of rows) expect(r).toHaveLength(0);
  });
});
