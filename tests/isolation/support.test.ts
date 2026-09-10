import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * `support_sessions` (back-office slice 4) is platform-level and
 * superadmin-only: a client's members see nothing of who has looked at their
 * workspace, and cannot write a session for themselves.
 */
const STAMP = `iso-support-${process.pid}`;

d("support-session isolation (RLS, superadmin only)", () => {
  let tenantId: string;
  let sessionId: string;

  beforeAll(async () => {
    [tenantId, sessionId] = await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Support Iso", slug: STAMP })
        .returning();
      const [s] = await tx
        .insert(schema.supportSessions)
        .values({
          tenantId: t.id,
          clerkUserId: `${STAMP}-admin`,
          reason: "isolation",
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning();
      return [t.id, s.id];
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("the workspace's own members see no session about them", async () => {
    const rows = await withTenant(
      tenantId,
      (tx) => tx.select().from(schema.supportSessions),
      { role: "owner" },
    );
    expect(rows).toHaveLength(0);
  });

  it("members cannot write one, and cannot end one", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.supportSessions).values({
          tenantId,
          clerkUserId: "forged",
          reason: "forged",
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    ).rejects.toThrow();
    const ended = await withTenant(tenantId, (tx) =>
      tx
        .update(schema.supportSessions)
        .set({ endedAt: new Date() })
        .where(eq(schema.supportSessions.id, sessionId))
        .returning(),
    );
    expect(ended).toHaveLength(0);
  });

  it("no context at all sees nothing; the superadmin sees it", async () => {
    const none = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.supportSessions).where(eq(schema.supportSessions.id, sessionId));
    });
    expect(none).toHaveLength(0);
    const mine = await withSystem((tx) =>
      tx.select().from(schema.supportSessions).where(eq(schema.supportSessions.id, sessionId)),
    );
    expect(mine).toHaveLength(1);
  });
});
