import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import { creditHourBlockFromSession } from "../src/lib/retainer-billing";
import { loadRetainerView } from "../src/lib/retainer";

/**
 * Hour-block credit path: idempotent, distrustful of metadata, and only
 * ever additive from a paid session. Needs DATABASE_URL (dev DB).
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const STAMP = `retainer-billing-${process.pid}`;
let tenantId: string;

function paidSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    payment_status: "paid",
    amount_total: 50_000,
    metadata: { tenantId, kind: "hour_block", blockKey: "five_hours" },
    ...overrides,
  } as Parameters<typeof creditHourBlockFromSession>[0];
}

d("hour-block credits", () => {
  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: STAMP, slug: STAMP }])
        .returning();
      return rows[0].id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("credits a paid session exactly once, even when re-delivered", async () => {
    const first = await creditHourBlockFromSession(
      paidSession(`cs_test_${STAMP}_1`),
    );
    expect(first.credited).toBe(true);

    const replay = await creditHourBlockFromSession(
      paidSession(`cs_test_${STAMP}_1`),
    );
    expect(replay.credited).toBe(false);

    const rows = await withSystem((tx) =>
      tx.query.retainerPurchases.findMany({
        where: eq(schema.retainerPurchases.tenantId, tenantId),
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].minutes).toBe(300); // from HOUR_BLOCKS, not metadata
    expect(rows[0].amountCents).toBe(50_000);
    expect(rows[0].blockKey).toBe("five_hours");

    // The credit shows up in the derived balance under the tenant's own view.
    const view = await withTenant(tenantId, (tx) =>
      loadRetainerView(tx, tenantId),
    );
    expect(view.usage.purchasedMinutesTotal).toBe(300);
    expect(view.hasAnyData).toBe(true);
  });

  it("rejects an unknown blockKey (minutes can't be forged)", async () => {
    const res = await creditHourBlockFromSession(
      paidSession(`cs_test_${STAMP}_2`, {
        metadata: { tenantId, kind: "hour_block", blockKey: "nine_thousand_hours" },
      }),
    );
    expect(res.credited).toBe(false);
  });

  it("rejects malformed or foreign metadata", async () => {
    const noKind = await creditHourBlockFromSession(
      paidSession(`cs_test_${STAMP}_3`, {
        metadata: { tenantId, blockKey: "five_hours" },
      }),
    );
    expect(noKind.credited).toBe(false);

    const badTenant = await creditHourBlockFromSession(
      paidSession(`cs_test_${STAMP}_4`, {
        metadata: { tenantId: "not-a-uuid", kind: "hour_block", blockKey: "five_hours" },
      }),
    );
    expect(badTenant.credited).toBe(false);
  });

  it("rejects an unpaid session", async () => {
    const res = await creditHourBlockFromSession(
      paidSession(`cs_test_${STAMP}_5`, { payment_status: "unpaid" }),
    );
    expect(res.credited).toBe(false);

    const rows = await withSystem((tx) =>
      tx.query.retainerPurchases.findMany({
        where: eq(schema.retainerPurchases.tenantId, tenantId),
      }),
    );
    expect(rows).toHaveLength(1); // still only the first credit
  });
});
