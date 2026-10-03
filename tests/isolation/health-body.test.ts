import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * HEALTH'S BODY TABLES ARE ORDINARY TENANT TABLES (docs/modules/health.md,
 * H2): weigh-ins, the goal weight, the person's own tape measures and the days
 * each was taken.
 *
 * As for H1's tables (`health.test.ts`): neither person can read, change or
 * delete the other's rows, nor write one into the other's space, and a day's
 * measurement cannot point at another space's tape measure (the composite key).
 */

const STAMP = `iso-health-body-${process.pid}`;

let a: string;
let b: string;
const ids = { weighin: "", measure: "", measurement: "" };

d("health body tables (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [ta] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-a`,
          name: "Personal",
          slug: `${STAMP}-a`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isobodya${process.pid}`,
        })
        .returning();
      const [tb] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-b`,
          name: "Personal",
          slug: `${STAMP}-b`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isobodyb${process.pid}`,
        })
        .returning();
      a = ta.id;
      b = tb.id;
      const [weighin] = await tx
        .insert(schema.healthWeighins)
        .values({ tenantId: a, weighedOn: "2026-10-03", kg: 83.7, createdByClerkUserId: `user_isobodya${process.pid}` })
        .returning();
      await tx.insert(schema.healthWeightGoals).values({ tenantId: a, goalKg: 79.4, paceKg: 0.45 });
      const [measure] = await tx.insert(schema.healthMeasures).values({ tenantId: a, name: "Waist", better: "smaller", position: 0 }).returning();
      const [measurement] = await tx
        .insert(schema.healthMeasurements)
        .values({ tenantId: a, measureId: measure.id, measuredOn: "2026-10-03", cm: 92.7 })
        .returning();
      Object.assign(ids, { weighin: weighin.id, measure: measure.id, measurement: measurement.id });
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [a, b])));
  });

  it("A reads its own weigh-in, goal, tape measure and measurement", async () => {
    const seen = await withTenant(a, async (tx) => ({
      weighins: await tx.select({ id: schema.healthWeighins.id }).from(schema.healthWeighins),
      goals: await tx.select({ goalKg: schema.healthWeightGoals.goalKg }).from(schema.healthWeightGoals),
      measures: await tx.select({ id: schema.healthMeasures.id }).from(schema.healthMeasures),
      measurements: await tx.select({ id: schema.healthMeasurements.id }).from(schema.healthMeasurements),
    }));
    expect(seen).toEqual({
      weighins: [{ id: ids.weighin }],
      goals: [{ goalKg: 79.4 }],
      measures: [{ id: ids.measure }],
      measurements: [{ id: ids.measurement }],
    });
  });

  it("B cannot read any of A's rows, even by id", async () => {
    const seen = await withTenant(b, async (tx) => [
      ...(await tx.select().from(schema.healthWeighins).where(eq(schema.healthWeighins.id, ids.weighin))),
      ...(await tx.select().from(schema.healthWeightGoals).where(eq(schema.healthWeightGoals.tenantId, a))),
      ...(await tx.select().from(schema.healthMeasures).where(eq(schema.healthMeasures.id, ids.measure))),
      ...(await tx.select().from(schema.healthMeasurements).where(eq(schema.healthMeasurements.id, ids.measurement))),
    ]);
    expect(seen).toHaveLength(0);
  });

  it("B cannot change or delete A's rows", async () => {
    const changed = await withTenant(b, async (tx) => [
      ...(await tx.update(schema.healthWeighins).set({ kg: 50 }).where(eq(schema.healthWeighins.id, ids.weighin)).returning()),
      ...(await tx.update(schema.healthWeightGoals).set({ goalKg: 50 }).where(eq(schema.healthWeightGoals.tenantId, a)).returning()),
      ...(await tx.update(schema.healthMeasures).set({ name: "Taken" }).where(eq(schema.healthMeasures.id, ids.measure)).returning()),
      ...(await tx.update(schema.healthMeasurements).set({ cm: 10 }).where(eq(schema.healthMeasurements.id, ids.measurement)).returning()),
      ...(await tx.delete(schema.healthMeasurements).where(eq(schema.healthMeasurements.id, ids.measurement)).returning()),
      ...(await tx.delete(schema.healthMeasures).where(eq(schema.healthMeasures.id, ids.measure)).returning()),
      ...(await tx.delete(schema.healthWeightGoals).where(eq(schema.healthWeightGoals.tenantId, a)).returning()),
      ...(await tx.delete(schema.healthWeighins).where(eq(schema.healthWeighins.id, ids.weighin)).returning()),
    ]);
    expect(changed).toHaveLength(0);
    const kept = await withSystem(async (tx) => ({
      weighin: await tx.select({ kg: schema.healthWeighins.kg }).from(schema.healthWeighins).where(eq(schema.healthWeighins.id, ids.weighin)),
      goal: await tx.select({ goalKg: schema.healthWeightGoals.goalKg }).from(schema.healthWeightGoals).where(eq(schema.healthWeightGoals.tenantId, a)),
      measure: await tx.select({ name: schema.healthMeasures.name }).from(schema.healthMeasures).where(eq(schema.healthMeasures.id, ids.measure)),
      measurement: await tx.select({ cm: schema.healthMeasurements.cm }).from(schema.healthMeasurements).where(eq(schema.healthMeasurements.id, ids.measurement)),
    }));
    expect(kept).toEqual({
      weighin: [{ kg: 83.7 }],
      goal: [{ goalKg: 79.4 }],
      measure: [{ name: "Waist" }],
      measurement: [{ cm: 92.7 }],
    });
  });

  it("B cannot write a row into A's space", async () => {
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.healthWeighins).values({ tenantId: a, weighedOn: "2026-10-02", kg: 80, createdByClerkUserId: "user_planted" }),
      ),
    ).rejects.toThrow();
    // A's goal row exists, so B's insert would be refused by the key anyway: write one for a space without one.
    await withSystem((tx) => tx.delete(schema.healthWeightGoals).where(eq(schema.healthWeightGoals.tenantId, a)));
    try {
      await expect(withTenant(b, (tx) => tx.insert(schema.healthWeightGoals).values({ tenantId: a, goalKg: 70, paceKg: 0.5 }))).rejects.toThrow();
    } finally {
      await withSystem((tx) => tx.insert(schema.healthWeightGoals).values({ tenantId: a, goalKg: 79.4, paceKg: 0.45 }));
    }
    await expect(
      withTenant(b, (tx) => tx.insert(schema.healthMeasures).values({ tenantId: a, name: "Planted", position: 1 })),
    ).rejects.toThrow();
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.healthMeasurements).values({ tenantId: a, measureId: ids.measure, measuredOn: "2026-10-02", cm: 90 }),
      ),
    ).rejects.toThrow();
  });

  it("a measurement cannot point at another space's tape measure", async () => {
    // B's own row, aimed at A's measure: the composite key refuses it.
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.healthMeasurements).values({ tenantId: b, measureId: ids.measure, measuredOn: "2026-10-03", cm: 90 }),
      ),
    ).rejects.toThrow();
  });

  it("with no tenant at all, nothing is visible", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", async (tx) => [
      ...(await tx.select().from(schema.healthWeighins)),
      ...(await tx.select().from(schema.healthWeightGoals)),
      ...(await tx.select().from(schema.healthMeasures)),
      ...(await tx.select().from(schema.healthMeasurements)),
    ]);
    expect(seen).toHaveLength(0);
  });
});
