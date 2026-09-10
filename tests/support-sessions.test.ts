import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, schema } from "../src/db";
import {
  endSupportSession,
  liveSupportSession,
  openSupportSession,
  recordSupportView,
} from "../src/lib/support-view";

/**
 * Support sessions (back-office slice 4): one live per person, opening ends
 * the last, expiry and ending both make it not-live, and a view is counted
 * and audited.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `support-test-${process.pid}`;
const USER = `${STAMP}-user`;

let tenant: string;

d("support sessions", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-org`, name: "Support Client", slug: `${STAMP}-org` })
        .returning({ id: schema.tenants.id });
      tenant = t.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // The audit rows stay: audit_log is append-only by trigger, and the
      // actor is a test id nobody will mistake for a person.
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant));
    });
  });

  it("opens a session that is live, and opening again ends the last", async () => {
    const first = await openSupportSession({ tenantId: tenant, clerkUserId: USER, reason: "first" });
    expect((await liveSupportSession(USER))?.id).toBe(first.id);
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);

    const second = await openSupportSession({ tenantId: tenant, clerkUserId: USER, reason: "second" });
    expect((await liveSupportSession(USER))?.id).toBe(second.id);
    const [ended] = await withSystem((tx) =>
      tx
        .select({ endedAt: schema.supportSessions.endedAt })
        .from(schema.supportSessions)
        .where(eq(schema.supportSessions.id, first.id)),
    );
    expect(ended.endedAt).not.toBeNull();
  });

  it("a view is counted and audited with its path", async () => {
    const live = await liveSupportSession(USER);
    await recordSupportView({ sessionId: live!.id, tenantId: tenant, clerkUserId: USER, path: "/dashboard/m/accounting" });
    await recordSupportView({ sessionId: live!.id, tenantId: tenant, clerkUserId: USER, path: "/dashboard" });
    const [row] = await withSystem((tx) =>
      tx
        .select({ views: schema.supportSessions.viewCount, last: schema.supportSessions.lastViewedAt })
        .from(schema.supportSessions)
        .where(eq(schema.supportSessions.id, live!.id)),
    );
    expect(row.views).toBe(2);
    expect(row.last).not.toBeNull();
    const audits = await withSystem((tx) =>
      tx
        .select({ meta: schema.auditLog.meta })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.targetId, live!.id)),
    );
    expect(audits.map((a) => (a.meta as { path: string }).path).sort()).toEqual([
      "/dashboard",
      "/dashboard/m/accounting",
    ]);
  });

  it("ending makes it not-live, and expiry does too", async () => {
    const ended = await endSupportSession(USER);
    expect(ended).not.toBeNull();
    expect(await liveSupportSession(USER)).toBeNull();
    expect(await endSupportSession(USER)).toBeNull();

    const expired = await openSupportSession({ tenantId: tenant, clerkUserId: USER, reason: "expired" });
    await withSystem((tx) =>
      tx
        .update(schema.supportSessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.supportSessions.id, expired.id)),
    );
    expect(await liveSupportSession(USER)).toBeNull();
    // The expired row is unended and still blocks nothing: opening ends it.
    const next = await openSupportSession({ tenantId: tenant, clerkUserId: USER, reason: "next" });
    expect((await liveSupportSession(USER))?.id).toBe(next.id);
    await endSupportSession(USER);
  });
});
