import type { CrmDeal, CrmDealOutcome, CrmPipelineStage } from "@/db/schema";
import { formatCents } from "@/lib/money";

/**
 * Pipeline arithmetic and stage-transition rules. PURE — no database, no
 * `server-only`, no React.
 *
 * Everything a deal's STATE means is computed here rather than stored, which is
 * the accounting module's "derived, never stored" discipline applied to a
 * pipeline. A deal has no `status` column: whether it is won is a property of
 * the stage it sits in, so the two cannot disagree.
 *
 * The one thing that IS stored is `closed_at`, because it is a fact about time
 * rather than a restatement of the stage — see `closedAtFor`.
 */

/**
 * The default stage set core ships, and it is deliberately dull.
 *
 * READ docs/extension-model.md §3 BEFORE ADDING TO THIS LIST. "Estimate sent",
 * "Survey booked", "Treatment plan accepted" are all things a real pipeline
 * contains and none of them belong here — they are vocabulary a Layer 2b
 * profile supplies as seed data. The test is whether a bookkeeping firm, a
 * dental practice and a plumbing contractor would each recognise the word as
 * their own, and only the four below survive it.
 *
 * Shipping four neutral stages rather than a rich generic pipeline is the same
 * call `DEFAULT_FOLDERS` got wrong in Documents (§8 lists it as a known
 * violation): a tenant should get a richer set by installing a profile, not by
 * core guessing at their trade.
 */
export const DEFAULT_STAGES: {
  name: string;
  probability: number;
  outcome: CrmDealOutcome;
}[] = [
  { name: "New", probability: 10, outcome: "open" },
  { name: "In progress", probability: 50, outcome: "open" },
  { name: "Won", probability: 100, outcome: "won" },
  { name: "Lost", probability: 0, outcome: "lost" },
];

export const DEFAULT_PIPELINE_NAME = "Sales";

export const DEAL_TITLE_MAX = 200;
export const STAGE_NAME_MAX = 60;
export const PIPELINE_NAME_MAX = 60;

/**
 * Stored cents → the string the amount field edits. The inverse of what
 * `parseMoneyToCents` does on save.
 *
 * IT LIVES HERE, IN A MODULE WITH NO `"use client"`, AND THAT IS THE WHOLE
 * REASON THIS COMMENT EXISTS. It started in `components/deal-form.tsx`, which
 * IS a client module — and every export of a client module becomes a client
 * REFERENCE, not the function itself. The deal page is a server component; it
 * imported this, called it, and blew up at render with a message production
 * deliberately withholds.
 *
 * Nothing caught it: `npm run build`, `tsc` and `eslint` were all green,
 * because the import is legal and only the server-side CALL is not. The rule
 * that generalizes: a server component may import COMPONENTS from a client
 * module, never plain functions. Shared helpers belong in a module with no
 * directive at the top.
 */
export function centsToInput(cents: number | null): string {
  return cents === null ? "" : formatCents(cents).replace(/,/g, "");
}

/** Is this deal still live? The single source is the stage it sits in. */
export function isOpen(stage: Pick<CrmPipelineStage, "outcome">): boolean {
  return stage.outcome === "open";
}

/**
 * What `closed_at` should become after a move.
 *
 * The rules, and each one is a decision rather than an accident:
 *
 *  - Moving into a terminal stage stamps the time IF it was not already
 *    stamped. Re-stamping on a won→lost correction would rewrite when the deal
 *    closed to when somebody fixed a typo.
 *  - Moving back to an open stage CLEARS it. A reopened deal that kept its
 *    closing date would show up in "won last quarter" forever.
 *  - `now` is passed in rather than read, so this stays pure and a test can
 *    pin it.
 */
export function closedAtFor(
  current: Date | null,
  toStage: Pick<CrmPipelineStage, "outcome">,
  now: Date,
): Date | null {
  if (isOpen(toStage)) return null;
  return current ?? now;
}

/**
 * Weighted value of one deal, in cents.
 *
 * Integer arithmetic throughout — `Math.round` after multiplying, never a
 * float division (conventions §3). A deal with no amount contributes nothing
 * rather than zero-with-confidence; the caller can tell the two apart because
 * this returns null.
 */
export function weightedCents(
  deal: Pick<CrmDeal, "amountCents">,
  stage: Pick<CrmPipelineStage, "probability" | "outcome">,
): number | null {
  if (deal.amountCents === null || deal.amountCents === undefined) return null;
  // A lost deal is worth nothing regardless of the probability somebody left on
  // the stage; a won one is worth all of it.
  if (stage.outcome === "lost") return 0;
  if (stage.outcome === "won") return deal.amountCents;
  return Math.round((deal.amountCents * stage.probability) / 100);
}

export interface StageTotals {
  stageId: string;
  count: number;
  /** Σ of known amounts. Deals with no amount are counted, not summed. */
  amountCents: number;
  weightedCents: number;
  /** How many deals in this column have no amount — so the UI can say so. */
  unvalued: number;
}

/**
 * Per-stage totals for a board.
 *
 * Returns a row for EVERY stage, including empty ones, so a board renders its
 * columns from this alone and an empty stage does not silently vanish.
 */
export function summarizeBoard(
  stages: CrmPipelineStage[],
  deals: Pick<CrmDeal, "stageId" | "amountCents">[],
): StageTotals[] {
  const byStage = new Map<string, StageTotals>(
    stages.map((s) => [
      s.id,
      { stageId: s.id, count: 0, amountCents: 0, weightedCents: 0, unvalued: 0 },
    ]),
  );
  const stageById = new Map(stages.map((s) => [s.id, s]));

  for (const deal of deals) {
    const row = byStage.get(deal.stageId);
    const stage = stageById.get(deal.stageId);
    // A deal in a stage that is not on this board (archived, or another
    // pipeline) is skipped rather than crashing the summary.
    if (!row || !stage) continue;

    row.count += 1;
    if (deal.amountCents === null || deal.amountCents === undefined) {
      row.unvalued += 1;
      continue;
    }
    row.amountCents += deal.amountCents;
    row.weightedCents += weightedCents(deal, stage) ?? 0;
  }

  return stages.map((s) => byStage.get(s.id)!);
}

/**
 * Where a new deal starts: the first live open stage, in display order.
 *
 * Returns null when a pipeline has no open stage at all, which is a
 * misconfiguration the caller must refuse rather than paper over — dropping a
 * new deal straight into "Won" would be worse than declining to create it.
 */
export function openingStage(stages: CrmPipelineStage[]): CrmPipelineStage | null {
  const candidates = stages
    .filter((s) => !s.archivedAt && s.outcome === "open")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return candidates[0] ?? null;
}
