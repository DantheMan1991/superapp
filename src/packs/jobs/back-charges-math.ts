import type { BackChargeStanding, BackChargeStatus } from "./vocabulary";

/**
 * The back-charge's arithmetic (ADR 0077), pure so the order's page, the
 * bill the application posts and the tests read one rule.
 *
 * ── THE ONE INVARIANT WORTH STATING ─────────────────────────────────────────
 *
 * A back-charge comes off the BOTTOM of an application and never touches the
 * certificate above it. The schedule of values, what is complete to date,
 * the retainage held and "less previous certificates" are all about the
 * WORK, and the work is unchanged by the business having paid for some of
 * it — so the next application's `previousCertificatesCents` is still the
 * gross certified, exactly as before (`certifiedCents`). Netting a
 * back-charge into the certificate would deduct it twice: once on its own
 * application, and again by leaving that much still apparently due.
 */

/** What the standing needs to know about the application a back-charge sits on. */
export interface ApplicationState {
  status: string;
}

export function backChargeStanding(
  status: BackChargeStatus | string,
  application: ApplicationState | null,
): BackChargeStanding {
  if (status === "void") return "void";
  if (!application) return "open";
  if (application.status === "billed") return "deducted";
  if (application.status === "draft") return "on_application";
  // A voided application is no application: the money is owed again. The op
  // clears the link as well, so this is the belt to that braces.
  return "open";
}

/** A back-charge is settled once its application has been billed; only then is it fixed. */
export function isDeducted(standing: BackChargeStanding): boolean {
  return standing === "deducted";
}

/** Still to come off somebody: raised, not dropped, not yet on a billed application. */
export function isOutstanding(standing: BackChargeStanding): boolean {
  return standing === "open" || standing === "on_application";
}

export interface BackChargeAmount {
  amountCents: number;
  standing: BackChargeStanding;
}

const sum = (rows: readonly BackChargeAmount[], keep: (s: BackChargeStanding) => boolean): number =>
  rows.reduce((total, r) => (keep(r.standing) ? total + r.amountCents : total), 0);

export interface BackChargeTotals {
  /** On the draft application, so coming off this payment. */
  onApplicationCents: number;
  /** Raised and not yet on any application. */
  openCents: number;
  /** Taken on a billed application, for good. */
  deductedCents: number;
  /** Everything not dropped: what the subcontractor is being charged in all. */
  raisedCents: number;
}

export function backChargeTotals(rows: readonly BackChargeAmount[]): BackChargeTotals {
  return {
    onApplicationCents: sum(rows, (s) => s === "on_application"),
    openCents: sum(rows, (s) => s === "open"),
    deductedCents: sum(rows, (s) => s === "deducted"),
    raisedCents: sum(rows, (s) => s !== "void"),
  };
}

/**
 * What the subcontractor is actually paid: the certificate's payment due,
 * less the back-charges riding on this application. Never below nothing —
 * the verb refuses before it gets here, and this says what the page shows.
 */
export function netDueCents(dueCents: number, backChargesCents: number): number {
  return dueCents - backChargesCents;
}

const money = (cents: number): string =>
  (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The panel's sentence. Deliberately says the outstanding money first: what
 * is still to come off somebody is the number the office is looking for.
 */
export function backChargeSentence(totals: BackChargeTotals, hasDraft: boolean): string {
  const outstanding = totals.openCents + totals.onApplicationCents;
  if (totals.raisedCents === 0) {
    return "Nothing charged back on this order.";
  }
  const parts: string[] = [];
  if (totals.onApplicationCents > 0) parts.push(`${money(totals.onApplicationCents)} on the draft application`);
  if (totals.openCents > 0) {
    parts.push(
      hasDraft
        ? `${money(totals.openCents)} not yet deducted`
        : `${money(totals.openCents)} waiting for an application to come off`,
    );
  }
  if (totals.deductedCents > 0) parts.push(`${money(totals.deductedCents)} already deducted`);
  return `${money(totals.raisedCents)} charged back${outstanding > 0 || totals.deductedCents > 0 ? `: ${parts.join(", ")}` : ""}.`;
}

/** The line a bill carries, so a bookkeeper reading the entry knows what it is. */
export function backChargeBillDescription(number: number, description: string, applicationNumber: number): string {
  return `Back-charge ${number} — ${description.trim()} (application ${applicationNumber})`;
}

/**
 * The refusal when the back-charges riding on an application come to as much
 * as it does or more. Deducting the rest on a later application is the
 * answer, and the sentence says so rather than leaving the office to guess.
 */
export function backChargesExceedMessage(dueCents: number, backChargesCents: number, count: number): string {
  return `${plural(count, "back-charge comes", "back-charges come")} to ${money(backChargesCents)} against a payment of ${money(
    dueCents,
  )}. Take some of them off this application and deduct them on a later one`;
}
