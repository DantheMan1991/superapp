import "server-only";
import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { FitnessError } from "./core/errors";
import type { SessionDoc } from "./core/session";

/**
 * WORKOUT MODE'S SERVER HALF (docs/modules/fitness.md, F2a): make the database
 * match the session document the phone sent (core/session.ts).
 *
 * The phone sends the WHOLE session after every set, and again whenever it
 * could not get through, so this must be safe to run any number of times with
 * the same document, and must never let an older copy that arrives late undo
 * a newer one:
 *
 * - every row is keyed by the phone's own id, so a resend is an update of the
 *   same rows, never a second session;
 * - the session's `revision` only goes up: a document at or below the stored
 *   one is acknowledged and ignored (`stale`);
 * - the children are made to match: rows the document no longer has (a set
 *   taken back) are deleted.
 */

/** A phone's clock may run a little fast; past this, the server's time wins. */
const FUTURE_SKEW_MS = 2 * 60 * 1000;

function instant(iso: string | null, now: Date): Date | null {
  if (iso === null) return null;
  const at = new Date(iso);
  return at.getTime() > now.getTime() + FUTURE_SKEW_MS ? now : at;
}

/** Today in UTC plus a day and a half: the furthest ahead any person's own "today" can be. */
function latestLocalDay(now: Date): string {
  return new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function saveSession(
  tx: Tx,
  tenantId: string,
  doc: SessionDoc,
  now: Date = new Date(),
): Promise<{ revision: number; stale: boolean }> {
  const t = schema;
  if (doc.localDay > latestLocalDay(now)) {
    throw new FitnessError("INVALID", "This phone's date is ahead of today. Check its clock, then try again.");
  }

  const [program] = await tx
    .select({ id: t.fitnessPrograms.id })
    .from(t.fitnessPrograms)
    .where(and(eq(t.fitnessPrograms.tenantId, tenantId), eq(t.fitnessPrograms.id, doc.programId)));
  if (!program) throw new FitnessError("NOT_FOUND");

  // Following the program: the first session makes the enrollment, and every
  // later one finds it (one open enrollment per program, a partial unique index).
  await tx
    .insert(t.fitnessEnrollments)
    .values({ tenantId, programId: program.id, startedOn: doc.localDay })
    .onConflictDoNothing({
      target: [t.fitnessEnrollments.tenantId, t.fitnessEnrollments.programId],
      where: isNull(t.fitnessEnrollments.endedAt),
    });
  const [enrollment] = await tx
    .select({ id: t.fitnessEnrollments.id })
    .from(t.fitnessEnrollments)
    .where(
      and(
        eq(t.fitnessEnrollments.tenantId, tenantId),
        eq(t.fitnessEnrollments.programId, program.id),
        isNull(t.fitnessEnrollments.endedAt),
      ),
    );

  const [existing] = await tx
    .select({ enrollmentId: t.fitnessSessions.enrollmentId, revision: t.fitnessSessions.revision })
    .from(t.fitnessSessions)
    .where(and(eq(t.fitnessSessions.tenantId, tenantId), eq(t.fitnessSessions.id, doc.id)));
  if (existing && existing.enrollmentId !== enrollment.id) {
    throw new FitnessError("INVALID", "That session belongs to another program.");
  }
  if (existing && existing.revision >= doc.revision) {
    return { revision: existing.revision, stale: true };
  }

  // What still exists of the program. A session keeps its names either way;
  // a reference to a phase, item or exercise an edit has since removed (or
  // one from another program) is stored as null rather than refused, because
  // the workout happened.
  const known = await programRows(tx, tenantId, program.id);

  const sessionValues = {
    phaseId: doc.phaseId && known.phases.has(doc.phaseId) ? doc.phaseId : null,
    phaseName: doc.phaseName,
    localDay: doc.localDay,
    startedAt: instant(doc.startedAt, now) as Date,
    finishedAt: instant(doc.finishedAt, now),
    feelBefore: doc.feelBefore,
    feelAfter: doc.feelAfter,
    note: doc.note,
    revision: doc.revision,
    updatedAt: now,
  };
  await tx
    .insert(t.fitnessSessions)
    .values({ id: doc.id, tenantId, enrollmentId: enrollment.id, ...sessionValues })
    .onConflictDoUpdate({ target: t.fitnessSessions.id, set: sessionValues });

  // The children, made to match. An id already used by another session's row
  // is refused: it could only be a bug, or somebody sending ids on purpose.
  const exerciseIds = doc.exercises.map((exercise) => exercise.id);
  const setIds = doc.exercises.flatMap((exercise) => exercise.sets.map((set) => set.id));
  if (exerciseIds.length > 0) {
    const clash = await tx
      .select({ id: t.fitnessSessionExercises.id })
      .from(t.fitnessSessionExercises)
      .where(
        and(
          eq(t.fitnessSessionExercises.tenantId, tenantId),
          inArray(t.fitnessSessionExercises.id, exerciseIds),
          ne(t.fitnessSessionExercises.sessionId, doc.id),
        ),
      );
    if (clash.length > 0) throw new FitnessError("INVALID", "Part of that session belongs to another one.");
  }
  if (setIds.length > 0) {
    const clash = await tx
      .select({ id: t.fitnessSets.id })
      .from(t.fitnessSets)
      .where(
        and(
          eq(t.fitnessSets.tenantId, tenantId),
          inArray(t.fitnessSets.id, setIds),
          exerciseIds.length > 0
            ? notInArray(t.fitnessSets.sessionExerciseId, exerciseIds)
            : sql`true`,
        ),
      );
    if (clash.length > 0) throw new FitnessError("INVALID", "Part of that session belongs to another one.");
  }

  if (doc.exercises.length > 0) {
    await tx
      .insert(t.fitnessSessionExercises)
      .values(
        doc.exercises.map((exercise) => ({
          id: exercise.id,
          tenantId,
          sessionId: doc.id,
          itemId: exercise.itemId && known.items.has(exercise.itemId) ? exercise.itemId : null,
          exerciseId:
            exercise.exerciseId && known.exercises.has(exercise.exerciseId) ? exercise.exerciseId : null,
          position: exercise.position,
          name: exercise.name,
          unit: exercise.unit,
          perSide: exercise.perSide,
          effort: exercise.effort,
          cuesFelt: exercise.cuesFelt,
          hurt: exercise.hurt,
          hurtNote: exercise.hurtNote,
          skipped: exercise.skipped,
          finishedAt: instant(exercise.finishedAt, now),
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: t.fitnessSessionExercises.id,
        set: {
          itemId: sql`excluded.item_id`,
          exerciseId: sql`excluded.exercise_id`,
          position: sql`excluded.position`,
          name: sql`excluded.name`,
          unit: sql`excluded.unit`,
          perSide: sql`excluded.per_side`,
          effort: sql`excluded.effort`,
          cuesFelt: sql`excluded.cues_felt`,
          hurt: sql`excluded.hurt`,
          hurtNote: sql`excluded.hurt_note`,
          skipped: sql`excluded.skipped`,
          finishedAt: sql`excluded.finished_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  const sets = doc.exercises.flatMap((exercise) =>
    exercise.sets.map((set) => ({
      id: set.id,
      tenantId,
      sessionExerciseId: exercise.id,
      number: set.number,
      side: set.side,
      target: set.target,
      count: set.count,
      doneAt: instant(set.doneAt, now) as Date,
      updatedAt: now,
    })),
  );
  if (sets.length > 0) {
    await tx
      .insert(t.fitnessSets)
      .values(sets)
      .onConflictDoUpdate({
        target: t.fitnessSets.id,
        set: {
          sessionExerciseId: sql`excluded.session_exercise_id`,
          number: sql`excluded.number`,
          side: sql`excluded.side`,
          target: sql`excluded.target`,
          count: sql`excluded.count`,
          doneAt: sql`excluded.done_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  // What the document no longer has: sets first, then the exercises (whose
  // own sets would go with them anyway).
  const theseExercises = tx
    .select({ id: t.fitnessSessionExercises.id })
    .from(t.fitnessSessionExercises)
    .where(and(eq(t.fitnessSessionExercises.tenantId, tenantId), eq(t.fitnessSessionExercises.sessionId, doc.id)));
  await tx
    .delete(t.fitnessSets)
    .where(
      and(
        eq(t.fitnessSets.tenantId, tenantId),
        inArray(t.fitnessSets.sessionExerciseId, theseExercises),
        setIds.length > 0 ? notInArray(t.fitnessSets.id, setIds) : sql`true`,
      ),
    );
  await tx
    .delete(t.fitnessSessionExercises)
    .where(
      and(
        eq(t.fitnessSessionExercises.tenantId, tenantId),
        eq(t.fitnessSessionExercises.sessionId, doc.id),
        exerciseIds.length > 0 ? notInArray(t.fitnessSessionExercises.id, exerciseIds) : sql`true`,
      ),
    );

  return { revision: doc.revision, stale: false };
}

async function programRows(
  tx: Tx,
  tenantId: string,
  programId: string,
): Promise<{ phases: Set<string>; items: Set<string>; exercises: Set<string> }> {
  const t = schema;
  const [phases, exercises, items] = await Promise.all([
    tx
      .select({ id: t.fitnessPhases.id })
      .from(t.fitnessPhases)
      .where(and(eq(t.fitnessPhases.tenantId, tenantId), eq(t.fitnessPhases.programId, programId))),
    tx
      .select({ id: t.fitnessExercises.id })
      .from(t.fitnessExercises)
      .where(and(eq(t.fitnessExercises.tenantId, tenantId), eq(t.fitnessExercises.programId, programId))),
    tx
      .select({ id: t.fitnessPhaseItems.id })
      .from(t.fitnessPhaseItems)
      .innerJoin(
        t.fitnessPhases,
        and(
          eq(t.fitnessPhases.tenantId, t.fitnessPhaseItems.tenantId),
          eq(t.fitnessPhases.id, t.fitnessPhaseItems.phaseId),
        ),
      )
      .where(and(eq(t.fitnessPhaseItems.tenantId, tenantId), eq(t.fitnessPhases.programId, programId))),
  ]);
  return {
    phases: new Set(phases.map((row) => row.id)),
    exercises: new Set(exercises.map((row) => row.id)),
    items: new Set(items.map((row) => row.id)),
  };
}

/* -- reading ---------------------------------------------------------------------- */

export interface LastSession {
  id: string;
  localDay: string;
  phaseId: string | null;
  phaseName: string;
  finishedAt: Date | null;
  feelBefore: number | null;
  feelAfter: number | null;
  sets: number;
}

/** The most recent session of a program the person is following, if any. */
export async function lastSession(tx: Tx, tenantId: string, programId: string): Promise<LastSession | null> {
  const t = schema;
  const [row] = await tx
    .select({
      id: t.fitnessSessions.id,
      localDay: t.fitnessSessions.localDay,
      phaseId: t.fitnessSessions.phaseId,
      phaseName: t.fitnessSessions.phaseName,
      finishedAt: t.fitnessSessions.finishedAt,
      feelBefore: t.fitnessSessions.feelBefore,
      feelAfter: t.fitnessSessions.feelAfter,
    })
    .from(t.fitnessSessions)
    .innerJoin(
      t.fitnessEnrollments,
      and(
        eq(t.fitnessEnrollments.tenantId, t.fitnessSessions.tenantId),
        eq(t.fitnessEnrollments.id, t.fitnessSessions.enrollmentId),
      ),
    )
    .where(and(eq(t.fitnessSessions.tenantId, tenantId), eq(t.fitnessEnrollments.programId, programId)))
    .orderBy(desc(t.fitnessSessions.startedAt))
    .limit(1);
  if (!row) return null;
  const [counted] = await tx
    .select({ sets: sql<number>`count(*)::int`.mapWith(Number) })
    .from(t.fitnessSets)
    .innerJoin(
      t.fitnessSessionExercises,
      and(
        eq(t.fitnessSessionExercises.tenantId, t.fitnessSets.tenantId),
        eq(t.fitnessSessionExercises.id, t.fitnessSets.sessionExerciseId),
      ),
    )
    .where(and(eq(t.fitnessSets.tenantId, tenantId), eq(t.fitnessSessionExercises.sessionId, row.id)));
  return { ...row, sets: counted?.sets ?? 0 };
}

/** How many sessions deleting a program would take with it (the delete dialog says so). */
export async function sessionCount(tx: Tx, tenantId: string, programId: string): Promise<number> {
  const t = schema;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
    .from(t.fitnessSessions)
    .innerJoin(
      t.fitnessEnrollments,
      and(
        eq(t.fitnessEnrollments.tenantId, t.fitnessSessions.tenantId),
        eq(t.fitnessEnrollments.id, t.fitnessSessions.enrollmentId),
      ),
    )
    .where(and(eq(t.fitnessSessions.tenantId, tenantId), eq(t.fitnessEnrollments.programId, programId)));
  return row?.n ?? 0;
}
