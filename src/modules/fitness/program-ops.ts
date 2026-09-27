import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { FitnessVideo } from "@/db/schema";
import { FitnessError } from "./core/errors";
import { breathPace, type ItemInput, type ProgramInput, type VideoInput } from "./core/program";
import type { SessionPlan } from "./core/session";

/**
 * A PROGRAM: saving one from the editor, reading one back, deleting one. Every
 * function takes the transaction it runs in, opened by the action with
 * `withTenant` — RLS is the wall, and these also say `tenant_id` on every
 * statement, the house's belt and braces.
 */

type SaveTarget =
  | { programId: null; source: "imported" | "own" }
  | { programId: string; version: number };

/**
 * SAVE THE EDITOR'S PROGRAM, KEEPING EVERY ROW'S ID (src/db/schema/fitness.ts):
 * rows the input names by id are updated, rows without one are inserted, and
 * rows the input no longer names are deleted. An id the program does not have
 * is a stale editor, refused — never quietly inserted as something new.
 *
 * An edit is checked against the version the editor opened; a second tab's
 * save in between is `STALE`, not a silent overwrite of its work.
 */
export async function saveProgram(
  tx: Tx,
  tenantId: string,
  input: ProgramInput,
  target: SaveTarget,
): Promise<{ programId: string; version: number }> {
  const t = schema;
  let programId: string;
  let version: number;
  if (target.programId !== null) {
    const [current] = await tx
      .select({ id: t.fitnessPrograms.id, version: t.fitnessPrograms.version })
      .from(t.fitnessPrograms)
      .where(and(eq(t.fitnessPrograms.tenantId, tenantId), eq(t.fitnessPrograms.id, target.programId)))
      .for("update");
    if (!current) throw new FitnessError("NOT_FOUND");
    if (current.version !== target.version) throw new FitnessError("STALE");
    programId = current.id;
    version = current.version + 1;
    await tx
      .update(t.fitnessPrograms)
      .set({ ...programColumns(input), version, updatedAt: new Date() })
      .where(and(eq(t.fitnessPrograms.tenantId, tenantId), eq(t.fitnessPrograms.id, programId)));
  } else {
    const [created] = await tx
      .insert(t.fitnessPrograms)
      .values({ tenantId, source: target.source, ...programColumns(input) })
      .returning({ id: t.fitnessPrograms.id, version: t.fitnessPrograms.version });
    programId = created.id;
    version = created.version;
  }

  const existing = await existingRows(tx, tenantId, programId);
  const kept = { phases: new Set<string>(), items: new Set<string>(), exercises: new Set<string>() };

  for (const [p, phase] of input.phases.entries()) {
    let phaseId: string;
    const phaseValues = {
      position: p,
      name: phase.name,
      minDoneDays: phase.minDoneDays,
      notes: phase.notes,
    };
    if (phase.phaseId !== null) {
      if (!existing.phases.has(phase.phaseId)) throw new FitnessError("STALE");
      await tx
        .update(t.fitnessPhases)
        .set({ ...phaseValues, updatedAt: new Date() })
        .where(and(eq(t.fitnessPhases.tenantId, tenantId), eq(t.fitnessPhases.id, phase.phaseId)));
      phaseId = phase.phaseId;
    } else {
      const [row] = await tx
        .insert(t.fitnessPhases)
        .values({ tenantId, programId, ...phaseValues })
        .returning({ id: t.fitnessPhases.id });
      phaseId = row.id;
    }
    kept.phases.add(phaseId);

    for (const [i, item] of phase.items.entries()) {
      const exerciseId = await saveExercise(tx, tenantId, programId, item, existing.exercises);
      kept.exercises.add(exerciseId);
      const itemValues = {
        phaseId,
        exerciseId,
        position: i,
        setsMin: item.setsMin,
        setsMax: item.setsMax,
        targetMin: item.targetMin,
        targetMax: item.targetMax,
        perSide: item.perSide,
        optional: item.optional,
        notes: item.notes,
      };
      if (item.itemId !== null) {
        if (!existing.items.has(item.itemId)) throw new FitnessError("STALE");
        await tx
          .update(t.fitnessPhaseItems)
          .set({ ...itemValues, updatedAt: new Date() })
          .where(and(eq(t.fitnessPhaseItems.tenantId, tenantId), eq(t.fitnessPhaseItems.id, item.itemId)));
        kept.items.add(item.itemId);
      } else {
        const [row] = await tx
          .insert(t.fitnessPhaseItems)
          .values({ tenantId, ...itemValues })
          .returning({ id: t.fitnessPhaseItems.id });
        kept.items.add(row.id);
      }
    }
  }

  // What the edit dropped. Items first: they point at exercises. A phase's
  // delete would take its items anyway, but an item MOVED out of a dropped
  // phase already points at its new one, so it survives.
  const droppedItems = [...existing.items].filter((id) => !kept.items.has(id));
  if (droppedItems.length > 0) {
    await tx
      .delete(t.fitnessPhaseItems)
      .where(and(eq(t.fitnessPhaseItems.tenantId, tenantId), inArray(t.fitnessPhaseItems.id, droppedItems)));
  }
  const droppedPhases = [...existing.phases].filter((id) => !kept.phases.has(id));
  if (droppedPhases.length > 0) {
    await tx
      .delete(t.fitnessPhases)
      .where(and(eq(t.fitnessPhases.tenantId, tenantId), inArray(t.fitnessPhases.id, droppedPhases)));
  }
  const droppedExercises = [...existing.exercises].filter((id) => !kept.exercises.has(id));
  if (droppedExercises.length > 0) {
    await tx
      .delete(t.fitnessExercises)
      .where(and(eq(t.fitnessExercises.tenantId, tenantId), inArray(t.fitnessExercises.id, droppedExercises)));
  }

  return { programId, version };
}

function programColumns(input: ProgramInput) {
  return {
    name: input.name,
    author: input.author,
    notes: input.notes,
    sessionsPerWeekMin: input.sessionsPerWeekMin,
    sessionsPerWeekMax: input.sessionsPerWeekMax,
    effortMin: input.effortMin,
    effortMax: input.effortMax,
    breathOutS: input.breathOutS,
    breathInS: input.breathInS,
  };
}

function storedVideos(videos: VideoInput[]): FitnessVideo[] {
  return videos.map((video) => ({ provider: "youtube", ...video }));
}

async function saveExercise(
  tx: Tx,
  tenantId: string,
  programId: string,
  item: ItemInput,
  existing: Set<string>,
): Promise<string> {
  const t = schema;
  const values = {
    name: item.name,
    purpose: item.purpose,
    cues: item.cues,
    unit: item.unit,
    videos: storedVideos(item.videos),
  };
  if (item.exerciseId !== null) {
    if (!existing.has(item.exerciseId)) throw new FitnessError("STALE");
    await tx
      .update(t.fitnessExercises)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(t.fitnessExercises.tenantId, tenantId), eq(t.fitnessExercises.id, item.exerciseId)));
    return item.exerciseId;
  }
  const [row] = await tx
    .insert(t.fitnessExercises)
    .values({ tenantId, programId, ...values })
    .returning({ id: t.fitnessExercises.id });
  return row.id;
}

async function existingRows(
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
    phases: new Set(phases.map((r) => r.id)),
    exercises: new Set(exercises.map((r) => r.id)),
    items: new Set(items.map((r) => r.id)),
  };
}

/** Delete a program and everything in it (the foreign keys cascade). */
export async function deleteProgram(tx: Tx, tenantId: string, programId: string): Promise<void> {
  const t = schema;
  const deleted = await tx
    .delete(t.fitnessPrograms)
    .where(and(eq(t.fitnessPrograms.tenantId, tenantId), eq(t.fitnessPrograms.id, programId)))
    .returning({ id: t.fitnessPrograms.id });
  if (deleted.length === 0) throw new FitnessError("NOT_FOUND");
}

/* -- Reading ------------------------------------------------------------- */

export interface ProgramSummary {
  id: string;
  name: string;
  author: string;
  source: "imported" | "own";
  phaseCount: number;
  exerciseCount: number;
  createdAt: Date;
}

/** The programs on the Workouts page, newest first. */
export async function listPrograms(tx: Tx, tenantId: string): Promise<ProgramSummary[]> {
  const t = schema;
  return tx
    .select({
      id: t.fitnessPrograms.id,
      name: t.fitnessPrograms.name,
      author: t.fitnessPrograms.author,
      source: t.fitnessPrograms.source,
      createdAt: t.fitnessPrograms.createdAt,
      // The outer table is named in full: drizzle writes a column in a raw
      // fragment unqualified, and inside these subqueries a bare "tenant_id"
      // is ambiguous (42702) — caught by tests/fitness-ops.test.ts.
      phaseCount: sql<number>`(
        select count(*)::int from fitness_phases p
         where p.tenant_id = fitness_programs.tenant_id and p.program_id = fitness_programs.id
      )`.mapWith(Number),
      exerciseCount: sql<number>`(
        select count(*)::int from fitness_phase_items i
          join fitness_phases p on p.tenant_id = i.tenant_id and p.id = i.phase_id
         where p.tenant_id = fitness_programs.tenant_id and p.program_id = fitness_programs.id
      )`.mapWith(Number),
    })
    .from(t.fitnessPrograms)
    .where(and(eq(t.fitnessPrograms.tenantId, tenantId), isNull(t.fitnessPrograms.archivedAt)))
    .orderBy(desc(t.fitnessPrograms.createdAt));
}

export interface LoadedItem {
  id: string;
  position: number;
  setsMin: number;
  setsMax: number | null;
  targetMin: number;
  targetMax: number | null;
  perSide: boolean;
  optional: boolean;
  notes: string;
  exercise: {
    id: string;
    name: string;
    purpose: string;
    cues: string[];
    unit: "reps" | "breaths" | "rolls" | "seconds";
    videos: FitnessVideo[];
  };
}

export interface LoadedPhase {
  id: string;
  position: number;
  name: string;
  minDoneDays: number | null;
  notes: string;
  items: LoadedItem[];
}

export interface LoadedProgram {
  id: string;
  name: string;
  author: string;
  source: "imported" | "own";
  notes: string;
  sessionsPerWeekMin: number | null;
  sessionsPerWeekMax: number | null;
  effortMin: number | null;
  effortMax: number | null;
  breathOutS: number | null;
  breathInS: number | null;
  version: number;
  phases: LoadedPhase[];
}

/** One program, whole: its phases in order and each phase's exercises in order. */
export async function loadProgram(
  tx: Tx,
  tenantId: string,
  programId: string,
): Promise<LoadedProgram | null> {
  const t = schema;
  const [program] = await tx
    .select()
    .from(t.fitnessPrograms)
    .where(and(eq(t.fitnessPrograms.tenantId, tenantId), eq(t.fitnessPrograms.id, programId)));
  if (!program) return null;
  const phases = await tx
    .select()
    .from(t.fitnessPhases)
    .where(and(eq(t.fitnessPhases.tenantId, tenantId), eq(t.fitnessPhases.programId, programId)))
    .orderBy(asc(t.fitnessPhases.position));
  const items = await tx
    .select({ item: t.fitnessPhaseItems, exercise: t.fitnessExercises })
    .from(t.fitnessPhaseItems)
    .innerJoin(
      t.fitnessExercises,
      and(
        eq(t.fitnessExercises.tenantId, t.fitnessPhaseItems.tenantId),
        eq(t.fitnessExercises.id, t.fitnessPhaseItems.exerciseId),
      ),
    )
    .where(and(eq(t.fitnessPhaseItems.tenantId, tenantId), eq(t.fitnessExercises.programId, programId)))
    .orderBy(asc(t.fitnessPhaseItems.position));
  return {
    id: program.id,
    name: program.name,
    author: program.author,
    source: program.source,
    notes: program.notes,
    sessionsPerWeekMin: program.sessionsPerWeekMin,
    sessionsPerWeekMax: program.sessionsPerWeekMax,
    effortMin: program.effortMin,
    effortMax: program.effortMax,
    breathOutS: program.breathOutS,
    breathInS: program.breathInS,
    version: program.version,
    phases: phases.map((phase) => ({
      id: phase.id,
      position: phase.position,
      name: phase.name,
      minDoneDays: phase.minDoneDays,
      notes: phase.notes,
      items: items
        .filter((row) => row.item.phaseId === phase.id)
        .map(({ item, exercise }) => ({
          id: item.id,
          position: item.position,
          setsMin: item.setsMin,
          setsMax: item.setsMax,
          targetMin: item.targetMin,
          targetMax: item.targetMax,
          perSide: item.perSide,
          optional: item.optional,
          notes: item.notes,
          exercise: {
            id: exercise.id,
            name: exercise.name,
            purpose: exercise.purpose,
            cues: exercise.cues,
            unit: exercise.unit,
            videos: exercise.videos,
          },
        })),
    })),
  };
}

/** A loaded program back into the editor's shape, every row carrying its id. */
export function programToInput(program: LoadedProgram): ProgramInput {
  return {
    name: program.name,
    author: program.author,
    notes: program.notes,
    sessionsPerWeekMin: program.sessionsPerWeekMin,
    sessionsPerWeekMax: program.sessionsPerWeekMax,
    effortMin: program.effortMin,
    effortMax: program.effortMax,
    breathOutS: program.breathOutS,
    breathInS: program.breathInS,
    phases: program.phases.map((phase) => ({
      phaseId: phase.id,
      name: phase.name,
      minDoneDays: phase.minDoneDays,
      notes: phase.notes,
      items: phase.items.map((item) => ({
        itemId: item.id,
        exerciseId: item.exercise.id,
        name: item.exercise.name,
        purpose: item.exercise.purpose,
        cues: item.exercise.cues,
        unit: item.exercise.unit,
        videos: item.exercise.videos.map(({ id, startS, endS, label, embeddable }) => ({
          id,
          startS,
          endS,
          label,
          embeddable,
        })),
        setsMin: item.setsMin,
        setsMax: item.setsMax,
        targetMin: item.targetMin,
        targetMax: item.targetMax,
        perSide: item.perSide,
        optional: item.optional,
        notes: item.notes,
      })),
    })),
  };
}

/**
 * A phase of a loaded program as workout mode runs it (core/session.ts): the
 * items in order with what each asks, the program's breathing pace and effort
 * zone, and each exercise's first video, which is THE video.
 */
export function sessionPlan(program: LoadedProgram, phaseIndex: number): SessionPlan {
  const phase = program.phases[phaseIndex];
  return {
    programId: program.id,
    programName: program.name,
    phaseId: phase.id,
    phaseName: phase.name,
    phaseIndex,
    phaseCount: program.phases.length,
    phases: program.phases.map((p) => ({ id: p.id, name: p.name })),
    breath: breathPace(program),
    effort:
      program.effortMin != null ? { min: program.effortMin, max: program.effortMax ?? program.effortMin } : null,
    items: phase.items.map((item) => {
      const video = item.exercise.videos[0];
      return {
        itemId: item.id,
        exerciseId: item.exercise.id,
        name: item.exercise.name,
        purpose: item.exercise.purpose,
        cues: item.exercise.cues,
        unit: item.exercise.unit,
        perSide: item.perSide,
        optional: item.optional,
        setsMin: item.setsMin,
        setsMax: item.setsMax,
        targetMin: item.targetMin,
        targetMax: item.targetMax,
        notes: item.notes,
        video: video
          ? { id: video.id, startS: video.startS, endS: video.endS, embeddable: video.embeddable }
          : null,
      };
    }),
  };
}
