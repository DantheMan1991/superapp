import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { lineCostCents } from "./estimate-math";
import { listBidPackages } from "./bids-ops";
import type { WalkAnswer, WalkStep } from "./walk-math";
import { reckonWalk, type Reckoning, type StepBidFacts, type StepFacts } from "./walk-reckoning";
import { roomsWithNothingPriced } from "./room-math";
import { asRoomFacts, listRooms } from "./room-ops";

/**
 * THE READS BEHIND THE RECKONING (X4, ADR 0098).
 *
 * Three questions, asked of tables that already existed: what has this walk
 * put on the estimate, is any of it still there, and what went out to
 * subcontractors on these cost codes. **No table was added for this slice.**
 *
 * ── A PHASE IS PRICED WHILE ITS LINES ARE STILL THERE ───────────────────────
 *
 * The proposed line remembers what the walk worked out; the ESTIMATE line is
 * what the bid actually says. They part company the moment somebody edits the
 * number — which the founder asked for in the first place: *"the user should
 * be able to type in a cost for items that are generated as well."* So the
 * reckoning follows `estimate_line_id` through to the real line and reads
 * that, which means a typed-over price is the one that counts and **deleting
 * the lines reopens the hole**. A phase cannot be quietly priced by a row
 * nobody can see any more.
 *
 * ── COST, NOT A SECOND OPINION ON THE BID TOTAL ─────────────────────────────
 *
 * These figures are extended COST. The estimate page owns the bid total, with
 * markup, fixed-price items and the terms — and a line inside a fixed-price
 * item does not contribute its own price at all, so summing `linePriceCents`
 * here would quietly disagree with the estimate on exactly the jobs where it
 * matters. One number, one place: the reckoning answers *"is anything
 * missing"*, not *"what do we charge"*.
 */

/** What this walk has put on the estimate, per outline step, as it stands now. */
async function appliedByStep(
  tx: Tx,
  tenantId: string,
  interviewId: string,
): Promise<Map<string, { appliedLines: number; appliedCents: number; zeroLines: number }>> {
  const applied = await tx
    .select({
      stepId: schema.jobEstimateProposedLines.stepId,
      estimateLineId: schema.jobEstimateProposedLines.estimateLineId,
    })
    .from(schema.jobEstimateProposedLines)
    .where(
      and(
        eq(schema.jobEstimateProposedLines.tenantId, tenantId),
        eq(schema.jobEstimateProposedLines.interviewId, interviewId),
        isNotNull(schema.jobEstimateProposedLines.estimateLineId),
      ),
    );

  const out = new Map<string, { appliedLines: number; appliedCents: number; zeroLines: number }>();
  const ids = applied.map((a) => a.estimateLineId).filter((id): id is string => id !== null);
  if (ids.length === 0) return out;

  /** Only the ones that survive on the estimate. A deleted line prices nothing. */
  const lines = await tx
    .select({
      id: schema.jobEstimateLines.id,
      quantityThousandths: schema.jobEstimateLines.quantityThousandths,
      unitCostCents: schema.jobEstimateLines.unitCostCents,
      /** Whether the WALK made this line and could not price it. See below. */
      basis: schema.jobEstimateLines.basis,
    })
    .from(schema.jobEstimateLines)
    .where(
      and(
        eq(schema.jobEstimateLines.tenantId, tenantId),
        inArray(schema.jobEstimateLines.id, ids),
      ),
    );
  const byId = new Map(
    lines.map((l) => [
      l.id,
      {
        cents: lineCostCents({ ...l, markupPpm: null, unitPriceCents: null }),
        basis: l.basis,
      },
    ]),
  );

  for (const row of applied) {
    if (!row.stepId || !row.estimateLineId) continue;
    const line = byId.get(row.estimateLineId);
    if (line === undefined) continue;
    const at = out.get(row.stepId) ?? { appliedLines: 0, appliedCents: 0, zeroLines: 0 };
    at.appliedLines += 1;
    at.appliedCents += line.cents;
    if (line.cents <= 0 && unexplainedZero(line.basis)) at.zeroLines += 1;
    out.set(row.stepId, at);
  }
  return out;
}

/**
 * **A ZERO WITH A REASON IS A DECISION; A ZERO WITH NOTHING BEHIND IT IS A
 * HOLE.** X4 flagged every line at nothing, and the founder's own price sheet
 * is the disproof: roughly sixty of its rows are `$0.00` on purpose —
 * *"Supplied by Turkel"*, *"By Owner"*, *"(N/A)"*, *"Included in Plumbing
 * Quote"*. Those rows are the exclusions, stated in place where the client
 * reads them, and they are some of the most useful lines on the document.
 *
 * `basis` is exactly the distinction, and X2b already wrote it down: **`none`
 * means a walk produced the line and could not price it**, while BLANK means
 * nobody recorded a basis, which is every line a person ever typed. So only a
 * walk's own unpriceable line counts against the phase. Price something at
 * nothing yourself and that is your call, which it always was.
 */
function unexplainedZero(basis: string): boolean {
  return basis === "none";
}

function codeKey(code: string): string {
  return code.replace(/\s+/g, "").toLowerCase();
}

/**
 * What subcontractors were asked, keyed by cost code. **Two packages on one
 * code add up** — asking two trades for two halves of the electrical is one
 * business's business, and the phase is waiting on both.
 */
async function bidsByCode(
  tx: Tx,
  tenantId: string,
  projectId: string,
  now: Date,
): Promise<Map<string, StepBidFacts>> {
  const packages = await listBidPackages(tx, tenantId, projectId, now);
  const out = new Map<string, StepBidFacts>();
  for (const { pkg, summary } of packages) {
    const key = codeKey(pkg.costCode);
    if (key === "") continue;
    const at = out.get(key) ?? {
      asked: 0,
      back: 0,
      awarded: false,
      lowestCents: null,
      highestCents: null,
    };
    at.asked += summary.asked;
    at.back += summary.bid + summary.declined;
    at.awarded = at.awarded || summary.awardedCents !== null;
    if (summary.lowestCents !== null) {
      at.lowestCents =
        at.lowestCents === null ? summary.lowestCents : Math.min(at.lowestCents, summary.lowestCents);
    }
    if (summary.highestCents !== null) {
      at.highestCents =
        at.highestCents === null
          ? summary.highestCents
          : Math.max(at.highestCents, summary.highestCents);
    }
    out.set(key, at);
  }
  return out;
}

export async function reckoningFor(
  tx: Tx,
  tenantId: string,
  input: {
    interviewId: string;
    projectId: string;
    /** Whose lines are read for the room check (X8b). */
    estimateId: string;
    steps: readonly WalkStep[];
    answers: readonly WalkAnswer[];
  },
  now: Date = new Date(),
): Promise<Reckoning> {
  const [applied, bids, rooms, descriptions] = await Promise.all([
    appliedByStep(tx, tenantId, input.interviewId),
    bidsByCode(tx, tenantId, input.projectId, now),
    listRooms(tx, tenantId, input.projectId),
    /**
     * **EVERY line on the estimate, not just the ones the walk wrote.** A
     * room covered by a line somebody typed by hand is covered, and a check
     * that only read the walk's own output would nag about it forever.
     */
    tx
      .select({ description: schema.jobEstimateLines.description })
      .from(schema.jobEstimateLines)
      .where(
        and(
          eq(schema.jobEstimateLines.tenantId, tenantId),
          eq(schema.jobEstimateLines.estimateId, input.estimateId),
        ),
      ),
  ]);

  const facts = new Map<string, StepFacts>();
  for (const step of input.steps) {
    const a = applied.get(step.id);
    const bid = bids.get(codeKey(step.costCode)) ?? null;
    if (!a && !bid) continue;
    facts.set(step.id, {
      appliedLines: a?.appliedLines ?? 0,
      appliedCents: a?.appliedCents ?? 0,
      zeroLines: a?.zeroLines ?? 0,
      bid,
    });
  }

  const unpriced = roomsWithNothingPriced(
    asRoomFacts(rooms),
    descriptions.map((d) => d.description),
  ).map((r) => ({ id: r.id, name: r.name, level: r.level }));

  return reckonWalk(input.steps, input.answers, facts, unpriced);
}
