import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import type { Tenant } from "../src/db/schema";
import type { TenantContext } from "../src/lib/auth";
import { ensurePersonalTools } from "../src/lib/personal-space";
import { contributedRows, contributedToday } from "../src/lib/progress-sources/resolve";
import { HABITS_MAX } from "../src/modules/health/core/habits";
import type { PlungeInput } from "../src/modules/health/core/plunge";
import { progressWindows, shiftDay } from "../src/modules/health/core/progress";
import {
  createHabit,
  deleteHabit,
  habitLogsBetween,
  listHabits,
  setHabitDay,
  updateHabit,
} from "../src/modules/health/habit-ops";
import {
  deletePlunge,
  deleteSleep,
  lastPlunge,
  lastSleep,
  logPlunge,
  plungesBetween,
  saveSleep,
  sleepBetween,
} from "../src/modules/health/log-ops";
import { ownRows, todayData } from "../src/modules/health/progress-ops";
import type { ProgramInput } from "../src/modules/fitness/core/program";
import { beginSession, finishExercise, finishSession, recordSet } from "../src/modules/fitness/core/session";
import { loadProgram, saveProgram, sessionPlan } from "../src/modules/fitness/program-ops";
import { fitnessProgressSource } from "../src/modules/fitness/progress-source";
import { saveSession } from "../src/modules/fitness/session-ops";

/**
 * Health against a real database (docs/modules/health.md, H1): a plunge kept
 * once however many times the phone sends it, on the space's day; a night kept
 * once a morning; habits and the days they were done; what Today and Progress
 * read; and the progress slot asking Workouts, only while Workouts is on.
 *
 * The clock is fixed (noon in New York on 2 Oct 2026, the space's timezone) and
 * every date is that day or before it, so nothing here turns on the day it runs.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `health-ops-${process.pid}`;
const NOW = new Date("2026-10-02T16:00:00Z");
const TODAY = "2026-10-02";

let tenant: Tenant;
let ctx: TenantContext;

function inTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(tenant.id, fn, { role: "owner" });
}

function plunge(startedAt: string, extra: Partial<PlungeInput> = {}): PlungeInput {
  return { id: randomUUID(), startedAt, seconds: 180, waterF: 48, feelAfter: 7, ...extra };
}

function night(wokeOn: string, bedTime = "22:30", wokeTime = "06:30", rested: number | null = 7) {
  return { wokeOn, bedTime, wokeTime, rested };
}

/** A small program, as the Workouts editor sends one. */
function aProgram(): ProgramInput {
  const item = (name: string) => ({
    itemId: null,
    exerciseId: null,
    name,
    purpose: `${name}, for the test`,
    cues: [],
    unit: "reps" as const,
    videos: [],
    setsMin: 2,
    setsMax: null,
    targetMin: 8,
    targetMax: null,
    perSide: false,
    optional: false,
    notes: "",
    sideRule: "both" as const,
    sideMeans: "side" as const,
    progression: null,
  });
  return {
    name: "Progress slot",
    author: "",
    notes: "",
    sessionsPerWeekMin: 3,
    sessionsPerWeekMax: 4,
    effortMin: null,
    effortMax: null,
    breathOutS: null,
    breathInS: null,
    assessment: null,
    phases: [{ phaseId: null, name: "Weeks 1-2", minDoneDays: 14, notes: "", items: [item("Squat"), item("Row")] }],
  };
}

d("health (db)", () => {
  beforeAll(async () => {
    tenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Personal",
          slug: `${STAMP}-slug`,
          kind: "personal",
          personalOwnerClerkUserId: `user_healthops${process.pid}`,
          timezone: "America/New_York",
        })
        .returning();
      return row;
    });
    ctx = { tenant, userId: `user_healthops${process.pid}`, role: "owner", support: null };
  });

  afterAll(async () => {
    if (tenant) await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id)));
  });

  // The scenarios share one space: each starts from an empty Health.
  beforeEach(async () => {
    if (!tenant) return;
    await withSystem(async (tx) => {
      await tx.delete(schema.healthPlunges).where(eq(schema.healthPlunges.tenantId, tenant.id));
      await tx.delete(schema.healthSleep).where(eq(schema.healthSleep.tenantId, tenant.id));
      await tx.delete(schema.healthHabits).where(eq(schema.healthHabits.tenantId, tenant.id));
    });
  });

  describe("cold plunges", () => {
    it("keeps a plunge on the space's day it started, once however many times the phone sends it", async () => {
      // 10:30 pm in New York on the 1st, already the 2nd in UTC.
      const late = plunge("2026-10-02T02:30:00Z");
      expect(await inTenant((tx) => logPlunge(tx, ctx, late, NOW))).toEqual({ takenOn: "2026-10-01" });
      // Sent again (a retry after a dropped answer): the first one stands.
      expect(await inTenant((tx) => logPlunge(tx, ctx, { ...late, seconds: 999 }, NOW))).toEqual({ takenOn: "2026-10-01" });
      const kept = await inTenant((tx) => plungesBetween(tx, tenant.id, "2026-09-25", TODAY));
      expect(kept).toEqual([
        {
          id: late.id,
          takenOn: "2026-10-01",
          startedAt: new Date("2026-10-02T02:30:00Z"),
          seconds: 180,
          waterF: 48,
          feelAfter: 7,
        },
      ]);
    });

    it("refuses a start ahead of the clock, or more than eight days back", async () => {
      const refused = [plunge("2026-10-02T16:02:00Z"), plunge("2026-09-24T15:00:00Z")];
      for (const p of refused) {
        await expect(inTenant((tx) => logPlunge(tx, ctx, p, NOW))).rejects.toMatchObject({ code: "INVALID" });
      }
      // A phone a few seconds ahead, and last week's typed in, are fine.
      await inTenant((tx) => logPlunge(tx, ctx, plunge("2026-10-02T16:00:30Z"), NOW));
      await inTenant((tx) => logPlunge(tx, ctx, plunge("2026-09-24T17:00:00Z", { waterF: null, feelAfter: null }), NOW));
      expect(await inTenant((tx) => plungesBetween(tx, tenant.id, "2026-09-01", TODAY))).toHaveLength(2);
    });

    it("lists a range in the order taken, finds the latest, and undoes one, twice without complaint", async () => {
      const [sep30, oct2, oct1] = [
        plunge("2026-09-30T11:00:00Z"),
        plunge("2026-10-02T11:00:00Z", { waterF: 45 }),
        plunge("2026-10-01T11:00:00Z"),
      ];
      await inTenant(async (tx) => {
        for (const p of [sep30, oct2, oct1]) await logPlunge(tx, ctx, p, NOW);
      });
      const range = await inTenant((tx) => plungesBetween(tx, tenant.id, "2026-10-01", TODAY));
      expect(range.map((p) => p.id)).toEqual([oct1.id, oct2.id]);
      expect(await inTenant((tx) => lastPlunge(tx, tenant.id))).toMatchObject({ id: oct2.id, waterF: 45 });
      await inTenant((tx) => deletePlunge(tx, tenant.id, oct2.id));
      await inTenant((tx) => deletePlunge(tx, tenant.id, oct2.id));
      expect(await inTenant((tx) => lastPlunge(tx, tenant.id))).toMatchObject({ id: oct1.id });
    });
  });

  describe("sleep", () => {
    it("keeps a night's minutes from its clock times, one a morning, and a second save changes it", async () => {
      await inTenant((tx) => saveSleep(tx, ctx, night(TODAY, "22:50", "06:10", 6), NOW));
      expect(await inTenant((tx) => sleepBetween(tx, tenant.id, TODAY, TODAY))).toEqual([
        { wokeOn: TODAY, bedTime: "22:50:00", wokeTime: "06:10:00", minutes: 440, rested: 6 },
      ]);
      await inTenant((tx) => saveSleep(tx, ctx, night(TODAY, "23:30", "06:10", null), NOW));
      expect(await inTenant((tx) => sleepBetween(tx, tenant.id, TODAY, TODAY))).toEqual([
        { wokeOn: TODAY, bedTime: "23:30:00", wokeTime: "06:10:00", minutes: 400, rested: null },
      ]);
    });

    it("refuses a morning that has not come in the space, one too long ago, and the same time twice", async () => {
      await expect(inTenant((tx) => saveSleep(tx, ctx, night("2026-10-03"), NOW))).rejects.toMatchObject({ code: "INVALID" });
      // 10 pm in New York on the 2nd is the 3rd in UTC; the space's morning has not come.
      const lateEvening = new Date("2026-10-03T02:00:00Z");
      await expect(inTenant((tx) => saveSleep(tx, ctx, night("2026-10-03"), lateEvening))).rejects.toMatchObject({
        code: "INVALID",
      });
      await expect(inTenant((tx) => saveSleep(tx, ctx, night(shiftDay(TODAY, -61)), NOW))).rejects.toMatchObject({
        code: "INVALID",
      });
      await expect(inTenant((tx) => saveSleep(tx, ctx, night(TODAY, "07:00", "07:00"), NOW))).rejects.toMatchObject({
        code: "SAME_TIME",
      });
      await inTenant((tx) => saveSleep(tx, ctx, night(shiftDay(TODAY, -60)), NOW));
      expect(await inTenant((tx) => sleepBetween(tx, tenant.id, "2026-01-01", TODAY))).toHaveLength(1);
    });

    it("finds the latest night kept, and removes one", async () => {
      await inTenant(async (tx) => {
        await saveSleep(tx, ctx, night("2026-09-30"), NOW);
        await saveSleep(tx, ctx, night("2026-10-01", "23:00"), NOW);
      });
      expect(await inTenant((tx) => lastSleep(tx, tenant.id))).toMatchObject({ wokeOn: "2026-10-01", minutes: 450 });
      await inTenant((tx) => deleteSleep(tx, tenant.id, "2026-10-01"));
      expect(await inTenant((tx) => lastSleep(tx, tenant.id))).toMatchObject({ wokeOn: "2026-09-30", minutes: 480 });
    });
  });

  describe("habits", () => {
    it("lists habits in the order added, and refuses a name the space has, whatever its capitals", async () => {
      const sauna = await inTenant((tx) => createHabit(tx, tenant.id, { name: "Sauna", unit: "min" }));
      const stretch = await inTenant((tx) => createHabit(tx, tenant.id, { name: "Stretch", unit: null }));
      await expect(inTenant((tx) => createHabit(tx, tenant.id, { name: "sauna", unit: null }))).rejects.toMatchObject({
        code: "HABIT_NAME_TAKEN",
      });
      // Its own name, in new capitals, is not taken.
      await inTenant((tx) => updateHabit(tx, tenant.id, sauna.id, { name: "SAUNA", unit: "min" }, NOW));
      await expect(
        inTenant((tx) => updateHabit(tx, tenant.id, stretch.id, { name: "Sauna", unit: null }, NOW)),
      ).rejects.toMatchObject({ code: "HABIT_NAME_TAKEN" });
      await expect(
        inTenant((tx) => updateHabit(tx, tenant.id, randomUUID(), { name: "Walk", unit: null }, NOW)),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // A habit added after one is deleted still goes last.
      await inTenant((tx) => deleteHabit(tx, tenant.id, stretch.id));
      const walk = await inTenant((tx) => createHabit(tx, tenant.id, { name: "Walk", unit: "min" }));
      await inTenant((tx) => createHabit(tx, tenant.id, { name: "Stretch", unit: null }));
      const listed = await inTenant((tx) => listHabits(tx, tenant.id));
      expect(listed.map((h) => h.name)).toEqual(["SAUNA", "Walk", "Stretch"]);
      expect(listed[1]).toEqual({ id: walk.id, name: "Walk", unit: "min" });
    });

    it(`keeps no more than ${HABITS_MAX}`, async () => {
      await inTenant(async (tx) => {
        for (let i = 1; i <= HABITS_MAX; i++) await createHabit(tx, tenant.id, { name: `Habit ${i}`, unit: null });
      });
      await expect(inTenant((tx) => createHabit(tx, tenant.id, { name: "One more", unit: null }))).rejects.toMatchObject({
        code: "TOO_MANY_HABITS",
      });
      expect(await inTenant((tx) => listHabits(tx, tenant.id))).toHaveLength(HABITS_MAX);
    });

    it("marks a day done once, changes its amount, undoes it, and deletes its days with the habit", async () => {
      const sauna = await inTenant((tx) => createHabit(tx, tenant.id, { name: "Sauna", unit: "min" }));
      const mark = (day: string, done: boolean, amount: number | null) =>
        inTenant((tx) => setHabitDay(tx, tenant.id, { habitId: sauna.id, day, done, amount }, NOW));
      const logs = () => inTenant((tx) => habitLogsBetween(tx, tenant.id, "2026-09-01", TODAY));

      await mark(TODAY, true, 20);
      expect(await logs()).toEqual([{ habitId: sauna.id, doneOn: TODAY, amount: 20 }]);
      await mark(TODAY, true, 25);
      expect(await logs()).toEqual([{ habitId: sauna.id, doneOn: TODAY, amount: 25 }]);
      await mark(TODAY, false, null);
      expect(await logs()).toEqual([]);

      // Marking a habit that is not there is refused; un-marking one is nothing to do.
      await expect(
        inTenant((tx) => setHabitDay(tx, tenant.id, { habitId: randomUUID(), day: TODAY, done: true, amount: null }, NOW)),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await inTenant((tx) => setHabitDay(tx, tenant.id, { habitId: randomUUID(), day: TODAY, done: false, amount: null }, NOW));

      await mark("2026-09-30", true, 15);
      await mark("2026-10-01", true, 10);
      expect(await logs()).toHaveLength(2);
      await inTenant((tx) => deleteHabit(tx, tenant.id, sauna.id));
      expect(await logs()).toEqual([]);
      const orphans = await withSystem((tx) =>
        tx.select().from(schema.healthHabitLogs).where(eq(schema.healthHabitLogs.habitId, sauna.id)),
      );
      expect(orphans).toEqual([]);
    });
  });

  describe("Today and Progress", () => {
    it("Today has this morning's night or the last one kept, today's plunges against the week's, and today's marks", async () => {
      await inTenant((tx) => saveSleep(tx, ctx, night("2026-09-30", "23:15", "06:45"), NOW));
      const before = await inTenant((tx) => todayData(tx, tenant.id, TODAY));
      expect(before.night).toBeNull();
      expect(before.lastNight).toMatchObject({ wokeOn: "2026-09-30", bedTime: "23:15:00" });

      await inTenant(async (tx) => {
        await saveSleep(tx, ctx, night(TODAY, "22:00", "06:00", 8), NOW);
        // The 25th is a day outside the seven ending today; the 26th is the first inside.
        for (const at of ["2026-09-25T11:00:00Z", "2026-09-26T11:00:00Z", "2026-10-02T11:00:00Z", "2026-10-02T13:00:00Z"]) {
          await logPlunge(tx, ctx, plunge(at), NOW);
        }
      });
      const sauna = await inTenant((tx) => createHabit(tx, tenant.id, { name: "Sauna", unit: "min" }));
      const stretch = await inTenant((tx) => createHabit(tx, tenant.id, { name: "Stretch", unit: null }));
      await inTenant(async (tx) => {
        await setHabitDay(tx, tenant.id, { habitId: sauna.id, day: TODAY, done: true, amount: 20 }, NOW);
        await setHabitDay(tx, tenant.id, { habitId: stretch.id, day: "2026-10-01", done: true, amount: null }, NOW);
      });

      const today = await inTenant((tx) => todayData(tx, tenant.id, TODAY));
      expect(today.night).toMatchObject({ wokeOn: TODAY, minutes: 480, rested: 8 });
      expect(today.lastNight).toMatchObject({ wokeOn: TODAY });
      expect(today.plunges.map((p) => p.startedAt.toISOString())).toEqual([
        "2026-10-02T11:00:00.000Z",
        "2026-10-02T13:00:00.000Z",
      ]);
      expect(today.plungesThisWeek).toBe(3);
      expect(today.habits.map((h) => h.name)).toEqual(["Sauna", "Stretch"]);
      expect(today.doneToday).toEqual([{ habitId: sauna.id, doneOn: TODAY, amount: 20 }]);
    });

    it("Progress adds up four weeks of what is kept", async () => {
      const windows = progressWindows(TODAY);
      await inTenant(async (tx) => {
        await saveSleep(tx, ctx, night("2026-09-20", "23:00", "06:00", 5), NOW);
        await saveSleep(tx, ctx, night("2026-09-27", "22:00", "06:00", 7), NOW);
        await saveSleep(tx, ctx, night(TODAY, "22:00", "07:00", null), NOW);
        await logPlunge(tx, ctx, plunge("2026-09-27T11:00:00Z", { seconds: 120 }), NOW);
        await logPlunge(tx, ctx, plunge("2026-10-01T11:00:00Z", { seconds: 240 }), NOW);
      });
      const walk = await inTenant((tx) => createHabit(tx, tenant.id, { name: "Walk", unit: "min" }));
      await inTenant((tx) => setHabitDay(tx, tenant.id, { habitId: walk.id, day: "2026-09-29", done: true, amount: 30 }, NOW));

      const rows = await inTenant((tx) => ownRows(tx, tenant.id, windows));
      expect(Object.fromEntries(rows.map((r) => [r.key, r.values]))).toEqual({
        "health.sleep": [null, null, 420, 510],
        "health.rested": [null, null, 5, 7],
        "health.plunges": [0, 0, 0, 2],
        "health.plunge-time": [null, null, null, 180],
        [`health.habit.${walk.id}`]: [0, 0, 0, 30],
      });
    });
  });

  describe("the progress slot", () => {
    it("asks only the tools switched on, and Workouts answers with the sessions that logged a set", async () => {
      const windows = progressWindows(TODAY);
      // Nothing is on in a new space: nobody is asked.
      expect(await contributedRows(tenant.id, windows, "owner")).toEqual({ found: [], failed: [] });

      await withSystem((tx) => ensurePersonalTools(tx, tenant.id, { preview: true }));
      const saved = await inTenant((tx) => saveProgram(tx, tenant.id, aProgram(), { programId: null, source: "own" }));
      const program = (await inTenant((tx) => loadProgram(tx, tenant.id, saved.programId)))!;
      const plan = sessionPlan(program, 0);
      // The phone's own clock, as Workouts reads it (a session's day is the phone's).
      const sep27 = (hour: number, minute = 0) => new Date(2026, 8, 27, hour, minute);
      const oct2 = (hour: number, minute = 0) => new Date(2026, 9, 2, hour, minute);
      const set = (doc: ReturnType<typeof beginSession>, itemIndex: number, when: Date) =>
        recordSet(plan, doc, { itemIndex, count: 8, setId: randomUUID(), exerciseId: randomUUID(), now: when });

      // Two sessions on the 27th (one day), one today, and one today that logged nothing.
      let first = beginSession(plan, { id: randomUUID(), now: sep27(7), feelBefore: null });
      first = finishSession(set(first, 0, sep27(7, 10)), { feelAfter: 7, now: sep27(7, 20) });
      let second = beginSession(plan, { id: randomUUID(), now: sep27(18), feelBefore: null });
      second = finishSession(set(second, 0, sep27(18, 5)), { feelAfter: 5, now: sep27(18, 15) });
      // Today: both sets of the first exercise, its taps, then a set of the second (the plan's order).
      let today = beginSession(plan, { id: randomUUID(), now: oct2(7), feelBefore: 4 });
      today = set(set(today, 0, oct2(7, 5)), 0, oct2(7, 8));
      today = finishExercise(plan, today, { itemIndex: 0, effort: null, cuesFelt: [], hurt: null, hurtNote: "", now: oct2(7, 9) });
      today = finishSession(set(today, 1, oct2(7, 15)), { feelAfter: 8, now: oct2(7, 25) });
      const empty = beginSession(plan, { id: randomUUID(), now: oct2(18), feelBefore: 3 });
      // A set out of the plan's order is not recorded: prove the fixture logged what it says.
      expect([first, second, today, empty].map((doc) => doc.exercises.flatMap((e) => e.sets).length)).toEqual([1, 1, 3, 0]);
      for (const doc of [first, second, today, empty]) await inTenant((tx) => saveSession(tx, tenant.id, doc));

      const rows = await contributedRows(tenant.id, windows, "owner");
      expect(rows.failed).toEqual([]);
      expect(rows.found.map((r) => [r.key, r.values])).toEqual([
        ["fitness.days", [0, 0, 0, 2]],
        ["fitness.feel", [null, null, null, (7 + 5 + 8) / 3]],
      ]);
      const cards = await contributedToday(tenant.id, TODAY, "owner");
      expect(cards).toEqual({
        found: [
          {
            key: "fitness",
            title: "Workout",
            icon: "dumbbell",
            lines: ["Worked out · 2 exercises · 25 min", "Felt 4 before, 8 after"],
            href: "/personal/m/fitness",
          },
        ],
        failed: [],
      });

      // A source that fails costs its own rows, never the page.
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      const broken = vi.spyOn(fitnessProgressSource, "rows").mockRejectedValueOnce(new Error("boom"));
      try {
        expect(await contributedRows(tenant.id, windows, "owner")).toEqual({ found: [], failed: ["Workouts"] });
      } finally {
        broken.mockRestore();
        quiet.mockRestore();
      }

      // Workouts switched off: it is not asked.
      await withSystem((tx) =>
        tx
          .update(schema.tenantModules)
          .set({ enabled: false })
          .where(and(eq(schema.tenantModules.tenantId, tenant.id), eq(schema.tenantModules.moduleId, "fitness"))),
      );
      expect(await contributedToday(tenant.id, TODAY, "owner")).toEqual({ found: [], failed: [] });
    });
  });
});
