import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { ProgressSource, ProgressWindow } from "@/lib/progress-sources/types";
import { workoutRows, workoutToday, type WorkedOut } from "./core/progress-rows";

/**
 * WORKOUTS IN THE PROGRESS SLOT (docs/modules/health.md, H1): the sessions in
 * a run of days that logged at least one set, in any program, read in the
 * caller's transaction (RLS has decided what it sees), and added up by
 * `core/progress-rows.ts`. Imports only the slot's `types.ts`; the registry
 * names this, and Workouts never learns that Health exists.
 */

async function workedOutBetween(tx: Tx, tenantId: string, from: string, to: string): Promise<WorkedOut[]> {
  const t = schema;
  const rows = await tx
    .select({
      localDay: t.fitnessSessions.localDay,
      startedAt: t.fitnessSessions.startedAt,
      finishedAt: t.fitnessSessions.finishedAt,
      feelBefore: t.fitnessSessions.feelBefore,
      feelAfter: t.fitnessSessions.feelAfter,
      exercises: sql<number>`count(distinct ${t.fitnessSessionExercises.id})`.mapWith(Number),
      // A raw max() comes back as a string; mapped through the column, a Date.
      lastSet: sql<Date>`max(${t.fitnessSets.doneAt})`.mapWith(t.fitnessSets.doneAt),
    })
    .from(t.fitnessSessions)
    .innerJoin(
      t.fitnessSessionExercises,
      and(
        eq(t.fitnessSessionExercises.tenantId, t.fitnessSessions.tenantId),
        eq(t.fitnessSessionExercises.sessionId, t.fitnessSessions.id),
      ),
    )
    .innerJoin(
      t.fitnessSets,
      and(eq(t.fitnessSets.tenantId, t.fitnessSessionExercises.tenantId), eq(t.fitnessSets.sessionExerciseId, t.fitnessSessionExercises.id)),
    )
    .where(and(eq(t.fitnessSessions.tenantId, tenantId), gte(t.fitnessSessions.localDay, from), lte(t.fitnessSessions.localDay, to)))
    .groupBy(t.fitnessSessions.id);
  return rows.map((row) => {
    const ended = row.finishedAt ?? row.lastSet ?? row.startedAt;
    return {
      localDay: row.localDay,
      exercises: row.exercises,
      minutes: Math.max(1, Math.round((ended.getTime() - row.startedAt.getTime()) / 60_000)),
      feelBefore: row.feelBefore,
      feelAfter: row.feelAfter,
      startedAt: row.startedAt,
    };
  });
}

export const fitnessProgressSource: ProgressSource = {
  tool: "fitness",
  name: "Workouts",
  async rows(tx, tenantId, windows: readonly ProgressWindow[]) {
    if (windows.length === 0) return [];
    const from = windows.reduce((min, w) => (w.from < min ? w.from : min), windows[0].from);
    const to = windows.reduce((max, w) => (w.to > max ? w.to : max), windows[0].to);
    return workoutRows(await workedOutBetween(tx, tenantId, from, to), windows);
  },
  async today(tx, tenantId, day) {
    return workoutToday(await workedOutBetween(tx, tenantId, day, day));
  },
};
