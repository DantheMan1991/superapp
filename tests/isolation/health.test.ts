import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * HEALTH'S TABLES ARE ORDINARY TENANT TABLES (docs/modules/health.md, H1):
 * cold plunges, nights of sleep, the person's own habits and the days each was
 * done.
 *
 * They only ever hold rows in a personal space, but to the database a personal
 * space is a tenant like any other (ADR 0111), so this proves what
 * core.test.ts proves for every pair: neither person can read, change or
 * delete the other's rows, nor write one into the other's space. A plunge's id
 * is chosen by the phone, so it also proves that an id from one space cannot
 * be used to reach or replace a plunge in another.
 */

const STAMP = `iso-health-${process.pid}`;

let a: string;
let b: string;
const ids = { plunge: randomUUID(), habit: "", log: "" };

d("health tables (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [ta] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-a`,
          name: "Personal",
          slug: `${STAMP}-a`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isohealtha${process.pid}`,
        })
        .returning();
      const [tb] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-b`,
          name: "Personal",
          slug: `${STAMP}-b`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isohealthb${process.pid}`,
        })
        .returning();
      a = ta.id;
      b = tb.id;
      await tx.insert(schema.healthPlunges).values({
        id: ids.plunge,
        tenantId: a,
        takenOn: "2026-10-02",
        startedAt: new Date("2026-10-02T11:00:00Z"),
        seconds: 180,
        waterF: 48,
        feelAfter: 7,
        createdByClerkUserId: `user_isohealtha${process.pid}`,
      });
      await tx.insert(schema.healthSleep).values({
        tenantId: a,
        wokeOn: "2026-10-02",
        bedTime: "22:30",
        wokeTime: "06:30",
        minutes: 480,
        rested: 7,
        createdByClerkUserId: `user_isohealtha${process.pid}`,
      });
      const [habit] = await tx.insert(schema.healthHabits).values({ tenantId: a, name: "Sauna", unit: "min", position: 0 }).returning();
      const [log] = await tx
        .insert(schema.healthHabitLogs)
        .values({ tenantId: a, habitId: habit.id, doneOn: "2026-10-02", amount: 20 })
        .returning();
      Object.assign(ids, { habit: habit.id, log: log.id });
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [a, b])));
  });

  it("A reads its own plunge, night, habit and habit day", async () => {
    const seen = await withTenant(a, async (tx) => ({
      plunges: await tx.select({ id: schema.healthPlunges.id }).from(schema.healthPlunges),
      nights: await tx.select({ wokeOn: schema.healthSleep.wokeOn }).from(schema.healthSleep),
      habits: await tx.select({ id: schema.healthHabits.id }).from(schema.healthHabits),
      logs: await tx.select({ id: schema.healthHabitLogs.id }).from(schema.healthHabitLogs),
    }));
    expect(seen).toEqual({
      plunges: [{ id: ids.plunge }],
      nights: [{ wokeOn: "2026-10-02" }],
      habits: [{ id: ids.habit }],
      logs: [{ id: ids.log }],
    });
  });

  it("B cannot read any of A's rows, even by id", async () => {
    const seen = await withTenant(b, async (tx) => [
      ...(await tx.select().from(schema.healthPlunges).where(eq(schema.healthPlunges.id, ids.plunge))),
      ...(await tx.select().from(schema.healthSleep).where(eq(schema.healthSleep.tenantId, a))),
      ...(await tx.select().from(schema.healthHabits).where(eq(schema.healthHabits.id, ids.habit))),
      ...(await tx.select().from(schema.healthHabitLogs).where(eq(schema.healthHabitLogs.id, ids.log))),
    ]);
    expect(seen).toHaveLength(0);
  });

  it("B cannot change or delete A's rows", async () => {
    const changed = await withTenant(b, async (tx) => [
      ...(await tx.update(schema.healthPlunges).set({ seconds: 1 }).where(eq(schema.healthPlunges.id, ids.plunge)).returning()),
      ...(await tx.update(schema.healthSleep).set({ minutes: 1 }).where(eq(schema.healthSleep.tenantId, a)).returning()),
      ...(await tx.update(schema.healthHabits).set({ name: "Taken" }).where(eq(schema.healthHabits.id, ids.habit)).returning()),
      ...(await tx.delete(schema.healthHabitLogs).where(eq(schema.healthHabitLogs.id, ids.log)).returning()),
      ...(await tx.delete(schema.healthHabits).where(eq(schema.healthHabits.id, ids.habit)).returning()),
      ...(await tx.delete(schema.healthSleep).where(eq(schema.healthSleep.tenantId, a)).returning()),
      ...(await tx.delete(schema.healthPlunges).where(eq(schema.healthPlunges.id, ids.plunge)).returning()),
    ]);
    expect(changed).toHaveLength(0);
    const kept = await withSystem(async (tx) => ({
      plunge: await tx.select({ seconds: schema.healthPlunges.seconds }).from(schema.healthPlunges).where(eq(schema.healthPlunges.id, ids.plunge)),
      habit: await tx.select({ name: schema.healthHabits.name }).from(schema.healthHabits).where(eq(schema.healthHabits.id, ids.habit)),
      logs: await tx.select({ id: schema.healthHabitLogs.id }).from(schema.healthHabitLogs).where(eq(schema.healthHabitLogs.id, ids.log)),
      nights: await tx.select({ minutes: schema.healthSleep.minutes }).from(schema.healthSleep).where(eq(schema.healthSleep.tenantId, a)),
    }));
    expect(kept).toEqual({
      plunge: [{ seconds: 180 }],
      habit: [{ name: "Sauna" }],
      logs: [{ id: ids.log }],
      nights: [{ minutes: 480 }],
    });
  });

  it("B cannot write a row into A's space", async () => {
    const planted = "user_planted";
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.healthPlunges).values({
          id: randomUUID(),
          tenantId: a,
          takenOn: "2026-10-02",
          startedAt: new Date(),
          seconds: 60,
          createdByClerkUserId: planted,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.healthSleep).values({
          tenantId: a,
          wokeOn: "2026-10-01",
          bedTime: "22:00",
          wokeTime: "06:00",
          minutes: 480,
          createdByClerkUserId: planted,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(b, (tx) => tx.insert(schema.healthHabits).values({ tenantId: a, name: "Planted", position: 1 })),
    ).rejects.toThrow();
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.healthHabitLogs).values({ tenantId: a, habitId: ids.habit, doneOn: "2026-10-01" }),
      ),
    ).rejects.toThrow();
  });

  it("a habit day cannot point at another space's habit", async () => {
    // B's own row, aimed at A's habit: the composite key refuses it.
    await expect(
      withTenant(b, (tx) =>
        tx.insert(schema.healthHabitLogs).values({ tenantId: b, habitId: ids.habit, doneOn: "2026-10-02" }),
      ),
    ).rejects.toThrow();
  });

  it("a plunge id from A's space is refused in B's, and A's plunge stands", async () => {
    const reused = {
      id: ids.plunge,
      tenantId: b,
      takenOn: "2026-10-02",
      startedAt: new Date("2026-10-02T12:00:00Z"),
      seconds: 999,
      createdByClerkUserId: "user_planted",
    };
    await expect(withTenant(b, (tx) => tx.insert(schema.healthPlunges).values(reused))).rejects.toThrow();
    // A Save sent again does nothing on a clash, as `logPlunge` sends it: B gets
    // nothing back, and the action then finds no plunge of B's by that id.
    const inserted = await withTenant(b, (tx) =>
      tx.insert(schema.healthPlunges).values(reused).onConflictDoNothing({ target: schema.healthPlunges.id }).returning(),
    );
    expect(inserted).toEqual([]);
    const [kept] = await withSystem((tx) =>
      tx
        .select({ tenantId: schema.healthPlunges.tenantId, seconds: schema.healthPlunges.seconds })
        .from(schema.healthPlunges)
        .where(eq(schema.healthPlunges.id, ids.plunge)),
    );
    expect(kept).toEqual({ tenantId: a, seconds: 180 });
  });

  it("with no tenant at all, nothing is visible", async () => {
    const seen = await withTenant("00000000-0000-0000-0000-000000000000", async (tx) => [
      ...(await tx.select().from(schema.healthPlunges)),
      ...(await tx.select().from(schema.healthSleep)),
      ...(await tx.select().from(schema.healthHabits)),
      ...(await tx.select().from(schema.healthHabitLogs)),
    ]);
    expect(seen).toHaveLength(0);
  });
});
