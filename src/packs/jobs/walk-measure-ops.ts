import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { requireWrite, type JobsCtx } from "./ops";
import {
  measureQuestionFor,
  nextToMeasure,
  type DeclaredMeasure,
  type MeasureAsk,
} from "./measure-math";
import {
  asDeclared,
  asTaken,
  listMeasurements,
  listOutlineMeasures,
  passMeasurement,
  recordMeasurement,
} from "./measure-ops";

/**
 * ASKING FOR THE BUILDING'S NUMBERS, BEFORE ANYTHING IS PRICED (X7).
 *
 * The same shape as `walk-price-ops.ts` and for the same reasons, which is
 * the point of making it look identical: a measurement question is written
 * from a row, parked on the interview so a reload does not lose it, read by
 * a parser, and written to the row whose id was on the screen. **The model
 * is not in this path.**
 *
 * ── WHY IT RUNS BEFORE THE QUESTIONS AND NOT DURING THEM ────────────────────
 *
 * The founder's own reasoning: *"there are numerous times it asks for a
 * square footage. I need the takeoff tool to get that a lot of the time."*
 * Measuring is a different mode from talking — open the sheet, set the
 * scale, trace the polygon — and doing it fifteen times mid-conversation
 * breaks the rhythm every time. Once, up front, with the drawings already
 * open, is how the work is actually done.
 *
 * It is also what stops the walk forgetting the house. An ANSWER falls out
 * of the prompt after thirty of them; these go into every turn.
 */

/** What the outline wants measured, as the pure half reads it. */
export async function declaredFor(
  tx: Tx,
  tenantId: string,
  outlineId: string,
): Promise<DeclaredMeasure[]> {
  return asDeclared(await listOutlineMeasures(tx, tenantId, outlineId));
}

/**
 * The next measurement to ask for, written and parked on the interview.
 * Null when the list is answered — which is the signal to stamp
 * `measured_at` and start asking questions.
 */
export async function askNextMeasure(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  outlineId: string,
  projectId: string,
): Promise<MeasureAsk | null> {
  requireWrite(ctx, "member");
  const [declared, taken] = await Promise.all([
    declaredFor(tx, ctx.tenantId, outlineId),
    listMeasurements(tx, ctx.tenantId, projectId).then(asTaken),
  ]);
  const next = nextToMeasure(declared, taken);
  /**
   * **NULL MEANS "NOTHING LEFT TO MEASURE", NOT "MEASURING IS OVER."**
   *
   * This used to stamp `measured_at` here, and it cost the rooms question:
   * on a building that was already measured — a second estimate on the same
   * job — the declared list came back empty, measuring was declared
   * finished on the spot, and the walk went straight to its first phase
   * without ever asking what rooms were in the house. Deciding the
   * measure-up is DONE belongs to the caller, which knows the rooms still
   * have to be asked for.
   */
  if (!next) return null;
  const ask = measureQuestionFor(next);
  await tx
    .update(schema.jobEstimateInterviews)
    .set({
      pendingSay: ask.prompt,
      pendingQuestionId: null,
      /**
       * A measurement is typed or traced; a button would only ever be
       * wrong. *Skip this one* is the exception, because passing is a real
       * answer — the rule X6 already paid for.
       */
      pendingQuickReplies: ["Skip this one"],
      pendingMeasureId: ask.measureId,
      pendingPriceLineId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    );
  return ask;
}

/**
 * Park the same ask again — used when an answer could not be read as one
 * figure. `savePendingTurn` has written the words; this keeps the
 * measurement they belong to, so the next attempt lands on the right one.
 */
export async function setMeasureAsk(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  measureId: string,
): Promise<void> {
  await tx
    .update(schema.jobEstimateInterviews)
    .set({ pendingMeasureId: measureId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    );
}

export async function clearMeasureAsk(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
): Promise<void> {
  await tx
    .update(schema.jobEstimateInterviews)
    .set({ pendingMeasureId: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    );
}

/**
 * **MEASURING IS OVER, AND IT IS A FACT RATHER THAN AN INFERENCE.**
 *
 * Deriving it from "is every declared measurement answered" would put a
 * walk back into measuring the moment somebody added a measurement to the
 * outline — and the outline is the tenant's, edited while walks are in
 * progress. Stamped once and never unstamped.
 */
export async function finishMeasuring(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
): Promise<void> {
  await tx
    .update(schema.jobEstimateInterviews)
    .set({ pendingMeasureId: null, measuredAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    );
}

/**
 * **THE ROOMS QUESTION HAS BEEN PUT** (X8).
 *
 * Stamped when the question goes on the screen rather than when it is
 * answered, because "asked and waiting" and "not asked yet" are otherwise
 * indistinguishable — both are `measured_at` null with nothing pending —
 * and the walk would ask twice or never depending on which it guessed.
 */
export async function markRoomsAsked(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
): Promise<void> {
  requireWrite(ctx, "member");
  await tx
    .update(schema.jobEstimateInterviews)
    .set({ roomsAskedAt: new Date(), pendingMeasureId: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    );
}

/** The measurement being asked about, read back rather than trusted off the screen. */
export async function pendingMeasure(
  tx: Tx,
  tenantId: string,
  outlineId: string,
  measureId: string,
): Promise<DeclaredMeasure | null> {
  const declared = await declaredFor(tx, tenantId, outlineId);
  return declared.find((d) => d.id === measureId) ?? null;
}

/** A figure somebody gave while walking. The building's, not the walk's. */
export async function recordWalkMeasurement(
  tx: Tx,
  ctx: JobsCtx,
  input: {
    projectId: string;
    measure: DeclaredMeasure;
    valueThousandths: number;
  },
): Promise<void> {
  await recordMeasurement(tx, ctx, {
    projectId: input.projectId,
    name: input.measure.name,
    unit: input.measure.unit,
    valueThousandths: input.valueThousandths,
    source: "said",
    note: "",
  });
}

/** Not on this job, or not known yet. It sticks, so the walk stops asking. */
export async function passWalkMeasurement(
  tx: Tx,
  ctx: JobsCtx,
  input: { projectId: string; measure: DeclaredMeasure },
): Promise<void> {
  await passMeasurement(tx, ctx, {
    projectId: input.projectId,
    name: input.measure.name,
    unit: input.measure.unit,
  });
}
