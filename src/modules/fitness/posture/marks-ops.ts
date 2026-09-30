import "server-only";
import type { Tx } from "@/db";
import { programDays } from "../core/progress";
import { dayItemsOf, listPrograms, loadProgram } from "../program-ops";
import { latestFollowed, programSessions } from "../session-ops";
import { postureMarks, type Mark, type MarkCheck } from "./core/marks";

/**
 * EVERY PROGRAM'S POSTURE MARKS (docs/modules/posture.md, slice 3c): the
 * server half of core/marks.ts for the posture pages, which label the checks
 * that marked a program's start or a phase's end, and say what a check now
 * would mark. Only programs with a workout: one never started has nothing but
 * its start, and that is asked for on its own page. Runs inside `withTenant`.
 */
export async function marksOfPrograms(
  tx: Tx,
  tenantId: string,
  checks: readonly MarkCheck[],
  /** The personal space's today, `YYYY-MM-DD`. */
  today: string,
): Promise<{ marks: Mark[]; due: Mark | null }> {
  const [programs, followed] = await Promise.all([listPrograms(tx, tenantId), latestFollowed(tx, tenantId)]);
  const marks: Mark[] = [];
  let due: Mark | null = null;
  for (const summary of programs) {
    const sessions = await programSessions(tx, tenantId, summary.id);
    if (sessions.length === 0) continue;
    const program = await loadProgram(tx, tenantId, summary.id);
    if (!program) continue;
    const days = programDays(program.phases.map((phase) => ({ items: dayItemsOf(phase) })), sessions);
    const result = postureMarks({
      program: { id: program.id, name: program.name, phases: program.phases },
      doneDays: days.perPhase.map((phase) => phase.done),
      sessions,
      checks,
      today,
    });
    marks.push(...result.marks);
    // What a check now would mark: for the program last followed, as the Workouts home says.
    if (program.id === followed?.programId) due = result.due;
  }
  return { marks, due };
}
