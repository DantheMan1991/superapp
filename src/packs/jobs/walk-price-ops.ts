import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobEstimateProposedLine } from "@/db/schema";
import { JobsError, requireWrite, type JobsCtx } from "./ops";
import {
  nextToPrice,
  priceQuestionFor,
  type PriceAsk,
  type PriceableLine,
} from "./walk-price-math";

/**
 * ASKING FOR THE MONEY, AND BANKING WHAT WAS SAID (X6).
 *
 * `walk-price-math.ts` has the reasoning; this is the half that touches the
 * database. Two rules it keeps:
 *
 * **THE MODEL IS NOT IN THIS PATH.** A price question is written from the
 * line, read with a parser, and written to one row whose id was on the
 * screen. Nothing infers which line an answer belonged to, because that is
 * the failure that put `Yes` on *Who is producing the drawings?* — and a
 * wrong price is worse than a wrong answer, because it goes out in a total.
 *
 * **A PASS IS A DECISION AND IT STICKS.** Without `price_passed_at` the walk
 * would ask the same line at every turn forever. With it the line stays
 * unpriced, and the reckoning shows it — which is what the reckoning is for.
 */

/** Only lines of THIS step, in proposal order, as the pure half reads them. */
export async function priceableLines(
  tx: Tx,
  tenantId: string,
  interviewId: string,
  stepId: string,
): Promise<PriceableLine[]> {
  const rows = await tx
    .select()
    .from(schema.jobEstimateProposedLines)
    .where(
      and(
        eq(schema.jobEstimateProposedLines.tenantId, tenantId),
        eq(schema.jobEstimateProposedLines.interviewId, interviewId),
        eq(schema.jobEstimateProposedLines.stepId, stepId),
        /** A pass is an answer; it is not asked again. */
        isNull(schema.jobEstimateProposedLines.pricePassedAt),
      ),
    )
    .orderBy(asc(schema.jobEstimateProposedLines.sortOrder));
  return rows.map(asPriceable);
}

function asPriceable(row: JobEstimateProposedLine): PriceableLine {
  return {
    id: row.id,
    description: row.description,
    unit: row.unit,
    quantityThousandths: row.quantityThousandths,
    unitCostCents: row.unitCostCents,
    basis: row.basis,
  };
}

/**
 * The next price to ask for on this step, written and parked on the
 * interview so a reload does not lose it — the same reason `pending_say`
 * exists. Null when everything on the step carries a price or has been
 * passed, which is the signal to show the total and move on.
 */
export async function askNextPrice(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  stepId: string,
): Promise<PriceAsk | null> {
  requireWrite(ctx, "member");
  const lines = await priceableLines(tx, ctx.tenantId, interviewId, stepId);
  const next = nextToPrice(lines);
  if (!next) {
    await clearPriceAsk(tx, ctx, interviewId);
    return null;
  }
  const ask = priceQuestionFor(next);
  await tx
    .update(schema.jobEstimateInterviews)
    .set({
      pendingSay: ask.prompt,
      pendingQuestionId: null,
      /** A price is typed or spoken; a button would only ever be wrong. */
      pendingQuickReplies: ["Skip this one"],
      pendingPriceLineId: ask.lineId,
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
 * figure. `savePendingTurn` has already written the words; this keeps the
 * line they belong to, so the next attempt still lands on the right row.
 */
export async function setPriceAsk(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  lineId: string,
): Promise<void> {
  await tx
    .update(schema.jobEstimateInterviews)
    .set({ pendingPriceLineId: lineId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    );
}

export async function clearPriceAsk(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
): Promise<void> {
  await tx
    .update(schema.jobEstimateInterviews)
    .set({ pendingPriceLineId: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateInterviews.tenantId, ctx.tenantId),
        eq(schema.jobEstimateInterviews.id, interviewId),
      ),
    );
}

/** The line being asked about, read back so nothing trusts the screen for it. */
export async function pendingPriceLine(
  tx: Tx,
  tenantId: string,
  lineId: string,
): Promise<JobEstimateProposedLine | null> {
  const rows = await tx
    .select()
    .from(schema.jobEstimateProposedLines)
    .where(
      and(
        eq(schema.jobEstimateProposedLines.tenantId, tenantId),
        eq(schema.jobEstimateProposedLines.id, lineId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * **A FIGURE SOMEBODY GAVE, WITH THEIR NAME ON IT.** Basis `said` is the one
 * X2b already trusts, and it is the strongest basis there is short of a
 * subcontractor's bid: nobody derived it, nobody remembered it, a person
 * looked at the line and said the number.
 */
export async function recordSaidPrice(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  lineId: string,
  unitCostCents: number,
): Promise<void> {
  requireWrite(ctx, "member");
  const updated = await tx
    .update(schema.jobEstimateProposedLines)
    .set({
      unitCostCents,
      basis: "said",
      basisDetail: "you said so, walking this job",
      pricePassedAt: null,
    })
    .where(
      and(
        eq(schema.jobEstimateProposedLines.tenantId, ctx.tenantId),
        eq(schema.jobEstimateProposedLines.interviewId, interviewId),
        eq(schema.jobEstimateProposedLines.id, lineId),
      ),
    )
    .returning({ id: schema.jobEstimateProposedLines.id });
  if (updated.length === 0) {
    throw new JobsError("NOT_FOUND", "that line is no longer on this proposal");
  }
  await clearPriceAsk(tx, ctx, interviewId);
}

export async function passPrice(
  tx: Tx,
  ctx: JobsCtx,
  interviewId: string,
  lineId: string,
): Promise<void> {
  requireWrite(ctx, "member");
  await tx
    .update(schema.jobEstimateProposedLines)
    .set({ pricePassedAt: new Date() })
    .where(
      and(
        eq(schema.jobEstimateProposedLines.tenantId, ctx.tenantId),
        eq(schema.jobEstimateProposedLines.interviewId, interviewId),
        eq(schema.jobEstimateProposedLines.id, lineId),
      ),
    );
  await clearPriceAsk(tx, ctx, interviewId);
}
