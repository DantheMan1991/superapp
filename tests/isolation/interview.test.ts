import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

const STAMP_IV = `iso-interview-${process.pid}`;

d("interview-session isolation (RLS, superadmin only)", () => {
  let tenantId: string;
  let sessionId: string;

  beforeAll(async () => {
    [tenantId, sessionId] = await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP_IV, name: "Iv Iso", slug: STAMP_IV }])
        .returning();
      const [s] = await tx
        .insert(schema.interviewSessions)
        .values({
          ipHash: `hash-${STAMP_IV}`,
          messages: [{ role: "assistant", content: "secret prospect opener" }],
        })
        .returning();
      return [t.id, s.id];
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx
        .delete(schema.interviewSessions)
        .where(eq(schema.interviewSessions.id, sessionId));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("tenant members see zero interview sessions", async () => {
    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(schema.interviewSessions),
    );
    expect(rows).toHaveLength(0);
  });

  it("tenant members cannot insert or update interview sessions", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        tx.insert(schema.interviewSessions).values({ ipHash: "forged" }),
      ),
    ).rejects.toThrow();
    const updated = await withTenant(tenantId, (tx) =>
      tx
        .update(schema.interviewSessions)
        .set({ state: "expired" })
        .where(eq(schema.interviewSessions.id, sessionId))
        .returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("default-deny: no context sees no sessions; audits.source backfilled", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.interviewSessions);
    });
    expect(rows).toHaveLength(0);

    // Pre-existing audits read back the 'founder' default.
    const audit = await withSystem((tx) =>
      tx.query.audits.findFirst(),
    );
    if (audit) expect(["founder", "self_serve"]).toContain(audit.source);
  });
});
