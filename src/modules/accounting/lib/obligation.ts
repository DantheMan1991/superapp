import { daysBetween } from "./dates";

/**
 * What a record is actually asking of you — pure, no `server-only`.
 *
 * `issued` is a LIFECYCLE state; it tells a reader what the software did, not
 * what they owe or are owed. "Overdue 60 days" is the same row expressed as an
 * obligation, and it is the difference between a list you scan and a list you
 * act on. The lifecycle status is still what the database stores and what every
 * guard checks — this is a rendering of it, computed at read time, never
 * persisted.
 */

export type ObligationTone = "settled" | "neutral" | "due" | "overdue";

export interface ObligationInput {
  /** The stored lifecycle status: draft | issued | partial | paid | void … */
  status: string;
  dueDate: string | null;
  /** What is still owed. Zero or less means settled, whatever the status says. */
  balanceCents: number;
  /** Tenant-local today, from `todayInTimezone` at the call site (P1). */
  today: string;
}

export interface Obligation {
  label: string;
  tone: ObligationTone;
  /** Positive = days late, negative = days remaining, null = no due date. */
  daysPastDue: number | null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function obligationFor(input: ObligationInput): Obligation {
  // The two terminal states say nothing about money and are read first, so a
  // voided invoice with a stale due date can never render as overdue.
  if (input.status === "void") {
    return { label: "Void", tone: "settled", daysPastDue: null };
  }
  if (input.status === "draft") {
    return { label: "Draft", tone: "neutral", daysPastDue: null };
  }

  // BALANCE BEATS STATUS. `paid` derives from payments, and the two are written
  // in one transaction — but if they ever disagreed, the money is the fact and
  // the status is the summary of it.
  if (input.balanceCents <= 0) {
    return { label: "Paid", tone: "settled", daysPastDue: null };
  }

  if (input.dueDate === null) {
    // Owed, with nothing to be late against. Not "overdue", not "due soon".
    return { label: "Open", tone: "neutral", daysPastDue: null };
  }

  const daysPastDue = daysBetween(input.dueDate, input.today);
  if (daysPastDue > 0) {
    return {
      label: `Overdue ${plural(daysPastDue, "day")}`,
      tone: "overdue",
      daysPastDue,
    };
  }
  if (daysPastDue === 0) {
    return { label: "Due today", tone: "due", daysPastDue: 0 };
  }
  const daysLeft = -daysPastDue;
  return {
    label: daysLeft === 1 ? "Due tomorrow" : `Due in ${plural(daysLeft, "day")}`,
    tone: daysLeft <= 7 ? "due" : "neutral",
    daysPastDue,
  };
}

/* -- the MoneyBar --------------------------------------------------------- */

/**
 * The buckets a list can be sliced by.
 *
 * Two are about the DOCUMENT (is it late?) and two are about the MONEY
 * (has it reached the bank?). Mixing them in one bar is deliberate and is what
 * QuickBooks' own MoneyBar does: they are the four questions somebody actually
 * has about a sales ledger, and answering "which cheques have I not banked?"
 * needs the payment side rather than the invoice side.
 */
export const AR_BUCKETS = [
  "overdue",
  "not_due",
  "not_deposited",
  "deposited",
] as const;

export const AP_BUCKETS = [
  "overdue",
  "not_due",
  "awaiting_approval",
  "paid_recently",
] as const;

export type ArBucket = (typeof AR_BUCKETS)[number];
export type ApBucket = (typeof AP_BUCKETS)[number];

export const AR_BUCKET_LABEL: Record<ArBucket, string> = {
  overdue: "Overdue",
  not_due: "Not due yet",
  not_deposited: "Not deposited",
  deposited: "Deposited",
};

export const AP_BUCKET_LABEL: Record<ApBucket, string> = {
  overdue: "Overdue",
  not_due: "Not due yet",
  awaiting_approval: "Awaiting approval",
  paid_recently: "Paid recently",
};

/** How far back "recently" reaches, for the two backward-looking buckets. */
export const RECENT_DAYS = 30;

export function isArBucket(value: string | undefined): value is ArBucket {
  return !!value && (AR_BUCKETS as readonly string[]).includes(value);
}

export function isApBucket(value: string | undefined): value is ApBucket {
  return !!value && (AP_BUCKETS as readonly string[]).includes(value);
}

/**
 * Which document bucket a row falls in, or null when it is in neither.
 *
 * Only the two document buckets are decidable from a row alone — the deposit
 * buckets depend on where a payment landed, which is a different table and is
 * resolved by the query rather than here.
 */
export function documentBucket(
  input: ObligationInput,
): "overdue" | "not_due" | null {
  if (input.status === "void" || input.status === "draft") return null;
  if (input.balanceCents <= 0) return null;
  if (input.dueDate === null) return "not_due";
  return daysBetween(input.dueDate, input.today) > 0 ? "overdue" : "not_due";
}
