import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { FitnessError } from "./core/errors";
import { assessedSide, type Further, type Lean, type SideAnswer } from "./core/side";

/**
 * A PERSON'S SIDE, THE SERVER HALF (docs/modules/fitness.md, F4b part 2). The
 * rules are `core/side.ts`'s; this keeps the answer on the program's open
 * enrollment, which is what "following the program" is.
 */

const e = schema.fitnessEnrollments;

/** The side the tests found, with what was answered and when. Null until the tests are taken. */
export interface SavedSide {
  /** Null when the tests were taken and no side reached the program's number. */
  side: Lean | null;
  answers: SideAnswer[];
  assessedAt: Date;
}

export async function loadSide(tx: Tx, tenantId: string, programId: string): Promise<SavedSide | null> {
  const [row] = await tx
    .select({ side: e.side, answers: e.sideAnswers, assessedAt: e.sideAssessedAt })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.programId, programId), isNull(e.endedAt)));
  if (!row?.assessedAt) return null;
  return { side: row.side, answers: row.answers ?? [], assessedAt: row.assessedAt };
}

/**
 * The tests taken: one answer per test, in the program's order. The side is
 * worked out HERE from the program's own tests, never taken from the phone,
 * and kept with the answers by test name. Taking the tests before the first
 * workout starts following the program, as a first session would.
 */
export async function saveSide(
  tx: Tx,
  tenantId: string,
  input: { programId: string; answers: Further[] },
  today: string,
  now: Date = new Date(),
): Promise<{ side: Lean | null; left: number; right: number }> {
  const t = schema;
  const [program] = await tx
    .select({ id: t.fitnessPrograms.id, assessment: t.fitnessPrograms.assessment })
    .from(t.fitnessPrograms)
    .where(and(eq(t.fitnessPrograms.tenantId, tenantId), eq(t.fitnessPrograms.id, input.programId)));
  if (!program) throw new FitnessError("NOT_FOUND");
  const assessment = program.assessment;
  if (!assessment || assessment.tests.length === 0) {
    throw new FitnessError("INVALID", "This program has no self-assessment to take.");
  }
  if (input.answers.length !== assessment.tests.length) {
    throw new FitnessError("INVALID", "The program's tests changed while you were taking them. Take them again.");
  }
  const result = assessedSide(assessment.tests, input.answers, assessment.least);

  await tx
    .insert(e)
    .values({ tenantId, programId: program.id, startedOn: today })
    .onConflictDoNothing({ target: [e.tenantId, e.programId], where: isNull(e.endedAt) });
  await tx
    .update(e)
    .set({
      side: result.side,
      sideAnswers: assessment.tests.map((test, i) => ({ name: test.name, further: input.answers[i] })),
      sideAssessedAt: now,
      updatedAt: now,
    })
    .where(and(eq(e.tenantId, tenantId), eq(e.programId, program.id), isNull(e.endedAt)));
  return result;
}
