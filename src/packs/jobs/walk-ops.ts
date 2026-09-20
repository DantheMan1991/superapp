import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobEstimateInterview, JobEstimateInterviewAnswer } from "@/db/schema";
import { violatedUniqueIndex } from "@/lib/db-errors";
import { choicesOf, loadOutline } from "./outline-ops";
import {
  currentStep,
  mustAskOutstanding,
  outstanding,
  walkProgress,
  type WalkAnswer,
  type WalkProgress,
  type WalkStep,
} from "./walk-math";
import { JobsError, requireWrite, type JobsCtx } from "./ops";

/**
 * THE WALK (X2a, ADR 0098) — starting one, reading it, and banking what it
 * learns.
 *
 * MEMBER WORK, not owner work. Walking an estimate IS the estimating, the
 * same as typing the lines; the OUTLINE is owner-only because deciding how
 * the business prices a job is a decision, and using it is a chore.
 *
 * ── THE HOUSE PATTERN, and the setup interview is its nearest relative ─────
 *
 * Gather the state and claim the cooldown in ONE transaction, call the model
 * OUTSIDE any transaction, then persist. Network work never happens with a
 * transaction open — holding one across model latency is how a pool dies.
 * `claimTurn` is the first half; the caller does the rest.
 */

/** A step's questions, capped — the whole outline goes into every prompt. */
export const WALK_STEP_EXCHANGE_CAP = 14;
/** The backstop on a runaway across the whole walk. */
export const WALK_EXCHANGE_CAP = 500;
/** Long enough to stop a stuck page spending, short enough not to be felt. */
export const WALK_TURN_COOLDOWN_MS = 800;

export interface LoadedWalk {
  interview: JobEstimateInterview;
  /** The outline AS IT STANDS — read live, never snapshotted. */
  steps: WalkStep[];
  outlineName: string;
  answers: JobEstimateInterviewAnswer[];
  progress: WalkProgress;
  /** Where the walk is, derived — the stored id is only a bookmark. */
  step: WalkStep | null;
}

function asWalkAnswers(rows: readonly JobEstimateInterviewAnswer[]): WalkAnswer[] {
  return rows.map((a) => ({
    questionId: a.questionId,
    stepId: a.stepId,
    prompt: a.prompt,
    answer: a.answer,
    skipped: a.skipped,
    skipReason: a.skipReason,
  }));
}

/** The outline, in the shape the walk reasons about. */
async function stepsOfOutline(
  tx: Tx,
  tenantId: string,
  outlineId: string,
): Promise<{ steps: WalkStep[]; name: string } | null> {
  const loaded = await loadOutline(tx, tenantId, outlineId);
  if (!loaded) return null;
  return {
    name: loaded.outline.name,
    steps: loaded.steps.map((s) => ({
      id: s.id,
      title: s.title,
      costCode: s.costCode,
      guidance: s.guidance,
      questions: s.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        choices: choicesOf(q),
        unit: q.unit,
        notes: q.notes,
        alwaysAsk: q.alwaysAsk,
      })),
    })),
  };
}

async function answersOf(
  tx: Tx,
  tenantId: string,
  interviewId: string,
): Promise<JobEstimateInterviewAnswer[]> {
  return tx
    .select()
    .from(schema.jobEstimateInterviewAnswers)
    .where(
      and(
        eq(schema.jobEstimateInterviewAnswers.tenantId, tenantId),
        eq(schema.jobEstimateInterviewAnswers.interviewId, interviewId),
      ),
    )
    .orderBy(asc(schema.jobEstimateInterviewAnswers.sortOrder));
}

/** The walk on this estimate, running or most recently closed. */
export async function loadWalk(
  tx: Tx,
  tenantId: string,
  estimateId: string,
): Promise<LoadedWalk | null> {
  const rows = await tx
    .select()
    .from(schema.jobEstimateInterviews)
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, tenantId),
        eq(schema.jobEstimateInterviews.estimateId, estimateId),
      ),
    )
    .orderBy(desc(schema.jobEstimateInterviews.createdAt))
    .limit(1);
  const interview = rows[0];
  if (!interview) return null;

  const outline = await stepsOfOutline(tx, tenantId, interview.outlineId);
  const answers = await answersOf(tx, tenantId, interview.id);
  const steps = outline?.steps ?? [];
  const asWalk = asWalkAnswers(answers);
  /**
   * **COVERAGE IS NOT THE END OF THE WALK.** `currentStep` goes null the
   * moment every outline question is settled, and a running walk that
   * reported no step closed itself mid-sentence — the header read `Finished`
   * over a question still on the screen. The outline is a floor, so a walk
   * that is still running rides out its LAST step until it says it is done
   * and is not asking anything. One fallback, here, so the screen, the turn
   * and the progress cannot disagree about where it is.
   */
  const derived = currentStep(steps, asWalk, interview.currentStepId);
  const step =
    derived ??
    (interview.status === "running" ? (steps[steps.length - 1] ?? null) : null);

  return {
    interview,
    steps,
    outlineName: outline?.name ?? "",
    answers,
    progress: walkProgress(steps, asWalk),
    step,
  };
}

export async function getWalk(
  tx: Tx,
  tenantId: string,
  interviewId: string,
): Promise<LoadedWalk | null> {
  const rows = await tx
    .select()
    .from(schema.jobEstimateInterviews)
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  return loadWalk(tx, tenantId, rows[0].estimateId);
}

/**
 * Start a walk on an estimate.
 *
 * **AN ACCEPTED ESTIMATE IS REFUSED.** Its money is the agreement (ADR 0069),
 * so there is nothing for a walk to do to it, and starting one that could
 * never write would be a screen that lies.
 */
export async function startWalk(
  tx: Tx,
  ctx: JobsCtx,
  input: { estimateId: string; outlineId: string },
): Promise<JobEstimateInterview> {
  requireWrite(ctx, "member");

  const estimate = await tx
    .select({
      id: schema.jobEstimates.id,
      status: schema.jobEstimates.status,
      number: schema.jobEstimates.number,
    })
    .from(schema.jobEstimates)
    .where(
      and(
        eq(schema.jobEstimates.tenantId, ctx.tenantId),
        eq(schema.jobEstimates.id, input.estimateId),
      ),
    )
    .limit(1);
  if (!estimate[0]) {
    throw new JobsError("NOT_FOUND", `estimate ${input.estimateId} does not exist`);
  }
  if (estimate[0].status === "accepted") {
    throw new JobsError(
      "ESTIMATE_ACCEPTED",
      `estimate ${estimate[0].number} was accepted; walk a new one`,
    );
  }

  const outline = await stepsOfOutline(tx, ctx.tenantId, input.outlineId);
  if (!outline) {
    throw new JobsError("NOT_FOUND", `outline ${input.outlineId} does not exist`);
  }
  if (outline.steps.length === 0) {
    throw new JobsError("INVALID_VALUE", "that outline has no steps to walk");
  }

  try {
    const rows = await tx
      .insert(schema.jobEstimateInterviews)
      .values({
        tenantId: ctx.tenantId,
        estimateId: input.estimateId,
        outlineId: input.outlineId,
        startedByClerkUserId: ctx.userId,
        currentStepId: outline.steps[0].id,
      })
      .returning();
    return rows[0];
  } catch (err) {
    if (violatedUniqueIndex(err) === "job_estimate_interviews_one_running_idx") {
      throw new JobsError("WALK_RUNNING", "this estimate is already being walked");
    }
    throw err;
  }
}

/** A walk that is not running cannot be written to. */
function requireRunning(interview: JobEstimateInterview): void {
  if (interview.status !== "running") {
    throw new JobsError("WALK_CLOSED", "this walk is finished");
  }
}

/**
 * CLAIM THE TURN — the first half of the house pattern, and the only part
 * that must be inside a transaction.
 *
 * The cooldown and the cap are claimed by the same UPDATE that reads them, so
 * two posts racing cannot both pass. The model is then called outside, and
 * what it says is persisted afterwards.
 */
export async function claimTurn(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  opts: { ignoreCooldown?: boolean } = {},
): Promise<JobEstimateInterview> {
  requireWrite(ctx, "member");
  /**
   * `ignoreCooldown` is for the CONTINUATION turn taken when a step ends —
   * one logical turn that happens to need two calls, not somebody hammering
   * the page. The cap still applies, which is the guard that actually stops
   * a runaway.
   */
  const notTooSoon = opts.ignoreCooldown
    ? sql`true`
    : sql`(${schema.jobEstimateInterviews.lastTurnAt} is null
           or ${schema.jobEstimateInterviews.lastTurnAt} < now() - (${WALK_TURN_COOLDOWN_MS} || ' milliseconds')::interval)`;
  const rows = await tx
    .update(schema.jobEstimateInterviews)
    .set({
      exchanges: sql`${schema.jobEstimateInterviews.exchanges} + 1`,
      lastTurnAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
        eq(schema.jobEstimateInterviews.status, "running"),
        sql`${schema.jobEstimateInterviews.exchanges} < ${WALK_EXCHANGE_CAP}`,
        notTooSoon,
      ),
    )
    .returning();
  if (rows[0]) return rows[0];

  /** Nothing claimed — say WHICH of the three reasons, by reading it back. */
  const current = await tx
    .select()
    .from(schema.jobEstimateInterviews)
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    )
    .limit(1);
  if (!current[0]) throw new JobsError("NOT_FOUND", "that walk is no longer here");
  requireRunning(current[0]);
  if (current[0].exchanges >= WALK_EXCHANGE_CAP) {
    throw new JobsError("WALK_CAPPED", "this walk has gone on long enough");
  }
  throw new JobsError("WALK_COOLDOWN", "give it a moment");
}

export interface AnswerEntry {
  /** Null when the walk asked something the outline never contained. */
  questionId?: string | null;
  stepId: string | null;
  stepTitle: string;
  prompt: string;
  answer?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Bank what a turn established.
 *
 * **THE WALK MAY NOT SKIP A MUST-ASK QUESTION.** That is the whole point of
 * marking one, so it is refused here rather than discouraged in a prompt: a
 * rule a model can be talked out of is not a rule. A PERSON may still skip
 * one — this guards against judgement, not against a decision somebody makes
 * with their eyes open — and `byPerson` is how the caller says which it is.
 */
export async function recordAnswers(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  entries: readonly AnswerEntry[],
  opts: { byPerson?: boolean } = {},
): Promise<number> {
  requireWrite(ctx, "member");
  if (entries.length === 0) return 0;

  const walk = await getWalk(tx, ctx.tenantId, interviewId);
  if (!walk) throw new JobsError("NOT_FOUND", "that walk is no longer here");
  requireRunning(walk.interview);

  if (!opts.byPerson) {
    const mustAsk = new Set(
      walk.steps.flatMap((s) => s.questions.filter((q) => q.alwaysAsk).map((q) => q.id)),
    );
    for (const entry of entries) {
      if (entry.skipped && entry.questionId && mustAsk.has(entry.questionId)) {
        throw new JobsError(
          "MUST_ASK",
          `"${entry.prompt}" is marked always ask and cannot be skipped`,
        );
      }
    }
  }

  const already = walk.answers.length;
  const values = entries.map((entry, i) => {
    const skipped = entry.skipped === true;
    const reason = (entry.skipReason ?? "").trim();
    if (skipped && reason === "") {
      throw new JobsError("INVALID_VALUE", "a skipped question needs a reason");
    }
    return {
      tenantId: ctx.tenantId,
      interviewId,
      stepId: entry.stepId,
      stepTitle: entry.stepTitle.trim(),
      questionId: entry.questionId ?? null,
      prompt: entry.prompt.trim(),
      answer: skipped ? "" : (entry.answer ?? "").trim(),
      skipped,
      skipReason: skipped ? reason : "",
      sortOrder: (already + i + 1) * 10,
    };
  });
  await tx.insert(schema.jobEstimateInterviewAnswers).values(values);
  return values.length;
}

/**
 * Move the bookmark on.
 *
 * Refused while a must-ask question of the step is outstanding — the walk
 * asks to move and does not get to. `currentStep` would send it straight
 * back anyway; refusing here is what makes the reason sayable.
 */
export async function moveToStep(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  stepId: string | null,
): Promise<JobEstimateInterview> {
  requireWrite(ctx, "member");
  const walk = await getWalk(tx, ctx.tenantId, interviewId);
  if (!walk) throw new JobsError("NOT_FOUND", "that walk is no longer here");
  requireRunning(walk.interview);

  if (walk.step) {
    const left = mustAskOutstanding(walk.step, asWalkAnswers(walk.answers));
    if (left.length > 0 && stepId !== walk.step.id) {
      throw new JobsError("MUST_ASK", `"${left[0].prompt}" has to be asked first`);
    }
  }

  const rows = await tx
    .update(schema.jobEstimateInterviews)
    .set({ currentStepId: stepId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    )
    .returning();
  return rows[0];
}

/**
 * Write down the question now on the screen, so a refresh does not lose it.
 * Blank `say` clears it, which is what closing a walk does.
 */
export async function savePendingTurn(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  turn: { say: string; questionId?: string | null; quickReplies?: readonly string[] },
): Promise<void> {
  requireWrite(ctx, "member");
  await tx
    .update(schema.jobEstimateInterviews)
    .set({
      pendingSay: turn.say.trim(),
      pendingQuestionId: turn.questionId ?? null,
      pendingQuickReplies: [...(turn.quickReplies ?? [])],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    );
}

/** The buttons under the pending question, out of the jsonb as strings. */
export function pendingRepliesOf(
  interview: Pick<JobEstimateInterview, "pendingQuickReplies">,
): string[] {
  const raw = interview.pendingQuickReplies;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

/**
 * A WALK AS A SCREEN NEEDS IT — one shape, built in one place, so the server
 * page and the turn's reply cannot drift into showing different things.
 */
export interface WalkView {
  interviewId: string;
  status: string;
  outlineName: string;
  stepTitle: string;
  stepGuidance: string;
  stepNumber: number;
  stepCount: number;
  progress: WalkProgress;
  say: string;
  quickReplies: string[];
  /** The outline question on the screen, when it is one. */
  pendingQuestionId: string | null;
  /** Everything settled on THIS step, in the order it was settled. */
  settled: {
    prompt: string;
    answer: string;
    skipped: boolean;
    skipReason: string;
    volunteered: boolean;
  }[];
  /** What this step still needs, so a person can see what is coming. */
  outstanding: { id: string; prompt: string; alwaysAsk: boolean }[];
}

export function walkView(walk: LoadedWalk): WalkView {
  const step = walk.step;
  const answers = asWalkAnswers(walk.answers);
  const settled = walk.answers
    .filter((a) => step && a.stepId === step.id)
    .map((a) => ({
      prompt: a.prompt,
      answer: a.answer,
      skipped: a.skipped,
      skipReason: a.skipReason,
      /** Asked by the walk rather than read off the outline. */
      volunteered: a.questionId === null,
    }));
  return {
    interviewId: walk.interview.id,
    status: walk.interview.status,
    outlineName: walk.outlineName,
    stepTitle: step?.title ?? "",
    stepGuidance: step?.guidance ?? "",
    stepNumber: step ? walk.steps.findIndex((s) => s.id === step.id) + 1 : walk.steps.length,
    stepCount: walk.steps.length,
    progress: walk.progress,
    say: walk.interview.pendingSay,
    quickReplies: pendingRepliesOf(walk.interview),
    pendingQuestionId: walk.interview.pendingQuestionId,
    settled,
    outstanding: step
      ? outstanding(step, answers).map((q) => ({
          id: q.id,
          prompt: q.prompt,
          alwaysAsk: q.alwaysAsk,
        }))
      : [],
  };
}

/** Close a walk: `finished` when it ran out of steps, `abandoned` when dropped. */
export async function closeWalk(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  status: "finished" | "abandoned",
): Promise<JobEstimateInterview> {
  requireWrite(ctx, "member");
  const rows = await tx
    .update(schema.jobEstimateInterviews)
    .set({
      status,
      finishedAt: new Date(),
      currentStepId: null,
      pendingSay: "",
      pendingQuestionId: null,
      pendingQuickReplies: [],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
        eq(schema.jobEstimateInterviews.status, "running"),
      ),
    )
    .returning();
  if (!rows[0]) throw new JobsError("WALK_CLOSED", "that walk is already closed");
  return rows[0];
}
