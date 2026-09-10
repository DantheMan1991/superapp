import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d, obtainOperator } from "./_shared";

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

const STAMP_AU = `iso-audits-${process.pid}`;

/**
 * Discovery records are the OPERATOR's rows since back-office slice 2 (ADR
 * 0041): scoped like every tenant table — readable and writable by the
 * operator's members, invisible to every other tenant and to no context at
 * all. The operator is obtained, not minted, for the reason operator.test.ts
 * gives.
 */
d("audits isolation (RLS, the operator's rows)", () => {
  let operator: string;
  let operatorMinted = false;
  let other: string;
  let auditId: string;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const op = await obtainOperator(tx, STAMP_AU);
      operator = op.id;
      operatorMinted = op.minted;
      const [o] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP_AU}-o`, name: "Audits Other", slug: `${STAMP_AU}-o` })
        .returning();
      other = o.id;
      const [a] = await tx
        .insert(schema.audits)
        .values({
          tenantId: operator,
          businessName: `${STAMP_AU} Co`,
          messages: [{ role: "user", content: "secret discovery" }],
        })
        .returning();
      auditId = a.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.audits).where(eq(schema.audits.id, auditId));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, other));
      if (operatorMinted) {
        await tx.delete(schema.tenants).where(eq(schema.tenants.id, operator));
      }
    });
  });

  it("the operator's members read and write it; another tenant sees nothing and changes nothing", async () => {
    const mine = await withTenant(operator, (tx) =>
      tx.select({ id: schema.audits.id }).from(schema.audits).where(eq(schema.audits.id, auditId)),
    );
    expect(mine).toHaveLength(1);

    const written = await withTenant(operator, (tx) =>
      tx
        .update(schema.audits)
        .set({ context: "seen by the operator" })
        .where(eq(schema.audits.id, auditId))
        .returning({ id: schema.audits.id }),
    );
    expect(written).toHaveLength(1);

    const theirs = await withTenant(other, (tx) =>
      tx.select({ id: schema.audits.id }).from(schema.audits).where(eq(schema.audits.id, auditId)),
    );
    expect(theirs).toHaveLength(0);

    const forged = await withTenant(other, (tx) =>
      tx
        .update(schema.audits)
        .set({ status: "report_ready" })
        .where(eq(schema.audits.id, auditId))
        .returning({ id: schema.audits.id }),
    );
    expect(forged).toHaveLength(0);
  });

  it("no context at all sees nothing", async () => {
    const rows = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select({ id: schema.audits.id }).from(schema.audits).where(eq(schema.audits.id, auditId));
    });
    expect(rows).toHaveLength(0);
  });
});

const STAMP_SI = `iso-setup-iv-${process.pid}`;

/**
 * The SETUP interview (ADR 0040) is the inward twin of the one above, and its
 * isolation is the opposite: tenant-scoped rather than superadmin-only,
 * because the person walking it is signed in and it is about THEIR business.
 * So the thing to certify is the ordinary one — one tenant's conversation is
 * invisible to another, and to nobody at all.
 */
d("setup-interview isolation (RLS, tenant-scoped)", () => {
  let tenantA: string;
  let tenantB: string;
  let interviewId: string;

  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP_SI}-a`, name: "Setup A", slug: `${STAMP_SI}-a` },
          { clerkOrgId: `${STAMP_SI}-b`, name: "Setup B", slug: `${STAMP_SI}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    interviewId = await withTenant(tenantA, async (tx) => {
      const [row] = await tx
        .insert(schema.setupInterviews)
        .values({
          tenantId: tenantA,
          startedByClerkUserId: `${STAMP_SI}-owner`,
          messages: [{ role: "assistant", content: "how is your money kept?" }],
        })
        .returning();
      return row.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("the other tenant sees none of it, and cannot write into it", async () => {
    const rows = await withTenant(tenantB, (tx) =>
      tx.select().from(schema.setupInterviews),
    );
    expect(rows).toHaveLength(0);

    const updated = await withTenant(tenantB, (tx) =>
      tx
        .update(schema.setupInterviews)
        .set({ state: "done" })
        .where(eq(schema.setupInterviews.id, interviewId))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    // And it cannot forge one against a tenant it is not in.
    await expect(
      withTenant(tenantB, (tx) =>
        tx.insert(schema.setupInterviews).values({
          tenantId: tenantA,
          startedByClerkUserId: "forged",
        }),
      ),
    ).rejects.toThrow();
  });

  it("its own tenant sees it, and nobody at all sees nothing", async () => {
    const mine = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.setupInterviews),
    );
    expect(mine).toHaveLength(1);

    const none = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.setupInterviews);
    });
    expect(none).toHaveLength(0);
  });

  it("only one conversation is active at a time", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.setupInterviews).values({
          tenantId: tenantA,
          startedByClerkUserId: `${STAMP_SI}-owner`,
        }),
      ),
    ).rejects.toThrow();
  });
});
