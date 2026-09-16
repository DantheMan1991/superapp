import { BONDED_STANDINGS, BOND_STANDING_LABELS, EXPIRING_SOON_DAYS, type BondStanding, type BondStatus } from "./vocabulary";

/**
 * Bonding's arithmetic (ADR 0078), pure so the job's page, the capacity
 * screen and the tests read one rule.
 *
 * ── THE ONE INVARIANT WORTH STATING ─────────────────────────────────────────
 *
 * A JOB COUNTS ONCE, however many bonds it carries. Performance and payment
 * bonds are almost always issued as a pair on the same contract, and a
 * surety backs the WORK, not the pieces of paper. Summing per bond would
 * report twice the capacity used on every properly bonded job, which is the
 * one number this screen exists to get right.
 */

const at = (s: string): number => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/**
 * Where a bond stands. A dropped or released one is settled whatever the
 * dates say; one in force is read against today, and a bond with no expiry
 * stays in force until somebody releases it, which is how most are written.
 */
export function bondStanding(status: BondStatus | string, expiresOn: string | null, today: string): BondStanding {
  if (status === "void") return "void";
  if (status === "released") return "released";
  if (status === "requested") return "requested";
  if (!expiresOn) return "active";
  const left = daysBetween(today, expiresOn);
  if (left < 0) return "expired";
  if (left <= EXPIRING_SOON_DAYS) return "expiring";
  return "active";
}

/** A bond in one of these standings still ties up the surety's line. */
export function tiesUpCapacity(standing: BondStanding): boolean {
  return BONDED_STANDINGS.includes(standing);
}

export interface BondedJobInput {
  projectId: string;
  /** Original plus approved changes, over signed and complete contracts. */
  contractCents: number;
  /** Invoiced against the job to date. */
  billedCents: number;
}

export interface BondedJob extends BondedJobInput {
  /** What is left to build: the contract less what has been billed, never below nothing. */
  backlogCents: number;
}

export function backlogOf(job: BondedJobInput): BondedJob {
  return { ...job, backlogCents: Math.max(0, job.contractCents - job.billedCents) };
}

export interface BondingLimits {
  singleJobLimitCents: number | null;
  aggregateLimitCents: number | null;
}

export interface BondingCapacity extends BondingLimits {
  /** Σ backlog over the DISTINCT jobs with a bond still in force. */
  usedCents: number;
  /** Aggregate less used; null until somebody types an aggregate. Never below nothing. */
  availableCents: number | null;
  /** How many jobs are tying it up. */
  jobCount: number;
  /** True once used has passed the aggregate — the surety's letter is exhausted. */
  over: boolean;
}

/**
 * What the surety's line has left. `jobs` must already be DISTINCT by job:
  * the caller folds a job's bonds into one entry before this sees them.
 */
export function bondingCapacity(limits: BondingLimits, jobs: readonly BondedJob[]): BondingCapacity {
  const usedCents = jobs.reduce((total, j) => total + j.backlogCents, 0);
  const availableCents = limits.aggregateLimitCents === null ? null : Math.max(0, limits.aggregateLimitCents - usedCents);
  return {
    ...limits,
    usedCents,
    availableCents,
    jobCount: jobs.length,
    over: limits.aggregateLimitCents !== null && usedCents > limits.aggregateLimitCents,
  };
}

export type FitVerdict = "fits" | "over_single" | "over_aggregate" | "unknown";

/**
 * Whether one more job of this size would go on the line: under the
 * single-job limit, and its backlog inside what is left. `unknown` when the
 * business has not been told a limit, which is not the same as a no.
 */
export function wouldFit(capacity: BondingCapacity, contractCents: number): FitVerdict {
  if (capacity.singleJobLimitCents !== null && contractCents > capacity.singleJobLimitCents) return "over_single";
  if (capacity.availableCents !== null && contractCents > capacity.availableCents) return "over_aggregate";
  if (capacity.singleJobLimitCents === null && capacity.aggregateLimitCents === null) return "unknown";
  return "fits";
}

const money = (cents: number): string =>
  (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A job's bonds in one line, by standing: the panel's own sentence. */
export function bondsSentence(standings: readonly BondStanding[]): string {
  if (standings.length === 0) return "No bonds on this job.";
  const counts = new Map<BondStanding, number>();
  for (const s of standings) counts.set(s, (counts.get(s) ?? 0) + 1);
  const parts = [...counts.entries()].map(([standing, n]) => `${n} ${BOND_STANDING_LABELS[standing].toLowerCase()}`);
  return `${plural(standings.length, "bond", "bonds")}: ${parts.join(", ")}.`;
}

/** The capacity screen's own sentence, and the only place it is worded. */
export function capacitySentence(capacity: BondingCapacity, jobWord: string, jobsWord: string): string {
  const onHand = `${money(capacity.usedCents)} of bonded work on hand across ${plural(capacity.jobCount, jobWord, jobsWord)}`;
  if (capacity.aggregateLimitCents === null) {
    return capacity.jobCount === 0
      ? "No bonded work on hand, and no line recorded. Set the limits your surety gave you to see what is left."
      : `${onHand}. Set the limits your surety gave you to see what is left.`;
  }
  if (capacity.over) {
    return `${onHand}, past the ${money(capacity.aggregateLimitCents)} your surety backs. Ask them before you bid again.`;
  }
  return `${onHand}, leaving ${money(capacity.availableCents ?? 0)} of the ${money(capacity.aggregateLimitCents)} your surety backs.`;
}

/** What the fit check says on the screen, in the words somebody about to bid wants. */
export function fitSentence(capacity: BondingCapacity, contractCents: number): string {
  switch (wouldFit(capacity, contractCents)) {
    case "fits":
      return `A ${money(contractCents)} job fits: inside the single-job limit and inside what is left.`;
    case "over_single":
      return `A ${money(contractCents)} job is over the ${money(capacity.singleJobLimitCents ?? 0)} single-job limit. Your surety would have to agree to it.`;
    case "over_aggregate":
      return `A ${money(contractCents)} job is more than the ${money(capacity.availableCents ?? 0)} left on the line.`;
    case "unknown":
      return "No limits recorded, so there is nothing to measure a new job against.";
  }
}
