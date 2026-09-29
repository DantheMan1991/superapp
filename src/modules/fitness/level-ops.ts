import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { FitnessError } from "./core/errors";
import type { Side } from "./core/session";

/**
 * AN EXERCISE'S LEVELS, THE SERVER HALF (docs/modules/fitness.md, F4c). The
 * rules are `core/levels.ts`'s; this keeps the person's level on the
 * program's open enrollment, and finds each exercise's latest try for the
 * program page's "Ready for" line. A move up chosen in a workout arrives
 * with the session instead (`saveSession`).
 */

const e = schema.fitnessEnrollments;

/** The person's level for each item with levels: the item's id to a 0-based level. */
export async function loadLevels(tx: Tx, tenantId: string, programId: string): Promise<Record<string, number>> {
  const [row] = await tx
    .select({ levels: e.levels })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.programId, programId), isNull(e.endedAt)));
  return row?.levels ?? {};
}

/**
 * Put the person on a level of an exercise, from the program page's Move up
 * or Back a level. The level must be one the exercise has. Choosing a level
 * before the first workout starts following the program, as a first session
 * would.
 */
export async function setLevel(
  tx: Tx,
  tenantId: string,
  input: { programId: string; itemId: string; level: number },
  today: string,
): Promise<void> {
  const t = schema;
  const [item] = await tx
    .select({ progression: t.fitnessPhaseItems.progression })
    .from(t.fitnessPhaseItems)
    .innerJoin(
      t.fitnessPhases,
      and(eq(t.fitnessPhases.tenantId, t.fitnessPhaseItems.tenantId), eq(t.fitnessPhases.id, t.fitnessPhaseItems.phaseId)),
    )
    .where(
      and(
        eq(t.fitnessPhaseItems.tenantId, tenantId),
        eq(t.fitnessPhaseItems.id, input.itemId),
        eq(t.fitnessPhases.programId, input.programId),
      ),
    );
  if (!item) throw new FitnessError("NOT_FOUND");
  const count = item.progression?.levels.length ?? 0;
  if (input.level >= count) {
    throw new FitnessError("INVALID", "That level is not one this exercise has. Reload the page and try again.");
  }
  await tx
    .insert(e)
    .values({ tenantId, programId: input.programId, startedOn: today })
    .onConflictDoNothing({ target: [e.tenantId, e.programId], where: isNull(e.endedAt) });
  const [row] = await tx
    .select({ levels: e.levels })
    .from(e)
    .where(and(eq(e.tenantId, tenantId), eq(e.programId, input.programId), isNull(e.endedAt)));
  await tx
    .update(e)
    .set({ levels: { ...(row?.levels ?? {}), [input.itemId]: input.level }, updatedAt: new Date() })
    .where(and(eq(e.tenantId, tenantId), eq(e.programId, input.programId), isNull(e.endedAt)));
}

/** One go at an exercise with levels: what the mark is judged on. */
export interface LevelTry {
  level: number;
  perSide: boolean;
  effort: number | null;
  hurt: "none" | "pinch" | "yes" | null;
  sets: { side: Side | null; count: number }[];
}

/**
 * Each item's latest go, from the newest session that did it, for the items
 * asked about. An exercise skipped, or done before it had levels, is not a go.
 */
export async function latestTries(tx: Tx, tenantId: string, itemIds: readonly string[]): Promise<Map<string, LevelTry>> {
  const out = new Map<string, LevelTry>();
  if (itemIds.length === 0) return out;
  const t = schema;
  const rows = await tx
    .select({
      id: t.fitnessSessionExercises.id,
      itemId: t.fitnessSessionExercises.itemId,
      level: t.fitnessSessionExercises.level,
      perSide: t.fitnessSessionExercises.perSide,
      effort: t.fitnessSessionExercises.effort,
      hurt: t.fitnessSessionExercises.hurt,
    })
    .from(t.fitnessSessionExercises)
    .innerJoin(
      t.fitnessSessions,
      and(
        eq(t.fitnessSessions.tenantId, t.fitnessSessionExercises.tenantId),
        eq(t.fitnessSessions.id, t.fitnessSessionExercises.sessionId),
      ),
    )
    .where(
      and(
        eq(t.fitnessSessionExercises.tenantId, tenantId),
        inArray(t.fitnessSessionExercises.itemId, [...itemIds]),
        eq(t.fitnessSessionExercises.skipped, false),
      ),
    )
    .orderBy(desc(t.fitnessSessions.startedAt), desc(t.fitnessSessionExercises.updatedAt));
  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.itemId !== null && row.level !== null && !newest.has(row.itemId)) newest.set(row.itemId, row);
  }
  if (newest.size === 0) return out;
  const sets = await tx
    .select({
      exerciseId: t.fitnessSets.sessionExerciseId,
      side: t.fitnessSets.side,
      count: t.fitnessSets.count,
    })
    .from(t.fitnessSets)
    .where(
      and(
        eq(t.fitnessSets.tenantId, tenantId),
        inArray(
          t.fitnessSets.sessionExerciseId,
          [...newest.values()].map((row) => row.id),
        ),
      ),
    );
  for (const [itemId, row] of newest) {
    out.set(itemId, {
      level: row.level as number,
      perSide: row.perSide,
      effort: row.effort,
      hurt: row.hurt,
      sets: sets.filter((set) => set.exerciseId === row.id).map((set) => ({ side: set.side, count: set.count })),
    });
  }
  return out;
}
