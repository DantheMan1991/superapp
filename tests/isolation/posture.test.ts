import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * A POSTURE CHECK IS AN ORDINARY TENANT ROW (docs/modules/posture.md, slice 3;
 * ADR 0120). `fitness_posture_checks` only ever holds rows in a personal space,
 * but to the database a personal space is a tenant like any other (ADR 0111),
 * so this proves what core.test.ts proves for every pair: two people's spaces,
 * each with a check, and neither can read, change, delete or plant the other's.
 * With no tenant context at all, nothing is visible (FORCE RLS).
 */

const STAMP = `iso-posture-${process.pid}`;

let a: string;
let b: string;
let aCheck: string;

const CAPTURES = [
  {
    view: "front" as const,
    round: 1,
    up: { x: 0, y: -1 },
    upFrom: "plumb" as const,
    pxPerMetre: 900,
    width: 1080,
    height: 1920,
    stickers: { "right-shoulder": { x: 400, y: 505 } },
    pose: null,
    frames: 12,
    stillPx: 0.5,
  },
];

async function names(err: Promise<unknown>): Promise<string> {
  try {
    await err;
    return "";
  } catch (e) {
    const x = e as { message?: string; cause?: { message?: string } };
    return `${x?.message ?? ""} ${x?.cause?.message ?? ""}`;
  }
}

d("posture checks (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [ta, tb] = await tx
        .insert(schema.tenants)
        .values(
          ["a", "b"].map((x) => ({
            clerkOrgId: `${STAMP}-${x}`,
            name: "Personal",
            slug: `${STAMP}-${x}`,
            kind: "personal" as const,
            personalOwnerClerkUserId: `user_isopos${x}${process.pid}`,
          })),
        )
        .returning();
      a = ta.id;
      b = tb.id;
      const [row] = await tx
        .insert(schema.fitnessPostureChecks)
        .values({
          id: crypto.randomUUID(),
          tenantId: a,
          takenAt: new Date(),
          localDay: "2026-10-01",
          captures: CAPTURES,
        })
        .returning();
      aCheck = row.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [a, b])));
  });

  it("A reads its own check", async () => {
    const seen = await withTenant(a, (tx) => tx.select({ id: schema.fitnessPostureChecks.id }).from(schema.fitnessPostureChecks));
    expect(seen.map((r) => r.id)).toEqual([aCheck]);
  });

  it("B cannot read A's check, even by id", async () => {
    const seen = await withTenant(b, (tx) =>
      tx.select().from(schema.fitnessPostureChecks).where(eq(schema.fitnessPostureChecks.id, aCheck)),
    );
    expect(seen).toHaveLength(0);
  });

  it("B cannot change or delete A's check", async () => {
    const changed = await withTenant(b, async (tx) => [
      ...(await tx
        .update(schema.fitnessPostureChecks)
        .set({ notes: ["taken"] })
        .where(eq(schema.fitnessPostureChecks.id, aCheck))
        .returning()),
      ...(await tx.delete(schema.fitnessPostureChecks).where(eq(schema.fitnessPostureChecks.id, aCheck)).returning()),
    ]);
    expect(changed).toHaveLength(0);
    const [row] = await withSystem((tx) =>
      tx.select({ notes: schema.fitnessPostureChecks.notes }).from(schema.fitnessPostureChecks).where(eq(schema.fitnessPostureChecks.id, aCheck)),
    );
    expect(row.notes).toEqual([]);
  });

  it("B cannot write a check claiming to be A's", async () => {
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessPostureChecks).values({
            id: crypto.randomUUID(),
            tenantId: a,
            takenAt: new Date(),
            localDay: "2026-10-01",
            captures: CAPTURES,
          }),
        ),
      ),
    ).not.toBe("");
  });

  it("B cannot hang a repeat of its own off A's check: the composite key refuses it", async () => {
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessPostureChecks).values({
            id: crypto.randomUUID(),
            tenantId: b,
            takenAt: new Date(),
            localDay: "2026-10-01",
            captures: CAPTURES,
            repeatOf: aCheck,
          }),
        ),
      ),
    ).toContain("fitness_posture_checks_repeat_fk");
  });

  it("nobody sees a check without a tenant context (FORCE RLS)", async () => {
    // The core suite's way: a transaction whose context is wiped, as a forgotten wrapper would leave it.
    const seen = await withSystem(async (tx) => {
      await tx.execute(sql`select set_config('app.role', '', true)`);
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      return tx.select().from(schema.fitnessPostureChecks).where(eq(schema.fitnessPostureChecks.id, aCheck));
    });
    expect(seen).toHaveLength(0);
  });
});
