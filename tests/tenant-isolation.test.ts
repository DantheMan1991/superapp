import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";

/**
 * THE test that certifies the shell: two tenants, and neither can read,
 * write, or enumerate the other's rows — enforced by Postgres RLS, not app
 * code. Runs against the real database (DATABASE_URL required) and must pass
 * on every deploy.
 *
 * It also proves default-deny: with no tenant context at all, nothing is
 * visible even to the connection's own role (FORCE ROW LEVEL SECURITY).
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

if (!RUN) {
  console.warn(
    "⚠ tenant-isolation: DATABASE_URL not set — SKIPPING the most important test in the repo. " +
      "Set it (test/staging DB, never prod) and re-run.",
  );
}

const STAMP = `iso-test-${process.pid}`;
let tenantA: string;
let tenantB: string;

d("tenant isolation (RLS)", () => {
  beforeAll(async () => {
    [tenantA, tenantB] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Isolation Test A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Isolation Test B", slug: `${STAMP}-b` },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });

    await withTenant(tenantA, (tx) =>
      tx.insert(schema.helloItems).values({
        tenantId: tenantA,
        title: "secret of tenant A",
        createdByClerkUserId: "user-a",
      }),
    );
    await withTenant(tenantB, (tx) =>
      tx.insert(schema.helloItems).values({
        tenantId: tenantB,
        title: "secret of tenant B",
        createdByClerkUserId: "user-b",
      }),
    );
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  it("tenant A sees only its own rows even with an unscoped query", async () => {
    // Deliberately NO where clause — the forgotten-where-clause scenario.
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.helloItems),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it("tenant A cannot enumerate tenant B's rows by direct filter", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx
        .select()
        .from(schema.helloItems)
        .where(eq(schema.helloItems.tenantId, tenantB)),
    );
    expect(rows).toHaveLength(0);
  });

  it("tenant A cannot see tenant B in the tenants table", async () => {
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.tenants),
    );
    expect(rows.map((r) => r.id)).toEqual([tenantA]);
  });

  it("tenant A cannot INSERT rows attributed to tenant B", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(schema.helloItems).values({
          tenantId: tenantB,
          title: "smuggled row",
          createdByClerkUserId: "attacker",
        }),
      ),
    ).rejects.toThrow();
  });

  it("tenant A cannot UPDATE or DELETE tenant B's rows (0 rows affected)", async () => {
    const updated = await withTenant(tenantA, (tx) =>
      tx
        .update(schema.helloItems)
        .set({ title: "defaced" })
        .where(eq(schema.helloItems.tenantId, tenantB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withTenant(tenantA, (tx) =>
      tx
        .delete(schema.helloItems)
        .where(eq(schema.helloItems.tenantId, tenantB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);

    const stillThere = await withTenant(tenantB, (tx) =>
      tx.select().from(schema.helloItems),
    );
    expect(stillThere.some((r) => r.title === "secret of tenant B")).toBe(true);
  });

  it("tenant A cannot read tenant B's subscription or modules", async () => {
    const subs = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.subscriptions),
    );
    expect(subs.every((s) => s.tenantId === tenantA)).toBe(true);

    const mods = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.tenantModules),
    );
    expect(mods.every((m) => m.tenantId === tenantA)).toBe(true);
  });

  it("tenants can never see admin CRM notes", async () => {
    await withSystem((tx) =>
      tx.insert(schema.tenantNotes).values({
        tenantId: tenantA,
        authorClerkUserId: "admin",
        body: "private admin note",
      }),
    );
    // Even about *their own tenant*, notes are invisible to members.
    const rows = await withTenant(tenantA, (tx) =>
      tx.select().from(schema.tenantNotes),
    );
    expect(rows).toHaveLength(0);
  });

  it("no context at all → default deny (FORCE RLS catches raw access)", async () => {
    const db = await import("../src/db");
    // A transaction that never sets app.role/app.tenant_id.
    const rows = await (
      db as unknown as {
        withSystem: typeof withSystem;
      }
    ).withSystem(async (tx) => {
      // Reset context inside this tx to simulate a forgotten wrapper.
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.helloItems);
    });
    expect(rows).toHaveLength(0);
  });
});
