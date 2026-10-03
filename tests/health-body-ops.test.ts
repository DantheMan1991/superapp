import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import type { Tenant } from "../src/db/schema";
import type { TenantContext } from "../src/lib/auth";
import {
  allMeasurements,
  allWeighins,
  changeWeighin,
  clearWeightGoal,
  createMeasure,
  deleteMeasure,
  deleteWeighin,
  getWeightGoal,
  lastMeasuredOn,
  lastWeighin,
  listMeasures,
  measurementsBetween,
  saveMeasurements,
  saveWeighin,
  setWeightGoal,
  updateMeasure,
  weighinsBetween,
} from "../src/modules/health/body-ops";
import { inchesFromCm, MEASURES_MAX, poundsFromKg, weightTrend } from "../src/modules/health/core/body";
import { progressWindows, shiftDay } from "../src/modules/health/core/progress";
import { logPlunge, plungesBetween } from "../src/modules/health/log-ops";
import { dayData, ownRows, TREND_WARM_UP_DAYS } from "../src/modules/health/progress-ops";

/**
 * The body against a real database (docs/modules/health.md, H2): a weigh-in
 * once a day, changed and taken off; the goal; the person's own tape measures
 * and a day's measurements, all or nothing when one is not theirs; what Today
 * and Progress read of it; and a plunge typed in for an earlier day.
 *
 * The clock is fixed (noon in New York on 3 Oct 2026, the space's timezone) and
 * every date is that day or before it.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `health-body-${process.pid}`;
const NOW = new Date("2026-10-03T16:00:00Z");
const TODAY = "2026-10-03";

let tenant: Tenant;
let ctx: TenantContext;

function inTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(tenant.id, fn, { role: "owner" });
}

const pounds = (kg: number) => Math.round(poundsFromKg(kg) * 10) / 10;
const inches = (cm: number) => Math.round(inchesFromCm(cm) * 100) / 100;

d("health body (db)", () => {
  beforeAll(async () => {
    tenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Personal",
          slug: `${STAMP}-slug`,
          kind: "personal",
          personalOwnerClerkUserId: `user_healthbody${process.pid}`,
          timezone: "America/New_York",
        })
        .returning();
      return row;
    });
    ctx = { tenant, userId: `user_healthbody${process.pid}`, role: "owner", support: null };
  });

  afterAll(async () => {
    if (tenant) await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id)));
  });

  // The scenarios share one space: each starts from an empty body.
  beforeEach(async () => {
    if (!tenant) return;
    await withSystem(async (tx) => {
      await tx.delete(schema.healthWeighins).where(eq(schema.healthWeighins.tenantId, tenant.id));
      await tx.delete(schema.healthWeightGoals).where(eq(schema.healthWeightGoals.tenantId, tenant.id));
      await tx.delete(schema.healthMeasures).where(eq(schema.healthMeasures.tenantId, tenant.id));
      await tx.delete(schema.healthPlunges).where(eq(schema.healthPlunges.tenantId, tenant.id));
    });
  });

  describe("weigh-ins", () => {
    it("keeps one a day, in kilograms, and a second save that day changes it", async () => {
      await inTenant((tx) => saveWeighin(tx, ctx, TODAY, 184.6, NOW));
      await inTenant((tx) => saveWeighin(tx, ctx, TODAY, 184.2, NOW));
      await inTenant((tx) => saveWeighin(tx, ctx, "2026-10-01", 185.4, NOW));
      const kept = await inTenant((tx) => weighinsBetween(tx, tenant.id, "2026-09-01", TODAY));
      expect(kept.map((w) => [w.day, pounds(w.kg)])).toEqual([
        ["2026-10-01", 185.4],
        [TODAY, 184.2],
      ]);
      expect(kept[1].kg).toBeCloseTo(184.2 * 0.45359237, 9);
      expect(await inTenant((tx) => lastWeighin(tx, tenant.id, "2026-10-02"))).toMatchObject({ day: "2026-10-01" });
      expect(await inTenant((tx) => lastWeighin(tx, tenant.id, "2026-09-30"))).toBeNull();
    });

    it("changes one kept on any day, refuses a day with none, and takes one off", async () => {
      const longAgo = shiftDay(TODAY, -90);
      await inTenant((tx) => saveWeighin(tx, ctx, longAgo, 190, NOW));
      await inTenant((tx) => changeWeighin(tx, tenant.id, longAgo, 189.5, NOW));
      expect((await inTenant((tx) => allWeighins(tx, tenant.id))).map((w) => pounds(w.kg))).toEqual([189.5]);
      await expect(inTenant((tx) => changeWeighin(tx, tenant.id, TODAY, 180, NOW))).rejects.toMatchObject({ code: "NOT_FOUND" });
      await inTenant((tx) => deleteWeighin(tx, tenant.id, longAgo));
      await inTenant((tx) => deleteWeighin(tx, tenant.id, longAgo));
      expect(await inTenant((tx) => allWeighins(tx, tenant.id))).toEqual([]);
    });

    it("refuses a weight the table does not hold", async () => {
      await expect(inTenant((tx) => saveWeighin(tx, ctx, TODAY, 20, NOW))).rejects.toThrow();
    });
  });

  describe("the goal", () => {
    it("is one a space, set, changed and cleared", async () => {
      expect(await inTenant((tx) => getWeightGoal(tx, tenant.id))).toBeNull();
      await inTenant((tx) => setWeightGoal(tx, tenant.id, 175, 1, NOW));
      await inTenant((tx) => setWeightGoal(tx, tenant.id, 172.5, 0.5, NOW));
      const goal = (await inTenant((tx) => getWeightGoal(tx, tenant.id)))!;
      expect([pounds(goal.goalKg), pounds(goal.paceKg)]).toEqual([172.5, 0.5]);
      await inTenant((tx) => clearWeightGoal(tx, tenant.id));
      expect(await inTenant((tx) => getWeightGoal(tx, tenant.id))).toBeNull();
    });
  });

  describe("tape measures", () => {
    it("lists them in the order added, refuses a name the space has whatever its capitals, and changes one", async () => {
      const waist = await inTenant((tx) => createMeasure(tx, tenant.id, { name: "Waist", better: "smaller" }));
      const arm = await inTenant((tx) => createMeasure(tx, tenant.id, { name: "Arm", better: null }));
      await expect(inTenant((tx) => createMeasure(tx, tenant.id, { name: "waist", better: null }))).rejects.toMatchObject({
        code: "MEASURE_NAME_TAKEN",
      });
      await inTenant((tx) => updateMeasure(tx, tenant.id, arm.id, { name: "Right arm", better: "bigger" }, NOW));
      await inTenant((tx) => updateMeasure(tx, tenant.id, waist.id, { name: "WAIST", better: "smaller" }, NOW));
      await expect(
        inTenant((tx) => updateMeasure(tx, tenant.id, arm.id, { name: "Waist", better: null }, NOW)),
      ).rejects.toMatchObject({ code: "MEASURE_NAME_TAKEN" });
      await expect(
        inTenant((tx) => updateMeasure(tx, tenant.id, randomUUID(), { name: "Neck", better: null }, NOW)),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await inTenant((tx) => listMeasures(tx, tenant.id))).toEqual([
        { id: waist.id, name: "WAIST", better: "smaller" },
        { id: arm.id, name: "Right arm", better: "bigger" },
      ]);
    });

    it(`keeps no more than ${MEASURES_MAX}`, async () => {
      await inTenant(async (tx) => {
        for (let i = 1; i <= MEASURES_MAX; i++) await createMeasure(tx, tenant.id, { name: `Measure ${i}`, better: null });
      });
      await expect(inTenant((tx) => createMeasure(tx, tenant.id, { name: "One more", better: null }))).rejects.toMatchObject({
        code: "TOO_MANY_MEASURES",
      });
    });

    it("keeps a day's measurements, changes and takes them off, and deletes them with their measure", async () => {
      const waist = await inTenant((tx) => createMeasure(tx, tenant.id, { name: "Waist", better: "smaller" }));
      const hips = await inTenant((tx) => createMeasure(tx, tenant.id, { name: "Hips", better: null }));
      await inTenant((tx) =>
        saveMeasurements(tx, tenant.id, "2026-09-28", [
          { measureId: waist.id, inches: 36.5 },
          { measureId: hips.id, inches: 40.25 },
        ], NOW),
      );
      await inTenant((tx) =>
        saveMeasurements(tx, tenant.id, TODAY, [
          { measureId: waist.id, inches: 36.25 },
          { measureId: hips.id, inches: null },
        ], NOW),
      );
      const kept = () => inTenant((tx) => allMeasurements(tx, tenant.id));
      // Oldest first; two on one day come in either order.
      const all = (await kept()).map((m) => [m.measureId, m.day, inches(m.cm)]);
      expect(all.map((m) => m[1])).toEqual(["2026-09-28", "2026-09-28", TODAY]);
      expect(all).toEqual(
        expect.arrayContaining([
          [waist.id, "2026-09-28", 36.5],
          [hips.id, "2026-09-28", 40.25],
          [waist.id, TODAY, 36.25],
        ]),
      );
      // Changed, and one taken off, on the same day.
      await inTenant((tx) =>
        saveMeasurements(tx, tenant.id, "2026-09-28", [
          { measureId: waist.id, inches: 36.75 },
          { measureId: hips.id, inches: null },
        ], NOW),
      );
      expect((await inTenant((tx) => measurementsBetween(tx, tenant.id, "2026-09-28", "2026-09-28"))).map((m) => inches(m.cm))).toEqual([
        36.75,
      ]);
      expect(await inTenant((tx) => lastMeasuredOn(tx, tenant.id, "2026-10-02"))).toBe("2026-09-28");
      expect(await inTenant((tx) => lastMeasuredOn(tx, tenant.id, TODAY))).toBe(TODAY);

      // A measure that is not this space's: nothing is kept, not even the good one beside it.
      await expect(
        inTenant((tx) =>
          saveMeasurements(tx, tenant.id, "2026-10-01", [
            { measureId: hips.id, inches: 40 },
            { measureId: randomUUID(), inches: 30 },
          ], NOW),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await inTenant((tx) => measurementsBetween(tx, tenant.id, "2026-10-01", "2026-10-01"))).toEqual([]);

      await inTenant((tx) => deleteMeasure(tx, tenant.id, waist.id));
      const orphans = await withSystem((tx) =>
        tx.select().from(schema.healthMeasurements).where(eq(schema.healthMeasurements.measureId, waist.id)),
      );
      expect(orphans).toEqual([]);
    });
  });

  describe("Today and Progress", () => {
    it("Today's day has two months of weigh-ins for the trend, the goal, and when the tape was last out", async () => {
      await inTenant(async (tx) => {
        await saveWeighin(tx, ctx, shiftDay(TODAY, -(TREND_WARM_UP_DAYS + 1)), 200, NOW);
        await saveWeighin(tx, ctx, shiftDay(TODAY, -TREND_WARM_UP_DAYS), 190, NOW);
        await saveWeighin(tx, ctx, "2026-10-02", 185, NOW);
        await saveWeighin(tx, ctx, TODAY, 184.6, NOW);
        await setWeightGoal(tx, tenant.id, 175, 1, NOW);
      });
      const waist = await inTenant((tx) => createMeasure(tx, tenant.id, { name: "Waist", better: "smaller" }));
      const empty = await inTenant((tx) => dayData(tx, tenant.id, TODAY));
      expect(empty.measures).toEqual([{ id: waist.id, name: "Waist", better: "smaller" }]);
      expect(empty.lastMeasured).toBeNull();
      await inTenant((tx) => saveMeasurements(tx, tenant.id, "2026-09-28", [{ measureId: waist.id, inches: 36.5 }], NOW));

      const day = await inTenant((tx) => dayData(tx, tenant.id, TODAY));
      expect(day.weighins.map((w) => [w.day, pounds(w.kg)])).toEqual([
        [shiftDay(TODAY, -TREND_WARM_UP_DAYS), 190],
        ["2026-10-02", 185],
        [TODAY, 184.6],
      ]);
      expect(pounds(day.goal!.goalKg)).toBe(175);
      expect(day.lastMeasured).toBe("2026-09-28");

      // The day before: its own weigh-in is the latest, and today's is not in it.
      const yesterday = await inTenant((tx) => dayData(tx, tenant.id, "2026-10-02"));
      expect(yesterday.weighins.at(-1)).toMatchObject({ day: "2026-10-02" });
    });

    it("Progress has the body first: the weight's trend by week and each tape measure's mean", async () => {
      const windows = progressWindows(TODAY);
      const weighins: [string, number][] = [
        [shiftDay(windows[0].from, -10), 190],
        [windows[0].to, 188],
        [windows[2].from, 186],
        [TODAY, 184],
      ];
      await inTenant(async (tx) => {
        for (const [day, lb] of weighins) await saveWeighin(tx, ctx, day, lb, NOW);
        await setWeightGoal(tx, tenant.id, 175, 1, NOW);
      });
      const waist = await inTenant((tx) => createMeasure(tx, tenant.id, { name: "Waist", better: "smaller" }));
      await inTenant((tx) =>
        saveMeasurements(tx, tenant.id, windows[1].to, [{ measureId: waist.id, inches: 37 }], NOW).then(() =>
          saveMeasurements(tx, tenant.id, TODAY, [{ measureId: waist.id, inches: 36.5 }], NOW),
        ),
      );

      const rows = await inTenant((tx) => ownRows(tx, tenant.id, windows));
      expect(rows.slice(0, 2).map((r) => r.key)).toEqual(["health.weight", `health.measure.${waist.id}`]);
      // The trend runs through the weigh-in ten days before the first week, read from the warm-up.
      const trend = weightTrend((await inTenant((tx) => allWeighins(tx, tenant.id))));
      const at = (day: string) => poundsFromKg(trend.find((p) => p.day === day)!.trend);
      expect(rows[0]).toMatchObject({ format: "measure", unit: "lb", better: "down" });
      expect(rows[0].values).toEqual([
        expect.closeTo(at(windows[0].to), 9),
        null,
        expect.closeTo(at(windows[2].from), 9),
        expect.closeTo(at(TODAY), 9),
      ]);
      expect(rows[1]).toMatchObject({ name: "Waist", unit: "in", better: "down" });
      expect(rows[1].values.map((v) => (v === null ? null : Math.round(v * 100) / 100))).toEqual([null, 37, null, 36.5]);
    });
  });

  describe("a plunge typed in for an earlier day", () => {
    it("goes on that day, whenever it was typed", async () => {
      await inTenant((tx) =>
        logPlunge(tx, ctx, { id: randomUUID(), startedAt: NOW.toISOString(), seconds: 150, waterF: 50, feelAfter: 6, takenOn: "2026-09-28" }, NOW),
      );
      const kept = await inTenant((tx) => plungesBetween(tx, tenant.id, "2026-09-01", TODAY));
      expect(kept.map((p) => p.takenOn)).toEqual(["2026-09-28"]);
    });
  });
});
