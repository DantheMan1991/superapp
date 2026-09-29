import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../../src/db";
import { d } from "./_shared";

/**
 * WORKOUTS' TEN TABLES ARE ORDINARY TENANT TABLES (docs/modules/fitness.md):
 * F1's program, phases, exercises, items and imports, F2's enrollments,
 * sessions, session exercises and sets, and F4a's reminders.
 *
 * They only ever hold rows in a personal space, but to the database a personal
 * space is a tenant like any other (ADR 0111) — so this proves what
 * core.test.ts proves for every pair: neither can read, write or reach the
 * other's rows, and the composite foreign keys refuse a row that points across
 * the wall. Two people's personal spaces, each with a program in it.
 */

const STAMP = `iso-fitness-${process.pid}`;

let a: string;
let b: string;
const ids = {
  program: "",
  phase: "",
  exercise: "",
  item: "",
  import: "",
  enrollment: "",
  session: "",
  sessionExercise: "",
  set: "",
  reminder: "",
};

async function names(err: Promise<unknown>): Promise<string> {
  try {
    await err;
    return "";
  } catch (e) {
    const x = e as { message?: string; cause?: { message?: string } };
    return `${x?.message ?? ""} ${x?.cause?.message ?? ""}`;
  }
}

d("workouts tables (RLS)", () => {
  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [ta] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-a`,
          name: "Personal",
          slug: `${STAMP}-a`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isofita${process.pid}`,
        })
        .returning();
      const [tb] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-b`,
          name: "Personal",
          slug: `${STAMP}-b`,
          kind: "personal",
          personalOwnerClerkUserId: `user_isofitb${process.pid}`,
        })
        .returning();
      a = ta.id;
      b = tb.id;
      const [program] = await tx
        .insert(schema.fitnessPrograms)
        .values({ tenantId: a, name: "A's program" })
        .returning();
      const [phase] = await tx
        .insert(schema.fitnessPhases)
        .values({ tenantId: a, programId: program.id, position: 0, name: "Weeks 1–2" })
        .returning();
      const [exercise] = await tx
        .insert(schema.fitnessExercises)
        .values({ tenantId: a, programId: program.id, name: "Hip lift", unit: "breaths" })
        .returning();
      const [item] = await tx
        .insert(schema.fitnessPhaseItems)
        .values({ tenantId: a, phaseId: phase.id, exerciseId: exercise.id, position: 0, targetMin: 8 })
        .returning();
      const [draft] = await tx
        .insert(schema.fitnessImports)
        .values({
          tenantId: a,
          fileName: "a.pdf",
          pageCount: 3,
          status: "draft",
          draft: { name: "A's draft" },
          createdByClerkUserId: `user_isofita${process.pid}`,
        })
        .returning();
      const [enrollment] = await tx
        .insert(schema.fitnessEnrollments)
        .values({ tenantId: a, programId: program.id, startedOn: "2026-09-27" })
        .returning();
      const [session] = await tx
        .insert(schema.fitnessSessions)
        .values({
          tenantId: a,
          enrollmentId: enrollment.id,
          phaseId: phase.id,
          phaseName: "Weeks 1–2",
          localDay: "2026-09-27",
          startedAt: new Date(),
          feelBefore: 4,
        })
        .returning();
      const [sessionExercise] = await tx
        .insert(schema.fitnessSessionExercises)
        .values({
          tenantId: a,
          sessionId: session.id,
          itemId: item.id,
          exerciseId: exercise.id,
          position: 0,
          name: "Hip lift",
          unit: "breaths",
        })
        .returning();
      const [set] = await tx
        .insert(schema.fitnessSets)
        .values({ tenantId: a, sessionExerciseId: sessionExercise.id, number: 1, target: 8, count: 8, doneAt: new Date() })
        .returning();
      const [reminder] = await tx
        .insert(schema.fitnessReminders)
        .values({ tenantId: a, programId: program.id, slot: "evening", atMinute: 1170 })
        .returning();
      Object.assign(ids, {
        reminder: reminder.id,
        program: program.id,
        phase: phase.id,
        exercise: exercise.id,
        item: item.id,
        import: draft.id,
        enrollment: enrollment.id,
        session: session.id,
        sessionExercise: sessionExercise.id,
        set: set.id,
      });
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(inArray(schema.tenants.id, [a, b])));
  });

  it("A reads its own program, phase, exercise, item and import, its workouts and its reminders", async () => {
    const seen = await withTenant(a, async (tx) => ({
      reminders: await tx.select({ id: schema.fitnessReminders.id }).from(schema.fitnessReminders),
      programs: await tx.select({ id: schema.fitnessPrograms.id }).from(schema.fitnessPrograms),
      phases: await tx.select({ id: schema.fitnessPhases.id }).from(schema.fitnessPhases),
      exercises: await tx.select({ id: schema.fitnessExercises.id }).from(schema.fitnessExercises),
      items: await tx.select({ id: schema.fitnessPhaseItems.id }).from(schema.fitnessPhaseItems),
      imports: await tx.select({ id: schema.fitnessImports.id }).from(schema.fitnessImports),
      enrollments: await tx.select({ id: schema.fitnessEnrollments.id }).from(schema.fitnessEnrollments),
      sessions: await tx.select({ id: schema.fitnessSessions.id }).from(schema.fitnessSessions),
      sessionExercises: await tx.select({ id: schema.fitnessSessionExercises.id }).from(schema.fitnessSessionExercises),
      sets: await tx.select({ id: schema.fitnessSets.id }).from(schema.fitnessSets),
    }));
    expect(seen.programs.map((r) => r.id)).toEqual([ids.program]);
    expect(seen.phases.map((r) => r.id)).toEqual([ids.phase]);
    expect(seen.exercises.map((r) => r.id)).toEqual([ids.exercise]);
    expect(seen.items.map((r) => r.id)).toEqual([ids.item]);
    expect(seen.imports.map((r) => r.id)).toEqual([ids.import]);
    expect(seen.enrollments.map((r) => r.id)).toEqual([ids.enrollment]);
    expect(seen.sessions.map((r) => r.id)).toEqual([ids.session]);
    expect(seen.sessionExercises.map((r) => r.id)).toEqual([ids.sessionExercise]);
    expect(seen.sets.map((r) => r.id)).toEqual([ids.set]);
    expect(seen.reminders.map((r) => r.id)).toEqual([ids.reminder]);
  });

  it("B cannot read any of A's rows, even by id", async () => {
    const seen = await withTenant(b, async (tx) => [
      ...(await tx.select().from(schema.fitnessPrograms).where(eq(schema.fitnessPrograms.id, ids.program))),
      ...(await tx.select().from(schema.fitnessPhases).where(eq(schema.fitnessPhases.id, ids.phase))),
      ...(await tx.select().from(schema.fitnessExercises).where(eq(schema.fitnessExercises.id, ids.exercise))),
      ...(await tx.select().from(schema.fitnessPhaseItems).where(eq(schema.fitnessPhaseItems.id, ids.item))),
      ...(await tx.select().from(schema.fitnessImports).where(eq(schema.fitnessImports.id, ids.import))),
      ...(await tx.select().from(schema.fitnessEnrollments).where(eq(schema.fitnessEnrollments.id, ids.enrollment))),
      ...(await tx.select().from(schema.fitnessSessions).where(eq(schema.fitnessSessions.id, ids.session))),
      ...(await tx
        .select()
        .from(schema.fitnessSessionExercises)
        .where(eq(schema.fitnessSessionExercises.id, ids.sessionExercise))),
      ...(await tx.select().from(schema.fitnessSets).where(eq(schema.fitnessSets.id, ids.set))),
      ...(await tx.select().from(schema.fitnessReminders).where(eq(schema.fitnessReminders.id, ids.reminder))),
    ]);
    expect(seen).toHaveLength(0);
  });

  it("B cannot change or delete A's rows", async () => {
    const changed = await withTenant(b, async (tx) => [
      ...(await tx
        .update(schema.fitnessPrograms)
        .set({ name: "Taken" })
        .where(eq(schema.fitnessPrograms.id, ids.program))
        .returning()),
      ...(await tx
        .update(schema.fitnessExercises)
        .set({ name: "Taken" })
        .where(eq(schema.fitnessExercises.id, ids.exercise))
        .returning()),
      ...(await tx.delete(schema.fitnessPhaseItems).where(eq(schema.fitnessPhaseItems.id, ids.item)).returning()),
      ...(await tx.delete(schema.fitnessImports).where(eq(schema.fitnessImports.id, ids.import)).returning()),
      ...(await tx
        .update(schema.fitnessSessions)
        .set({ feelBefore: 0 })
        .where(eq(schema.fitnessSessions.id, ids.session))
        .returning()),
      ...(await tx.delete(schema.fitnessSets).where(eq(schema.fitnessSets.id, ids.set)).returning()),
      ...(await tx.delete(schema.fitnessEnrollments).where(eq(schema.fitnessEnrollments.id, ids.enrollment)).returning()),
      ...(await tx
        .update(schema.fitnessReminders)
        .set({ atMinute: 0, lastHandledOn: "2026-09-28" })
        .where(eq(schema.fitnessReminders.id, ids.reminder))
        .returning()),
      ...(await tx.delete(schema.fitnessReminders).where(eq(schema.fitnessReminders.id, ids.reminder)).returning()),
    ]);
    expect(changed).toHaveLength(0);
    const [program] = await withSystem((tx) =>
      tx.select({ name: schema.fitnessPrograms.name }).from(schema.fitnessPrograms).where(eq(schema.fitnessPrograms.id, ids.program)),
    );
    expect(program.name).toBe("A's program");
  });

  it("B cannot hang a row of its own off A's program, phase or exercise — the composite keys refuse it", async () => {
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessPhases).values({ tenantId: b, programId: ids.program, position: 0, name: "Mine" }),
        ),
      ),
    ).toContain("fitness_phases_program_fk");
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessExercises).values({ tenantId: b, programId: ids.program, name: "Mine" }),
        ),
      ),
    ).toContain("fitness_exercises_program_fk");
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessImports).values({
            tenantId: b,
            fileName: "b.pdf",
            pageCount: 1,
            programId: ids.program,
            createdByClerkUserId: `user_isofitb${process.pid}`,
          }),
        ),
      ),
    ).toContain("fitness_imports_program_fk");
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessReminders).values({ tenantId: b, programId: ids.program, slot: "morning", atMinute: 420 }),
        ),
      ),
    ).toContain("fitness_reminders_program_fk");
  });

  it("B cannot hang a workout of its own off A's program, enrollment, session or exercise", async () => {
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessEnrollments).values({ tenantId: b, programId: ids.program, startedOn: "2026-09-27" }),
        ),
      ),
    ).toContain("fitness_enrollments_program_fk");
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessSessions).values({
            tenantId: b,
            enrollmentId: ids.enrollment,
            localDay: "2026-09-27",
            startedAt: new Date(),
          }),
        ),
      ),
    ).toContain("fitness_sessions_enrollment_fk");
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessSessionExercises).values({
            tenantId: b,
            sessionId: ids.session,
            position: 0,
            name: "Mine",
            unit: "reps",
          }),
        ),
      ),
    ).toContain("fitness_session_exercises_session_fk");
    expect(
      await names(
        withTenant(b, (tx) =>
          tx.insert(schema.fitnessSets).values({
            tenantId: b,
            sessionExerciseId: ids.sessionExercise,
            number: 1,
            target: 5,
            count: 5,
            doneAt: new Date(),
          }),
        ),
      ),
    ).toContain("fitness_sets_session_exercise_fk");
  });

  it("B cannot write a row claiming to be A's", async () => {
    expect(
      await names(
        withTenant(b, (tx) => tx.insert(schema.fitnessPrograms).values({ tenantId: a, name: "Planted" })),
      ),
    ).not.toBe("");
  });

  it("an item cannot point at another program's exercise across the wall, even from inside A", async () => {
    const [otherExercise] = await withSystem(async (tx) => {
      const [program] = await tx.insert(schema.fitnessPrograms).values({ tenantId: b, name: "B's" }).returning();
      return tx
        .insert(schema.fitnessExercises)
        .values({ tenantId: b, programId: program.id, name: "B's move" })
        .returning();
    });
    expect(
      await names(
        withTenant(a, (tx) =>
          tx.insert(schema.fitnessPhaseItems).values({
            tenantId: a,
            phaseId: ids.phase,
            exerciseId: otherExercise.id,
            position: 1,
            targetMin: 5,
          }),
        ),
      ),
    ).toContain("fitness_phase_items_exercise_fk");
  });
});
