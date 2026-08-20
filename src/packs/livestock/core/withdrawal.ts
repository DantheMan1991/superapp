/**
 * The withdrawal clock. PURE — no imports, no database.
 *
 * **THIS IS THE ONE FILE IN THE PACK WHERE BEING QUIETLY WRONG IS A LEGAL
 * PROBLEM.** Everywhere else a bad number costs somebody a bad decision; here it
 * puts uninspectable meat in a freezer, or saleable-labelled milk with antibiotic
 * residue in it. The design's rule is that the app **must never present a number
 * as authoritative** — so nothing in this file invents a withdrawal period, and
 * every function errs toward saying an animal is still under one.
 *
 * What it does do is arithmetic on dates somebody else supplied, and that
 * arithmetic is worth getting exactly right:
 *
 *   - **Two clocks, meat and milk**, because the same injection routinely clears
 *     milk in days and meat in weeks. They are never merged.
 *   - **The binding treatment is the one that clears LAST**, not the most recent
 *     one given. A long-withdrawal product on the 1st outlasts a short one on
 *     the 10th, and a clock that showed the latest treatment would clear the lot
 *     while the first product was still in the animal.
 *   - **A period with no number is not a period of zero.** `null` days means
 *     nobody has looked it up, and this file refuses to call that clear.
 *
 * Dates are `YYYY-MM-DD` and arithmetic goes through `Date.UTC`, which is exact.
 */

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no DST. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromEpochDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** What the two clocks are about. Never merged into one. */
export type WithdrawalKind = "meat" | "milk";

/**
 * Where a withdrawal figure came from. **Closed**, unlike most taxonomies here,
 * because each value carries a different legal weight and a fourth would blur
 * the one distinction the design insists on.
 */
export const WITHDRAWAL_SOURCES = ["label", "vet", "none_stated"] as const;
export type WithdrawalSource = (typeof WITHDRAWAL_SOURCES)[number];

export const WITHDRAWAL_SOURCE_LABELS: Record<string, string> = {
  label: "From the label",
  vet: "From the vet",
  none_stated: "Not looked up",
};

export const WITHDRAWAL_SOURCE_NOTES: Record<string, string> = {
  label: "Read off the product label for this dose and route.",
  vet:
    "A vet's direction. Extra-label use extends withdrawal, and only they can say by how much.",
  none_stated:
    "Nobody has looked the period up yet. Treat this lot as under withdrawal until somebody does — an unknown is not a zero.",
};

export interface TreatmentLike {
  id: string;
  treatedOn: string;
  product: string;
  meatWithdrawalDays: number | null;
  milkWithdrawalDays: number | null;
  withdrawalSource: string;
}

/**
 * The first day the animal is clear, for one treatment and one clock.
 *
 * **Inclusive of the treatment day**: a 10-day withdrawal given on the 1st
 * clears on the 11th, which is the industry reading of "ten days must elapse".
 * A zero-day withdrawal clears the same day, which is what "no withdrawal"
 * means and is a real answer for plenty of products.
 *
 * Null when the period is null — nobody looked it up, so there is no date to
 * compute and the caller must not treat the absence as clearance.
 */
export function clearsOn(
  treatedOn: string,
  days: number | null,
): string | null {
  if (days === null) return null;
  return fromEpochDay(toEpochDay(treatedOn) + days);
}

export interface WithdrawalStatus {
  kind: WithdrawalKind;
  /** `clear` | `under` | `unknown`. Three, and the third is not a shrug. */
  state: "clear" | "under" | "unknown";
  /** The day it clears. Null when unknown. */
  clearsOn: string | null;
  /** Days still to run, 0 when it clears today. Null when unknown. */
  daysLeft: number | null;
  /** The treatment doing the blocking — the one that clears LAST. */
  binding: TreatmentLike | null;
}

function daysFor(treatment: TreatmentLike, kind: WithdrawalKind): number | null {
  return kind === "meat"
    ? treatment.meatWithdrawalDays
    : treatment.milkWithdrawalDays;
}

/**
 * Where one lot stands on one clock, today.
 *
 * **`unknown` OUTRANKS `clear`, and that is the safety decision in this file.**
 * A treatment recorded with no period looked up leaves the lot in a state that
 * is not clearance: the honest answer is "somebody has to go and read the
 * label", and a screen that said "clear" because a column was null would be the
 * app inventing the most dangerous number it could.
 *
 * It does NOT outrank `under`. A lot already blocked by a known 21-day period is
 * blocked; adding "and also we are unsure about another one" changes nothing a
 * person would do, and the binding treatment is still the one with the date.
 */
export function withdrawalStatus(
  treatments: TreatmentLike[],
  kind: WithdrawalKind,
  today: string,
): WithdrawalStatus {
  const now = toEpochDay(today);
  let binding: TreatmentLike | null = null;
  let latest = -Infinity;
  let unknown: TreatmentLike | null = null;

  for (const treatment of treatments) {
    const days = daysFor(treatment, kind);
    if (days === null) {
      // Only an unlooked-up period counts as unknown. A product that genuinely
      // states no withdrawal for this clock is recorded as 0, not null.
      if (treatment.withdrawalSource === "none_stated" && unknown === null) {
        unknown = treatment;
      }
      continue;
    }
    const clears = toEpochDay(treatment.treatedOn) + days;
    if (clears > latest) {
      latest = clears;
      binding = treatment;
    }
  }

  if (binding !== null && latest > now) {
    return {
      kind,
      state: "under",
      clearsOn: fromEpochDay(latest),
      daysLeft: latest - now,
      binding,
    };
  }
  if (unknown !== null) {
    return { kind, state: "unknown", clearsOn: null, daysLeft: null, binding: unknown };
  }
  return {
    kind,
    state: "clear",
    clearsOn: binding === null ? null : fromEpochDay(latest),
    daysLeft: binding === null ? null : 0,
    binding,
  };
}

/** Both clocks at once — the shape every screen wants. */
export interface LotWithdrawal {
  meat: WithdrawalStatus;
  milk: WithdrawalStatus;
  treatmentCount: number;
}

export function lotWithdrawal(
  treatments: TreatmentLike[],
  today: string,
): LotWithdrawal {
  return {
    meat: withdrawalStatus(treatments, "meat", today),
    milk: withdrawalStatus(treatments, "milk", today),
    treatmentCount: treatments.length,
  };
}

/**
 * Is there anything here that should stop somebody booking a processor?
 *
 * True for `under` AND for `unknown`, because both mean the same thing to the
 * person about to load a trailer: do not go until this is resolved.
 */
export function blocksProcessing(status: WithdrawalStatus): boolean {
  return status.state !== "clear";
}

/** "Clear", "7 days left", "Not looked up". What a badge says. */
export function formatWithdrawal(status: WithdrawalStatus): string {
  switch (status.state) {
    case "clear":
      return "Clear";
    case "unknown":
      return "Not looked up";
    case "under":
      return status.daysLeft === 1 ? "1 day left" : `${status.daysLeft} days left`;
  }
}

/**
 * The sentence under the badge — what it means and what to do about it.
 *
 * Written out rather than assembled from fragments, because this is the copy
 * somebody reads while deciding whether to put animals on a trailer.
 */
export function describeWithdrawal(status: WithdrawalStatus): string {
  const what = status.kind === "meat" ? "processed" : "sold for milk";
  switch (status.state) {
    case "clear":
      return status.binding === null
        ? "Nothing recorded that would hold them back."
        : `Clear since ${status.clearsOn}, after ${status.binding.product}.`;
    case "unknown":
      return `${status.binding?.product ?? "A treatment"} was given and the withdrawal period was never looked up. Until somebody reads the label, treat these as NOT clear — an unknown is not a zero.`;
    case "under":
      return `Cannot be ${what} until ${status.clearsOn}, after ${status.binding?.product ?? "treatment"}.`;
  }
}

/**
 * What this farm entered LAST TIME for the same product.
 *
 * **The only "default" this app offers, and it is the farm's own record rather
 * than the app's claim.** The design asks for a default the user can override
 * while forbidding the app from presenting a number as authoritative; a figure
 * somebody here typed off a label three weeks ago satisfies both, where a
 * built-in drug table would satisfy neither.
 *
 * Matched case-insensitively on the product name, because "Penicillin G" and
 * "penicillin g" are the same bottle. Returns the most recent.
 */
export function lastEnteredFor(
  treatments: TreatmentLike[],
  product: string,
): TreatmentLike | null {
  const wanted = product.trim().toLowerCase();
  if (!wanted) return null;
  const matches = treatments
    .filter((t) => t.product.trim().toLowerCase() === wanted)
    .sort((a, b) => (a.treatedOn < b.treatedOn ? -1 : 1));
  return matches.length === 0 ? null : matches[matches.length - 1];
}
