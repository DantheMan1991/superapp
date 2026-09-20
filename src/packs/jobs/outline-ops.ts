import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  JobEstimateOutline,
  JobEstimateOutlineQuestion,
  JobEstimateOutlineStep,
  OutlineQuestionKind,
} from "@/db/schema";
import { violatedUniqueIndex } from "@/lib/db-errors";
import {
  normalizeChoices,
  outlineIssue,
  sortOrderAt,
  type OutlineStepShape,
  type OutlineSummary,
} from "./outline-math";
import { JobsError, requireWrite, type JobsCtx } from "./ops";

/**
 * ESTIMATE OUTLINES (X1, ADR 0098) — reading and writing the walk.
 *
 * OWNER-ONLY TO WRITE, member-wide to read, the same division the chart of
 * cost has and for the same reason: the order a business prices a job in is a
 * decision, and an estimator being walked through it has to be able to read
 * it. RLS cannot make that split — it is row-level, not verb-level — so it is
 * `requireWrite(ctx, "owner")` here and a member-wide policy underneath.
 *
 * THE WHOLE OUTLINE SAVES AT ONCE, and a row keeps its id across the save:
 * given by id it is updated, absent it is inserted, left out it is removed.
 * That is the estimate's own rule (ADR 0082) and this table needs it more,
 * not less — an answer recorded in an interview points at a QUESTION, so a
 * save that re-created every row would orphan a transcript every time
 * somebody fixed a typo.
 */

/** An outline as the picker and the list show it. */
export interface OutlineRow {
  outline: JobEstimateOutline;
  summary: OutlineSummary;
}

/** An outline with everything under it, in order. */
export interface LoadedOutline {
  outline: JobEstimateOutline;
  steps: (JobEstimateOutlineStep & { questions: JobEstimateOutlineQuestion[] })[];
}

/** The options of a `choice`, read back out of the jsonb as the strings they are. */
export function choicesOf(question: Pick<JobEstimateOutlineQuestion, "choices">): string[] {
  const raw = question.choices;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

async function stepsOf(
  tx: Tx,
  tenantId: string,
  outlineId: string,
): Promise<JobEstimateOutlineStep[]> {
  return tx
    .select()
    .from(schema.jobEstimateOutlineSteps)
    .where(
      and(
        eq(schema.jobEstimateOutlineSteps.tenantId, tenantId),
        eq(schema.jobEstimateOutlineSteps.outlineId, outlineId),
      ),
    )
    .orderBy(
      asc(schema.jobEstimateOutlineSteps.sortOrder),
      asc(schema.jobEstimateOutlineSteps.title),
    );
}

async function questionsOf(
  tx: Tx,
  tenantId: string,
  stepIds: string[],
): Promise<JobEstimateOutlineQuestion[]> {
  if (stepIds.length === 0) return [];
  return tx
    .select()
    .from(schema.jobEstimateOutlineQuestions)
    .where(
      and(
        eq(schema.jobEstimateOutlineQuestions.tenantId, tenantId),
        inArray(schema.jobEstimateOutlineQuestions.stepId, stepIds),
      ),
    )
    .orderBy(asc(schema.jobEstimateOutlineQuestions.sortOrder));
}

export async function listOutlines(tx: Tx, tenantId: string): Promise<OutlineRow[]> {
  const outlines = await tx
    .select()
    .from(schema.jobEstimateOutlines)
    .where(eq(schema.jobEstimateOutlines.tenantId, tenantId))
    .orderBy(
      desc(schema.jobEstimateOutlines.isDefault),
      asc(schema.jobEstimateOutlines.name),
    );
  if (outlines.length === 0) return [];

  /**
   * One read for every step and one for every question, not one per outline:
   * a business with eight outlines is eight round trips the settings page does
   * not need to make.
   */
  const allSteps = await tx
    .select()
    .from(schema.jobEstimateOutlineSteps)
    .where(eq(schema.jobEstimateOutlineSteps.tenantId, tenantId));
  const allQuestions = await tx
    .select({
      stepId: schema.jobEstimateOutlineQuestions.stepId,
    })
    .from(schema.jobEstimateOutlineQuestions)
    .where(eq(schema.jobEstimateOutlineQuestions.tenantId, tenantId));

  const questionsByStep = new Map<string, number>();
  for (const q of allQuestions) {
    questionsByStep.set(q.stepId, (questionsByStep.get(q.stepId) ?? 0) + 1);
  }
  const byOutline = new Map<string, OutlineSummary>();
  for (const s of allSteps) {
    const summary = byOutline.get(s.outlineId) ?? {
      steps: 0,
      questions: 0,
      silentSteps: 0,
      uncodedSteps: 0,
    };
    const count = questionsByStep.get(s.id) ?? 0;
    summary.steps += 1;
    summary.questions += count;
    if (count === 0) summary.silentSteps += 1;
    if (s.costCode.trim() === "") summary.uncodedSteps += 1;
    byOutline.set(s.outlineId, summary);
  }

  return outlines.map((outline) => ({
    outline,
    summary:
      byOutline.get(outline.id) ??
      { steps: 0, questions: 0, silentSteps: 0, uncodedSteps: 0 },
  }));
}

export async function getDefaultOutline(
  tx: Tx,
  tenantId: string,
): Promise<JobEstimateOutline | null> {
  const rows = await tx
    .select()
    .from(schema.jobEstimateOutlines)
    .where(
      and(
        eq(schema.jobEstimateOutlines.tenantId, tenantId),
        eq(schema.jobEstimateOutlines.isDefault, true),
        eq(schema.jobEstimateOutlines.isActive, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function loadOutline(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<LoadedOutline | null> {
  const rows = await tx
    .select()
    .from(schema.jobEstimateOutlines)
    .where(
      and(
        eq(schema.jobEstimateOutlines.tenantId, tenantId),
        eq(schema.jobEstimateOutlines.id, id),
      ),
    )
    .limit(1);
  const outline = rows[0];
  if (!outline) return null;

  const steps = await stepsOf(tx, tenantId, id);
  const questions = await questionsOf(
    tx,
    tenantId,
    steps.map((s) => s.id),
  );
  const byStep = new Map<string, JobEstimateOutlineQuestion[]>();
  for (const q of questions) {
    const list = byStep.get(q.stepId) ?? [];
    list.push(q);
    byStep.set(q.stepId, list);
  }
  return {
    outline,
    steps: steps.map((s) => ({ ...s, questions: byStep.get(s.id) ?? [] })),
  };
}

export interface OutlineInput {
  name: string;
  notes?: string;
  isDefault?: boolean;
  steps?: OutlineStepShape[];
}

/**
 * **CLEARING THE OLD DEFAULT IS PART OF SETTING THE NEW ONE**, exactly as the
 * chart of cost does it: the partial unique index is the backstop, and this is
 * the mechanism, in the same transaction.
 */
async function clearOtherDefaults(
  tx: Tx,
  tenantId: string,
  exceptId: string | null,
): Promise<void> {
  const rows = await tx
    .select({ id: schema.jobEstimateOutlines.id })
    .from(schema.jobEstimateOutlines)
    .where(
      and(
        eq(schema.jobEstimateOutlines.tenantId, tenantId),
        eq(schema.jobEstimateOutlines.isDefault, true),
      ),
    );
  const gone = rows.map((r) => r.id).filter((id) => id !== exceptId);
  if (gone.length === 0) return;
  await tx
    .update(schema.jobEstimateOutlines)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateOutlines.tenantId, tenantId),
        inArray(schema.jobEstimateOutlines.id, gone),
      ),
    );
}

function nameTaken(err: unknown): boolean {
  return violatedUniqueIndex(err) === "job_estimate_outlines_tenant_name_idx";
}

export async function createOutline(
  tx: Tx,
  ctx: JobsCtx,
  input: OutlineInput,
): Promise<JobEstimateOutline> {
  requireWrite(ctx, "owner");
  const name = input.name.trim();
  if (name === "") throw new JobsError("INVALID_VALUE", "an outline needs a name");
  const steps = input.steps ?? [];
  if (steps.length > 0) {
    const issue = outlineIssue(steps);
    if (issue) throw new JobsError("INVALID_VALUE", issue);
  }

  /**
   * THE FIRST OUTLINE IS THE DEFAULT, whether or not anybody asked — the
   * chart of cost's rule. A business with one way of walking an estimate must
   * never be asked which one to use.
   */
  const existing = await tx
    .select({ id: schema.jobEstimateOutlines.id })
    .from(schema.jobEstimateOutlines)
    .where(eq(schema.jobEstimateOutlines.tenantId, ctx.tenantId));
  const isDefault = input.isDefault ?? existing.length === 0;
  if (isDefault) await clearOtherDefaults(tx, ctx.tenantId, null);

  let outline: JobEstimateOutline;
  try {
    const rows = await tx
      .insert(schema.jobEstimateOutlines)
      .values({
        tenantId: ctx.tenantId,
        name,
        notes: input.notes?.trim() ?? "",
        isDefault,
        createdByClerkUserId: ctx.userId,
      })
      .returning();
    outline = rows[0];
  } catch (err) {
    if (nameTaken(err)) {
      throw new JobsError("NAME_TAKEN", `an outline called "${name}" already exists`);
    }
    throw err;
  }

  if (steps.length > 0) await writeSteps(tx, ctx.tenantId, outline.id, steps);
  return outline;
}

export interface OutlinePatch {
  name?: string;
  notes?: string;
  isActive?: boolean;
  steps?: OutlineStepShape[];
  /** The version the editor loaded, so two people editing cannot silently overwrite. */
  version?: number;
}

export async function updateOutline(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  patch: OutlinePatch,
): Promise<JobEstimateOutline> {
  requireWrite(ctx, "owner");
  const loaded = await loadOutline(tx, ctx.tenantId, id);
  if (!loaded) throw new JobsError("NOT_FOUND", `outline ${id} does not exist`);
  if (patch.version !== undefined && patch.version !== loaded.outline.version) {
    throw new JobsError("STALE_VERSION", "outline changed since it was loaded");
  }
  if (patch.steps !== undefined) {
    const issue = outlineIssue(patch.steps);
    if (issue) throw new JobsError("INVALID_VALUE", issue);
  }

  const values: Partial<typeof schema.jobEstimateOutlines.$inferInsert> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name === "") throw new JobsError("INVALID_VALUE", "an outline needs a name");
    values.name = name;
  }
  if (patch.notes !== undefined) values.notes = patch.notes.trim();
  if (patch.isActive !== undefined) values.isActive = patch.isActive;

  if (patch.steps !== undefined) {
    await writeSteps(tx, ctx.tenantId, id, patch.steps);
  }

  try {
    const rows = await tx
      .update(schema.jobEstimateOutlines)
      .set({
        ...values,
        version: loaded.outline.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.jobEstimateOutlines.tenantId, ctx.tenantId),
          eq(schema.jobEstimateOutlines.id, id),
        ),
      )
      .returning();
    return rows[0];
  } catch (err) {
    if (nameTaken(err)) {
      throw new JobsError("NAME_TAKEN", `an outline called "${values.name}" already exists`);
    }
    throw err;
  }
}

/**
 * The steps given, in the order given — updated by id, inserted when new,
 * removed when left out. Their questions follow the same rule one level down.
 *
 * ── IT BATCHES, AND IT HAS TO ───────────────────────────────────────────────
 *
 * The obvious shape is a loop: insert a step, select its questions, insert
 * each one. Against a serverless Postgres that is one round trip per row, and
 * the construction profile's two starters are 56 steps and 150 questions —
 * over four hundred trips, which took a profile install past THIRTY SECONDS
 * and timed the seed test out. So: two reads at the top, ids minted here
 * rather than by the database, and one multi-row insert per table.
 *
 * **MINTING THE IDS IS WHAT MAKES THE BATCH POSSIBLE.** A question needs its
 * step's id before either row exists, and `RETURNING` from a multi-row insert
 * gives no order this can rely on. `randomUUID()` gives every new row its
 * identity up front, so the whole tree is known before a single write.
 */
async function writeSteps(
  tx: Tx,
  tenantId: string,
  outlineId: string,
  steps: readonly OutlineStepShape[],
): Promise<void> {
  const existingSteps = await stepsOf(tx, tenantId, outlineId);
  const existingQuestions = await questionsOf(
    tx,
    tenantId,
    existingSteps.map((s) => s.id),
  );
  const stepById = new Map(existingSteps.map((s) => [s.id, s]));
  const questionById = new Map(existingQuestions.map((q) => [q.id, q]));

  type StepInsert = typeof schema.jobEstimateOutlineSteps.$inferInsert;
  type QuestionInsert = typeof schema.jobEstimateOutlineQuestions.$inferInsert;
  const stepInserts: StepInsert[] = [];
  const questionInserts: QuestionInsert[] = [];
  const stepUpdates: { id: string; values: Partial<StepInsert> }[] = [];
  const questionUpdates: { id: string; values: Partial<QuestionInsert> }[] = [];
  const keptSteps = new Set<string>();
  const keptQuestions = new Set<string>();

  for (const [index, step] of steps.entries()) {
    const values = {
      title: step.title.trim(),
      costCode: (step.costCode ?? "").trim(),
      guidance: (step.guidance ?? "").trim(),
      sortOrder: sortOrderAt(index),
    };

    let stepId: string;
    if (step.id) {
      const row = stepById.get(step.id);
      if (!row) {
        throw new JobsError("NOT_FOUND", `step ${step.id} is not on this outline`);
      }
      stepId = step.id;
      /** An untouched step writes nothing, so its version still means something. */
      if (
        row.title !== values.title ||
        row.costCode !== values.costCode ||
        row.guidance !== values.guidance ||
        row.sortOrder !== values.sortOrder
      ) {
        stepUpdates.push({
          id: stepId,
          values: { ...values, version: row.version + 1, updatedAt: new Date() },
        });
      }
    } else {
      stepId = randomUUID();
      stepInserts.push({ id: stepId, tenantId, outlineId, ...values });
    }
    keptSteps.add(stepId);

    for (const [qIndex, question] of (step.questions ?? []).entries()) {
      const kind = question.kind ?? "text";
      const values = {
        prompt: question.prompt.trim(),
        kind,
        choices: normalizeChoices(kind, question.choices),
        unit: (question.unit ?? "").trim(),
        notes: (question.notes ?? "").trim(),
        alwaysAsk: question.alwaysAsk === true,
        sortOrder: sortOrderAt(qIndex),
      };
      if (question.id) {
        const row = questionById.get(question.id);
        if (!row) {
          throw new JobsError("NOT_FOUND", `question ${question.id} is not on this outline`);
        }
        keptQuestions.add(question.id);
        const sameChoices =
          JSON.stringify(choicesOf(row)) === JSON.stringify(values.choices);
        if (
          row.stepId !== stepId ||
          row.prompt !== values.prompt ||
          row.kind !== values.kind ||
          row.unit !== values.unit ||
          row.notes !== values.notes ||
          row.alwaysAsk !== values.alwaysAsk ||
          row.sortOrder !== values.sortOrder ||
          !sameChoices
        ) {
          /** `stepId` rides along so a question dragged into another step follows it. */
          questionUpdates.push({
            id: question.id,
            values: { ...values, stepId, version: row.version + 1, updatedAt: new Date() },
          });
        }
      } else {
        const id = randomUUID();
        keptQuestions.add(id);
        questionInserts.push({ id, tenantId, stepId, ...values });
      }
    }
  }

  /** Steps before questions: a question's foreign key needs its step to exist. */
  if (stepInserts.length > 0) {
    await tx.insert(schema.jobEstimateOutlineSteps).values(stepInserts);
  }
  for (const { id, values } of stepUpdates) {
    await tx
      .update(schema.jobEstimateOutlineSteps)
      .set(values)
      .where(
        and(
          eq(schema.jobEstimateOutlineSteps.tenantId, tenantId),
          eq(schema.jobEstimateOutlineSteps.id, id),
        ),
      );
  }
  if (questionInserts.length > 0) {
    await tx.insert(schema.jobEstimateOutlineQuestions).values(questionInserts);
  }
  for (const { id, values } of questionUpdates) {
    await tx
      .update(schema.jobEstimateOutlineQuestions)
      .set(values)
      .where(
        and(
          eq(schema.jobEstimateOutlineQuestions.tenantId, tenantId),
          eq(schema.jobEstimateOutlineQuestions.id, id),
        ),
      );
  }

  /**
   * A question whose STEP is gone needs no delete — the cascade takes it —
   * so only the ones left out of a surviving step are named here.
   */
  const goneQuestions = existingQuestions
    .filter((q) => keptSteps.has(q.stepId) && !keptQuestions.has(q.id))
    .map((q) => q.id);
  if (goneQuestions.length > 0) {
    await tx
      .delete(schema.jobEstimateOutlineQuestions)
      .where(
        and(
          eq(schema.jobEstimateOutlineQuestions.tenantId, tenantId),
          inArray(schema.jobEstimateOutlineQuestions.id, goneQuestions),
        ),
      );
  }
  const goneSteps = existingSteps.filter((s) => !keptSteps.has(s.id)).map((s) => s.id);
  if (goneSteps.length > 0) {
    await tx
      .delete(schema.jobEstimateOutlineSteps)
      .where(
        and(
          eq(schema.jobEstimateOutlineSteps.tenantId, tenantId),
          inArray(schema.jobEstimateOutlineSteps.id, goneSteps),
        ),
      );
  }
}

export async function setDefaultOutline(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
): Promise<JobEstimateOutline> {
  requireWrite(ctx, "owner");
  await clearOtherDefaults(tx, ctx.tenantId, id);
  const rows = await tx
    .update(schema.jobEstimateOutlines)
    .set({ isDefault: true, isActive: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateOutlines.tenantId, ctx.tenantId),
        eq(schema.jobEstimateOutlines.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `outline ${id} does not exist`);
  return rows[0];
}

/**
 * HOW A SECOND OUTLINE ACTUALLY GETS MADE. Nobody writes a remodel outline
 * from nothing; they take the new-build one, delete the phases a remodel does
 * not have and add demolition. The copy carries every step and question and
 * none of the identity — it is never the default, and its rows are new, so
 * editing it cannot reach the original.
 */
export async function duplicateOutline(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  name: string,
): Promise<JobEstimateOutline> {
  requireWrite(ctx, "owner");
  const loaded = await loadOutline(tx, ctx.tenantId, id);
  if (!loaded) throw new JobsError("NOT_FOUND", `outline ${id} does not exist`);
  return createOutline(tx, ctx, {
    name,
    notes: loaded.outline.notes,
    isDefault: false,
    steps: loaded.steps.map((step) => ({
      title: step.title,
      costCode: step.costCode,
      guidance: step.guidance,
      questions: step.questions.map((q) => ({
        prompt: q.prompt,
        kind: q.kind as OutlineQuestionKind,
        choices: choicesOf(q),
        unit: q.unit,
        notes: q.notes,
        alwaysAsk: q.alwaysAsk,
      })),
    })),
  });
}

/**
 * Deleting takes the steps and questions with it, by the cascade. Nothing
 * points at an outline yet; when an interview does, this becomes a retire.
 */
export async function deleteOutline(tx: Tx, ctx: JobsCtx, id: string): Promise<void> {
  requireWrite(ctx, "owner");
  const rows = await tx
    .delete(schema.jobEstimateOutlines)
    .where(
      and(
        eq(schema.jobEstimateOutlines.tenantId, ctx.tenantId),
        eq(schema.jobEstimateOutlines.id, id),
      ),
    )
    .returning({ id: schema.jobEstimateOutlines.id });
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `outline ${id} does not exist`);
}
