/**
 * The module home's arithmetic: how a project's row is measured, which pill it
 * falls under, and what the four figures above the list add up to.
 *
 * Pure, like `wip-math.ts` beside it — the ledger reads happen in `list-ops.ts`
 * and hand their maps in here, so `tests/jobs-list.test.ts` can pin every rule
 * without a database.
 *
 * ── THE LIST MEASURES THE SAME WAY THE SCHEDULE DOES ────────────────────────
 *
 * Every figure here comes out of `wipFigures`, the same function the WIP
 * schedule posts from. The list is a summary of the book, not a second opinion
 * about it: a job that reads 62% complete here and 62% there is the point, and
 * the only way to keep that true is to share the arithmetic rather than
 * re-derive a friendlier version of it.
 *
 * ── THREE THINGS THE LIST REFUSES TO PRINT ──────────────────────────────────
 *
 * A zero is a claim. Where the pack does not know a figure it says which kind
 * of not-knowing it is, because each one is a different next action:
 *
 * - `unsigned` — nothing is signed, so there is no contract value. The old
 *   table printed an em dash; the truth is usually "a proposal is out at
 *   $X", which is a number somebody can chase.
 * - `no_estimate` — nothing to measure against. `percentCompletePpm` returns
 *   null, and the cell says so instead of printing 0%. **It also means the job
 *   has no earned figure at all**, which is the harder half: see below.
 * - `by_hours` — a time-and-materials job earns its approved hours at their
 *   bill rates (ADR 0062), and those hours are a query per job. A list of
 *   sixty jobs cannot afford sixty of them, so the row shows what it honestly
 *   has — contract, cost, billed — and sends the reader to the WIP schedule
 *   for earned. An approximate figure in a money column is worse than none.
 */

import { type WipFigures, wipFigures } from "./wip-math";

/** The pills above the list. `all` is not a status — it is the absence of one. */
export const LIST_FILTERS = ["all", "active", "planned", "on_hold", "complete", "cancelled"] as const;

export type ListFilterKey = (typeof LIST_FILTERS)[number];

export function isListFilterKey(value: unknown): value is ListFilterKey {
  return typeof value === "string" && (LIST_FILTERS as readonly string[]).includes(value);
}

export const LIST_FILTER_LABELS: Record<ListFilterKey, string> = {
  all: "All",
  active: "Active",
  planned: "Planned",
  on_hold: "On hold",
  complete: "Complete",
  cancelled: "Cancelled",
};

/**
 * How a job's earned figure was arrived at, or why it could not be.
 *
 * A discriminated union rather than a nullable number, so a cell cannot render
 * "$0" for a job nobody has signed and a job that has earned nothing — two
 * facts that look identical once they are both zero.
 */
export type ProjectValuation =
  /** No counted contract. `proposedCents` is what is out for signature, if anything. */
  | { kind: "unsigned"; proposedCents: number }
  /** Billed by the hour; earned is measured on the WIP schedule, not here. */
  | { kind: "by_hours" }
  /**
   * Signed, but with nothing to measure against — no budget and no estimate on
   * a job billed by a fixed value.
   *
   * **THIS IS NOT "EARNED NOTHING", AND THE DIFFERENCE IS THE WHOLE POINT.**
   * `wipFigures` computes earned as zero when the percentage is null, and a
   * screen that reported that number said a job billed $22,556.25 against no
   * estimate was $22,556.25 OVER-BILLED — on the same strip that had just
   * said "no budget to measure against". It cannot be both.
   *
   * The pack already had the right answer and this was not asking it:
   * `reasonFor` in `wip-ops.ts` returns `no_estimate` for exactly this shape,
   * the schedule refuses to post the period, and it names the job as a
   * blocker — "24-111 has no budget and no estimate". Every screen now says
   * the same thing the schedule does.
   */
  | { kind: "no_estimate"; billedCents: number }
  /** Measured. A cost-plus job is measured here too — it needs no estimate. */
  | { kind: "measured"; figures: WipFigures };

export interface ProjectMeasureInput {
  status: string;
  /** Revised value over counted contracts: original + approved changes. */
  contractCents: number;
  /** How many counted contracts made up that value. Zero means nothing is signed. */
  signedCount: number;
  /** What is out at proposal, used only to say what an unsigned job is worth asking for. */
  proposedCents: number;
  /** The revised budget — the estimated cost at completion until somebody re-estimates. */
  budgetCents: number;
  costToDateCents: number;
  billedCents: number;
  /** Set when the job's single counted contract bills the ledger (cost plus, or T&M). */
  terms?: {
    method: "cost_plus" | "time_and_materials";
    feePpm: number | null;
    feeCents: number | null;
    gmaxCents: number | null;
  } | null;
}

/**
 * One job's valuation.
 *
 * Order matters. Unsigned is checked first because a job with no counted
 * contract has no value to be a percentage of, whatever its cost says — and a
 * spec house accumulating cost against no contract is a real and common state,
 * not an error.
 */
export function measureProject(input: ProjectMeasureInput): ProjectValuation {
  if (input.signedCount === 0) {
    return { kind: "unsigned", proposedCents: input.proposedCents };
  }
  if (input.terms?.method === "time_and_materials") return { kind: "by_hours" };
  const figures = wipFigures({
    contractCents: input.contractCents,
    estimatedCostCents: input.budgetCents,
    costToDateCents: input.costToDateCents,
    billedCents: input.billedCents,
    complete: input.status === "complete",
    // A cost-plus job earns cost plus its fee and needs no estimate to say
    // so; passing the terms is what stops it being measured against a budget
    // it was never sold against.
    costPlus: input.terms?.method === "cost_plus" ? input.terms : undefined,
  });
  /*
   * THE SAME TEST `reasonFor` APPLIES, and in the same order: a cost-plus job
   * needs no estimate, so its null percentage is not a problem — anything else
   * with a null percentage has no earned figure and must not pretend to one.
   */
  if (!input.terms && figures.percentCompletePpm === null) {
    return { kind: "no_estimate", billedCents: input.billedCents };
  }
  return { kind: "measured", figures };
}

/** The pill a status falls under. Anything unrecognised sits under All only. */
export function filterKeyFor(status: string): ListFilterKey | null {
  return isListFilterKey(status) && status !== "all" ? status : null;
}

export function matchesFilter(status: string, filter: ListFilterKey): boolean {
  return filter === "all" || filterKeyFor(status) === filter;
}

export interface ListSummary {
  /** Revised value over every counted contract in the book. */
  underContractCents: number;
  /** How many jobs contributed to it — the footnote under the figure. */
  countedJobs: number;
  earnedCents: number;
  underBilledCents: number;
  overBilledCents: number;
  /** Jobs billed ahead of what they have earned. Named, because one is a conversation. */
  overBilledJobs: number;
  activeJobs: number;
}

/**
 * The four figures above the list.
 *
 * TWO RULES, BOTH INHERITED RATHER THAN RE-DECIDED:
 *
 * - Under-billed and over-billed are summed separately and never netted
 *   (`wipTotals` says why: a job billed ahead and a job billed behind are two
 *   facts, and netting them hides both).
 * - A cancelled job is in no figure. It is not work in progress, and leaving it
 *   in the contract total would overstate the book by the value of jobs nobody
 *   is going to build.
 *
 * Computed over the WHOLE book rather than the filtered rows, so the headline
 * does not move when somebody clicks a pill: "Under contract" answers a
 * question about the business, not about the current view.
 */
export function summariseList(
  rows: readonly { status: string; signedCount: number; contractCents: number; valuation: ProjectValuation }[],
): ListSummary {
  const summary: ListSummary = {
    underContractCents: 0,
    countedJobs: 0,
    earnedCents: 0,
    underBilledCents: 0,
    overBilledCents: 0,
    overBilledJobs: 0,
    activeJobs: 0,
  };
  for (const row of rows) {
    if (row.status === "cancelled") continue;
    if (row.status === "active") summary.activeJobs += 1;
    if (row.signedCount > 0) {
      summary.underContractCents += row.contractCents;
      summary.countedJobs += 1;
    }
    if (row.valuation.kind !== "measured") continue;
    const f = row.valuation.figures;
    summary.earnedCents += f.earnedCents;
    summary.underBilledCents += f.underBilledCents;
    summary.overBilledCents += f.overBilledCents;
    if (f.overBilledCents > 0) summary.overBilledJobs += 1;
  }
  return summary;
}

/** How many rows each pill would show, so a pill can carry its own count. */
export function filterCounts(
  rows: readonly { status: string }[],
): Record<ListFilterKey, number> {
  const counts = {
    all: rows.length,
    active: 0,
    planned: 0,
    on_hold: 0,
    complete: 0,
    cancelled: 0,
  } satisfies Record<ListFilterKey, number>;
  for (const row of rows) {
    const key = filterKeyFor(row.status);
    if (key) counts[key] += 1;
  }
  return counts;
}

/**
 * The progress bar's width, clamped to the track.
 *
 * A separate function only so the cap is stated once: `percentCompletePpm`
 * already caps at 100%, but a bar that trusted a raw ratio would render a job
 * 140% over budget as a bar running out of its own container.
 */
export function barPercent(ppm: number | null): number {
  if (ppm === null || ppm <= 0) return 0;
  return Math.min(100, ppm / 10_000);
}

/**
 * THE BOARD'S THREE COLUMNS, which are not the same cut as the pills.
 *
 * The pills are a status filter; the board answers "what is happening on site",
 * so it collapses five statuses into three questions: is it running, is it
 * coming, or is it neither. On hold sits with complete rather than with active
 * because a stalled job needs the same thing a finished one does — somebody to
 * decide it is over or start it again — and `cancelled` joins them rather than
 * vanishing, because a job that disappears from a view is the one nobody
 * notices (the same reason the list keeps cancelled under All).
 */
export const BOARD_GROUPS = ["on_site", "coming_up", "closed"] as const;

export type BoardGroupKey = (typeof BOARD_GROUPS)[number];

export const BOARD_GROUP_LABELS: Record<BoardGroupKey, string> = {
  on_site: "On site",
  coming_up: "Coming up",
  closed: "Stalled & closed",
};

/** The dot beside a column heading. A FILL, so the fill tokens are right here. */
export const BOARD_GROUP_TONES: Record<BoardGroupKey, string> = {
  on_site: "bg-success",
  coming_up: "bg-primary",
  closed: "bg-muted-foreground/40",
};

export function boardGroupFor(status: string): BoardGroupKey {
  if (status === "active") return "on_site";
  if (status === "planned") return "coming_up";
  return "closed";
}

/** Which view the module home is showing. A search param, so a refresh keeps it. */
export const LIST_VIEWS = ["table", "board"] as const;

export type ListView = (typeof LIST_VIEWS)[number];

export function isListView(value: unknown): value is ListView {
  return typeof value === "string" && (LIST_VIEWS as readonly string[]).includes(value);
}
