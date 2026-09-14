/**
 * The work-in-progress arithmetic, pure — the schedule page and the posting
 * compute the same figures from it, and `tests/jobs.test.ts` pins every one.
 * No imports and no directive, like `billing-math.ts`: a client component may
 * read it.
 *
 * ── COST-TO-COST, AND WHY THAT IS THE DEFAULT ───────────────────────────────
 *
 * Percent complete is cost to date over the estimated total cost. It is the
 * method a bank and a surety expect on a WIP schedule, the input method ASC
 * 606 names first for a contractor, and — the practical reason — the only one
 * whose inputs the books already hold: a job's cost is on every bill and
 * timecard tagged to it, and its estimated cost is the revised budget until
 * somebody re-estimates. A percent somebody types is an opinion; a percent the
 * ledger computes is a fact somebody can argue with by re-estimating the cost,
 * which is the argument a monthly WIP meeting is for.
 *
 * ── THE FOUR LINES A SCHEDULE IS MADE OF ────────────────────────────────────
 *
 *   earned          = contract × percent complete
 *   under-billed    = earned − billed, when positive   (an asset: 1240)
 *   over-billed     = billed − earned, when positive   (a liability: 2420)
 *   gross profit    = earned − cost to date
 *
 * Under and over are never netted across jobs. A schedule shows both columns
 * and a balance sheet carries both accounts, because a job billed ahead and a
 * job billed behind are two facts, not one.
 *
 * ── INTEGERS, AND BIGINT WHERE THE PRODUCT COULD OVERFLOW ───────────────────
 *
 * Contract value × parts per million passes 2^53 on a contract above about
 * ninety million dollars, which is a real commercial job. The two products
 * below go through BigInt and come back as a Number that is always a plain
 * count of cents.
 */

/** A rate in parts per million, so 100% is a million — the pack's convention since retainage. */
export const WIP_PPM = 1_000_000;

export interface WipInputs {
  /** Revised contract value: original + approved changes, over counted contracts. */
  contractCents: number;
  /** The estimated total cost at completion: the revised budget, or the period's re-estimate. */
  estimatedCostCents: number;
  costToDateCents: number;
  /** Gross billings to date: what has been invoiced on the job, before retainage. */
  billedCents: number;
  /** A finished job is 100% complete whatever its cost says. */
  complete?: boolean;
  /**
   * COST PLUS A FEE (slice 5b): the job earns what it has cost plus the fee
   * on it, capped at the guaranteed maximum, and needs no estimate to say
   * so. Present only for a job on a single cost-plus contract.
   */
  /**
   * A time-and-materials job (ADR 0062): approved hours at their bill rates
   * to date, and the labour cost among `costToDateCents` those hours already
   * pay for — billed by rate, so never marked up. Read with `costPlus`, whose
   * fee is the markup and whose maximum is the not-to-exceed.
   */
  labor?: { billableCents: number; costCents: number };
  costPlus?: {
    feePpm: number | null;
    /** The fixed fee, taken as fully earned once any cost exists — the billing side spreads it. */
    feeCents: number | null;
    gmaxCents: number | null;
  };
}

export interface WipFigures extends WipInputs {
  /** Null when there is nothing to measure against — no estimate on an unfinished job. */
  percentCompletePpm: number | null;
  earnedCents: number;
  /** earned − billed. Positive is under-billed (an asset), negative over-billed (a liability). */
  overUnderCents: number;
  underBilledCents: number;
  overBilledCents: number;
  grossProfitToDateCents: number;
  estimatedGrossProfitCents: number;
  costToCompleteCents: number;
  /** What is left to earn: contract − earned. */
  backlogCents: number;
}

/**
 * Cost to date over the estimate, in parts per million, truncated. Capped at
 * 100% — a job that has cost more than it was meant to is finished, not
 * 120% finished — and null when there is no estimate to measure against.
 */
export function percentCompletePpm(
  costToDateCents: number,
  estimatedCostCents: number,
  complete = false,
): number | null {
  if (complete) return WIP_PPM;
  if (estimatedCostCents <= 0) return null;
  if (costToDateCents <= 0) return 0;
  if (costToDateCents >= estimatedCostCents) return WIP_PPM;
  return Number((BigInt(costToDateCents) * BigInt(WIP_PPM)) / BigInt(estimatedCostCents));
}

/** contract × ppm ÷ 1,000,000, rounded half up, through BigInt. */
export function earnedCents(contractCents: number, ppm: number | null): number {
  if (ppm === null || ppm <= 0 || contractCents <= 0) return 0;
  if (ppm >= WIP_PPM) return contractCents;
  return Number((BigInt(contractCents) * BigInt(ppm) + BigInt(WIP_PPM / 2)) / BigInt(WIP_PPM));
}

/** cost × rate ÷ 1,000,000, rounded half up. The fee on cost to date. */
export function costPlusFeeCents(costToDateCents: number, feePpm: number | null): number {
  if (!feePpm || feePpm <= 0 || costToDateCents <= 0) return 0;
  return Math.floor((costToDateCents * feePpm + 500_000) / 1_000_000);
}

export function wipFigures(input: WipInputs): WipFigures {
  const ppm = percentCompletePpm(
    input.costToDateCents,
    input.estimatedCostCents,
    input.complete ?? false,
  );
  let earned: number;
  if (input.costPlus) {
    const cost = Math.max(input.costToDateCents, 0);
    // Hours are earned at their rates; the cost they already cover is not
    // marked up on top of them.
    const labor = input.labor ? Math.max(input.labor.billableCents, 0) : 0;
    const marked = input.labor ? Math.max(cost - Math.max(input.labor.costCents, 0), 0) : cost;
    const uncapped =
      labor +
      marked +
      costPlusFeeCents(marked, input.costPlus.feePpm) +
      (labor + marked > 0 ? (input.costPlus.feeCents ?? 0) : 0);
    earned =
      input.costPlus.gmaxCents !== null ? Math.min(uncapped, input.costPlus.gmaxCents) : uncapped;
  } else {
    earned = earnedCents(input.contractCents, ppm);
  }
  const overUnder = earned - input.billedCents;
  return {
    ...input,
    percentCompletePpm: ppm,
    earnedCents: earned,
    overUnderCents: overUnder,
    underBilledCents: overUnder > 0 ? overUnder : 0,
    overBilledCents: overUnder < 0 ? -overUnder : 0,
    grossProfitToDateCents: earned - input.costToDateCents,
    estimatedGrossProfitCents: input.contractCents - input.estimatedCostCents,
    costToCompleteCents: Math.max(input.estimatedCostCents - input.costToDateCents, 0),
    backlogCents: Math.max(input.contractCents - earned, 0),
  };
}

export interface WipTotals {
  contractCents: number;
  estimatedCostCents: number;
  costToDateCents: number;
  billedCents: number;
  earnedCents: number;
  underBilledCents: number;
  overBilledCents: number;
  grossProfitToDateCents: number;
  estimatedGrossProfitCents: number;
}

/** Column totals. Under and over are summed separately, never netted. */
export function wipTotals(rows: WipFigures[]): WipTotals {
  const t: WipTotals = {
    contractCents: 0,
    estimatedCostCents: 0,
    costToDateCents: 0,
    billedCents: 0,
    earnedCents: 0,
    underBilledCents: 0,
    overBilledCents: 0,
    grossProfitToDateCents: 0,
    estimatedGrossProfitCents: 0,
  };
  for (const r of rows) {
    t.contractCents += r.contractCents;
    t.estimatedCostCents += r.estimatedCostCents;
    t.costToDateCents += r.costToDateCents;
    t.billedCents += r.billedCents;
    t.earnedCents += r.earnedCents;
    t.underBilledCents += r.underBilledCents;
    t.overBilledCents += r.overBilledCents;
    t.grossProfitToDateCents += r.grossProfitToDateCents;
    t.estimatedGrossProfitCents += r.estimatedGrossProfitCents;
  }
  return t;
}

/** 500000 → "50", 333333 → "33.3", null → "—". One decimal, no trailing zero. */
export function wipPercentLabel(ppm: number | null): string {
  if (ppm === null) return "—";
  const pct = Math.round(ppm / 1_000) / 10;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}
