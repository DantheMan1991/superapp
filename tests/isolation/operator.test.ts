import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d, seedParty } from "./_shared";

/**
 * The operator tenant (ADR 0041) is an ORDINARY tenant to the database.
 *
 * This file is what keeps it that way. It flags one of two tenants as the
 * operator and proves the same things core.test.ts proves for any pair —
 * nothing about it is special except the flag, and the flag itself is out of
 * a member's reach. If this file ever needs an exception for the operator,
 * the boundary has leaked; that is the invariant (security.md S13), not a
 * limitation of the test.
 */

const STAMP = `iso-operator-${process.pid}`;

/**
 * Whether an error names a constraint. Checked on the message AND the cause,
 * because the driver's error may arrive wrapped by the query builder, and a
 * test that only knew one shape would go green or red with a dependency bump.
 */
function names(err: unknown, needle: string): boolean {
  const e = err as { message?: string; cause?: { message?: string } };
  return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`.includes(needle);
}

let operator: string;
let client: string;

d("the operator tenant is an ordinary tenant (RLS)", () => {
  beforeAll(async () => {
    [operator, client] = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([
          {
            clerkOrgId: `${STAMP}-op`,
            name: "Isolation Operator",
            slug: `${STAMP}-op`,
            isOperator: true,
          },
          {
            clerkOrgId: `${STAMP}-c`,
            name: "Isolation Client",
            slug: `${STAMP}-c`,
          },
        ])
        .returning();
      return [rows[0].id, rows[1].id];
    });
    await withSystem(async (tx) => {
      await seedParty(tx, operator, "The operator's own party");
      await seedParty(tx, client, "The client's own party");
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, operator));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, client));
    });
  });

  it("a database holds at most one operator — a second is refused by the index", async () => {
    let thrown: unknown = null;
    try {
      await withSystem((tx) =>
        tx
          .update(schema.tenants)
          .set({ isOperator: true })
          .where(eq(schema.tenants.id, client)),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(names(thrown, "tenants_operator_idx")).toBe(true);

    const [row] = await withSystem((tx) =>
      tx
        .select({ isOperator: schema.tenants.isOperator })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, client)),
    );
    expect(row.isOperator).toBe(false);
  });

  it("a member cannot write the flag — from inside the operator or from outside it", async () => {
    // `tenants` is SELECT-only for members (0001); this column inherits that
    // and the test says so, because the flag is what the console trusts.
    const fromInside = await withTenant(operator, (tx) =>
      tx
        .update(schema.tenants)
        .set({ isOperator: false })
        .where(eq(schema.tenants.id, operator))
        .returning(),
    );
    expect(fromInside).toHaveLength(0);

    const fromOutside = await withTenant(client, (tx) =>
      tx
        .update(schema.tenants)
        .set({ isOperator: true })
        .where(eq(schema.tenants.id, client))
        .returning(),
    );
    expect(fromOutside).toHaveLength(0);

    const flags = await withSystem((tx) =>
      tx
        .select({ id: schema.tenants.id, isOperator: schema.tenants.isOperator })
        .from(schema.tenants)
        .where(inArray(schema.tenants.id, [operator, client])),
    );
    expect(Object.fromEntries(flags.map((f) => [f.id, f.isOperator]))).toEqual({
      [operator]: true,
      [client]: false,
    });
  });

  it("each side sees only its own rows, and neither sees the other in `tenants`", async () => {
    const operatorParties = await withTenant(operator, (tx) =>
      tx.select().from(schema.parties),
    );
    expect(operatorParties.length).toBeGreaterThan(0);
    expect(operatorParties.every((p) => p.tenantId === operator)).toBe(true);

    const clientParties = await withTenant(client, (tx) =>
      tx.select().from(schema.parties),
    );
    expect(clientParties.length).toBeGreaterThan(0);
    expect(clientParties.every((p) => p.tenantId === client)).toBe(true);

    const seenByClient = await withTenant(client, (tx) =>
      tx.select({ id: schema.tenants.id }).from(schema.tenants),
    );
    expect(seenByClient.map((t) => t.id)).toEqual([client]);

    const seenByOperator = await withTenant(operator, (tx) =>
      tx.select({ id: schema.tenants.id }).from(schema.tenants),
    );
    expect(seenByOperator.map((t) => t.id)).toEqual([operator]);
  });

  it("the operator cannot reach a client's rows by direct filter", async () => {
    const rows = await withTenant(operator, (tx) =>
      tx.select().from(schema.parties).where(eq(schema.parties.tenantId, client)),
    );
    expect(rows).toHaveLength(0);
  });
});
