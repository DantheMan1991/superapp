import { type ClaimStanding, type WarrantyDecision } from "./vocabulary";

/**
 * The warranty's arithmetic (ADR 0076), pure so the page, the list across
 * jobs and the tests read one rule: the period is months from substantial
 * completion, the expiry is derived from the two, a claim is inside or
 * outside it by the day it was reported, and where a claim stands is read
 * from its decision and the Work item it raised. Dates are `YYYY-MM-DD`
 * strings and the arithmetic is calendar arithmetic in UTC on the parts,
 * never a local `Date` — a warranty does not move by a time zone.
 */

export interface WarrantyPeriod {
  substantialCompletionOn: string | null;
  warrantyMonths: number | null;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/**
 * `date` plus `months`, the day clamped to the month's last day:
 * 2026-01-31 + 1 month = 2026-02-28, 2027-02-28 + 12 = 2028-02-28. The
 * convention every warranty clause means by "one year from completion".
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${pad(ny, 4)}-${pad(nm + 1, 2)}-${pad(Math.min(d, last), 2)}`;
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const at = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** The day the warranty ends, or null until both halves of the period are set. */
export function warrantyExpiresOn(p: WarrantyPeriod): string | null {
  if (!p.substantialCompletionOn || !p.warrantyMonths || p.warrantyMonths <= 0) return null;
  return addMonths(p.substantialCompletionOn, p.warrantyMonths);
}

/** Inside `EXPIRING_WITHIN_DAYS` of the end, the period reads as expiring: the last walk-through is due. */
export const EXPIRING_WITHIN_DAYS = 60;

export type WarrantyState = "unset" | "not_started" | "running" | "expiring" | "expired";

export interface WarrantyStanding {
  state: WarrantyState;
  expiresOn: string | null;
  /** Days from today to the expiry; negative once it has passed; null when unset. */
  daysLeft: number | null;
}

export function warrantyStanding(p: WarrantyPeriod, today: string): WarrantyStanding {
  const expiresOn = warrantyExpiresOn(p);
  if (!expiresOn) return { state: "unset", expiresOn: null, daysLeft: null };
  const daysLeft = daysBetween(today, expiresOn);
  if (today < p.substantialCompletionOn!) return { state: "not_started", expiresOn, daysLeft };
  if (daysLeft < 0) return { state: "expired", expiresOn, daysLeft };
  if (daysLeft <= EXPIRING_WITHIN_DAYS) return { state: "expiring", expiresOn, daysLeft };
  return { state: "running", expiresOn, daysLeft };
}

/**
 * Whether the day a claim was reported falls inside the period — on or
 * before the expiry. A claim reported before substantial completion is
 * inside: a defect found early is still the builder's. Null when the job
 * has no period, which the page shows as nothing rather than as a verdict.
 */
export function withinWarranty(reportedOn: string, p: WarrantyPeriod): boolean | null {
  const expiresOn = warrantyExpiresOn(p);
  if (!expiresOn) return null;
  return reportedOn <= expiresOn;
}

/**
 * Where a claim stands, from its decision and its Work item. Not covered is
 * the decision's word whatever the work says; otherwise the work says: done
 * when closed, scheduled when it carries a date, open when it carries
 * nothing — or when the item was cleared from Work, which leaves the call
 * on record and open.
 */
export function claimStanding(
  decision: WarrantyDecision,
  work: { completedAt: Date | null; dueOn: string | null } | null,
): ClaimStanding {
  if (decision === "not_covered") return "not_covered";
  if (!work) return "open";
  if (work.completedAt !== null) return "done";
  if (work.dueOn) return "scheduled";
  return "open";
}

export interface ClaimCounts {
  total: number;
  open: number;
  scheduled: number;
  done: number;
  notCovered: number;
}

export function summariseClaims(standings: readonly ClaimStanding[]): ClaimCounts {
  const c: ClaimCounts = { total: standings.length, open: 0, scheduled: 0, done: 0, notCovered: 0 };
  for (const s of standings) {
    if (s === "open") c.open += 1;
    else if (s === "scheduled") c.scheduled += 1;
    else if (s === "done") c.done += 1;
    else c.notCovered += 1;
  }
  return c;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function monthsWord(months: number): string {
  return plural(months, "month", "months");
}

/** The period in one sentence, for the page's head and the list across jobs. */
export function periodSentence(p: WarrantyPeriod, standing: WarrantyStanding): string {
  switch (standing.state) {
    case "unset":
      return "No warranty period set.";
    case "not_started":
      return `The warranty starts at substantial completion on ${p.substantialCompletionOn} and runs ${monthsWord(p.warrantyMonths!)}, to ${standing.expiresOn}.`;
    case "running":
    case "expiring":
      return `Under warranty until ${standing.expiresOn}, ${plural(standing.daysLeft!, "day", "days")} left.`;
    case "expired":
      return `The warranty ended ${standing.expiresOn}, ${plural(-standing.daysLeft!, "day", "days")} ago.`;
  }
}

/** The claims in one sentence: "3 claims: 1 open, 1 scheduled, 1 done." */
export function claimsSentence(c: ClaimCounts): string {
  if (c.total === 0) return "No claims.";
  const parts = [
    c.open > 0 ? `${c.open} open` : null,
    c.scheduled > 0 ? `${c.scheduled} scheduled` : null,
    c.done > 0 ? `${c.done} done` : null,
    c.notCovered > 0 ? `${c.notCovered} not covered` : null,
  ].filter((x): x is string => x !== null);
  return `${plural(c.total, "claim", "claims")}: ${parts.join(", ")}.`;
}

/** The Work item's title: the claim by number and job, then what is wrong. */
export function workTitleFor(number: number, title: string, projectNumber: string): string {
  const what = title.trim();
  return `Warranty claim ${number} on ${projectNumber}: ${what.length > 200 ? `${what.slice(0, 199)}…` : what}`;
}
