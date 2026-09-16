import { formatMoney, formatMoneySign } from "@/lib/money";
import type { WipFigures } from "./wip-math";

/**
 * WHAT THIS JOB NEEDS SOMEBODY TO DO, derived and never stored.
 *
 * ── THE PANEL THE PROJECT PAGE WAS MISSING ──────────────────────────────────
 *
 * Every fact below was already on the page, spread across eleven panels: the
 * billing variance in one, a negative code variance in another, a pending
 * selection in a third. Reading them meant scrolling past four tables and
 * knowing what to look for. Nothing here is new data — it is the same figures,
 * sorted by whether anybody has to act on them.
 *
 * ── A DECISION IS A FACT PLUS A NEXT ACTION ─────────────────────────────────
 *
 * Every row says what is true (`title`), how we know (`why`), and offers the
 * one place to go about it (`action`). A row with no action does not belong
 * here — it belongs in a table, where facts live. That is the test for adding
 * a kind: if the button would be "look at it", leave it out.
 *
 * Pure, so `tests/jobs-decisions.test.ts` can pin every rule; `formatMoney` is
 * shared by server and client and carries no `server-only`.
 */
export type DecisionKind =
  | "over_billed"
  | "code_over"
  | "selection_overdue"
  | "selection_pending"
  | "change_proposed"
  | "waiver_gap"
  | "certificate";

export interface Decision {
  kind: DecisionKind;
  /**
   * `bad` is money already gone the wrong way or a date already missed;
   * `warn` is something heading that way. Sorted `bad` first, because a panel
   * that buries the overdue item under the merely-pending one is a list
   * nobody reads twice.
   */
  severity: "bad" | "warn";
  title: string;
  why: string;
  action: { label: string; href: string };
}

export interface DecisionInput {
  projectId: string;
  symbol: string | null;
  /** From the same `measureProject` the list and the vitals strip use. */
  figures: WipFigures | null;
  costRows: readonly {
    costCodeId: string;
    code: string;
    name: string;
    budgetCents: number;
    committedCents: number;
    actualCents: number;
    varianceCents: number;
    hasBudget: boolean;
  }[];
  selections: { pending: number; overdue: number };
  /** Change orders proposed and not yet answered, and what they are worth. */
  proposedChanges: { count: number; cents: number };
  /** Lien-waiver gaps where the money has already gone out. */
  paidWaiverGaps: readonly { commitmentNumber: string; partyName: string }[];
  /** Party certificates expired or inside `EXPIRING_SOON_DAYS`. */
  lapsedCertificates: readonly { partyName: string; expiresOn: string | null }[];
}

export function decisionsFor(input: DecisionInput): Decision[] {
  const { projectId, symbol } = input;
  const job = `/dashboard/m/jobs/${projectId}`;
  const out: Decision[] = [];

  /*
   * OVER-BILLED ONLY. Under-billed is money you are owed and have not asked
   * for — a real thing, and on the strip above — but it is not a decision: the
   * answer is always "invoice it", which the billing screen already prompts.
   * Over-billed is the one that needs a judgement, because the fix is either to
   * re-estimate the cost or to hold the next application.
   */
  if (input.figures && input.figures.overBilledCents > 0) {
    out.push({
      kind: "over_billed",
      severity: "bad",
      title: `Billed ${formatMoney(input.figures.overBilledCents, symbol)} ahead of the work done`,
      why: "Re-estimate the cost, or hold the next application until the work catches up.",
      action: { label: "Open WIP", href: "/dashboard/m/jobs/wip" },
    });
  }

  /*
   * THE WORST CODE, NOT EVERY CODE. A job that has gone over on six codes does
   * not need six rows saying so — it needs the one to open first, and the Job
   * cost tab for the rest. Sorted by how far over, so "worst" means worst.
   */
  const over = input.costRows
    .filter((r) => r.hasBudget && r.varianceCents < 0)
    .sort((a, b) => a.varianceCents - b.varianceCents);
  if (over.length > 0) {
    const worst = over[0];
    out.push({
      kind: "code_over",
      severity: "bad",
      title: `${worst.name} is ${formatMoney(-worst.varianceCents, symbol)} over its budget`,
      /*
       * NAME THE FIGURE THAT CAUSED IT. The variance is budget less the GREATER
       * of ordered and spent, so quoting "ordered" on a code that went over on
       * spend prints a sentence whose own numbers do not reach the total above
       * it — $34,000 ordered against $40,000 does not explain being $23,650
       * over. Whichever is larger is the one doing the damage, and it is named.
       */
      why:
        (worst.actualCents >= worst.committedCents
          ? `Code ${worst.code} · ${formatMoney(worst.actualCents, symbol)} spent against `
          : `Code ${worst.code} · ${formatMoney(worst.committedCents, symbol)} ordered against `) +
        `${formatMoney(worst.budgetCents, symbol)} budgeted` +
        (over.length > 1 ? ` · ${over.length - 1} more code${over.length > 2 ? "s" : ""} over` : ""),
      action: { label: "Open code", href: `${job}/cost?f=over` },
    });
  }

  if (input.selections.overdue > 0) {
    out.push({
      kind: "selection_overdue",
      severity: "bad",
      title:
        input.selections.overdue === 1
          ? "A selection is past the date it was needed by"
          : `${input.selections.overdue} selections are past the date they were needed by`,
      why: "Until the client chooses, the trade that is waiting on it cannot start.",
      action: { label: "Send reminder", href: `${job}/selections` },
    });
  } else if (input.selections.pending > 0) {
    out.push({
      kind: "selection_pending",
      severity: "warn",
      title:
        input.selections.pending === 1
          ? "One selection is waiting on the client"
          : `${input.selections.pending} selections are waiting on the client`,
      why: "Nothing is overdue yet — a reminder now is cheaper than a delay later.",
      action: { label: "Open list", href: `${job}/selections` },
    });
  }

  if (input.proposedChanges.count > 0) {
    out.push({
      kind: "change_proposed",
      severity: "warn",
      title: `${formatMoneySign(input.proposedChanges.cents, symbol)} in changes proposed, not approved`,
      why: "Nothing counts toward the contract until the owner says yes.",
      action: { label: "View", href: `${job}/changes` },
    });
  }

  /*
   * PAID WITH NO UNCONDITIONAL WAIVER: money has already left, so this is the
   * one compliance row that is `bad` rather than `warn` (ADR 0066).
   */
  if (input.paidWaiverGaps.length > 0) {
    const first = input.paidWaiverGaps[0];
    const more = input.paidWaiverGaps.length - 1;
    out.push({
      kind: "waiver_gap",
      severity: "bad",
      title:
        input.paidWaiverGaps.length === 1
          ? `${first.partyName} was paid with no unconditional waiver`
          : `${input.paidWaiverGaps.length} paid applications have no unconditional waiver`,
      why:
        input.paidWaiverGaps.length === 1
          ? `Order ${first.commitmentNumber} · the money has already gone out.`
          : `Starting with ${first.commitmentNumber} · ${more} other${more > 1 ? "s" : ""}.`,
      action: { label: "Chase", href: `${job}/ordered` },
    });
  }

  if (input.lapsedCertificates.length > 0) {
    const first = input.lapsedCertificates[0];
    out.push({
      kind: "certificate",
      severity: "warn",
      title:
        input.lapsedCertificates.length === 1
          ? `${first.partyName}'s certificate has lapsed`
          : `${input.lapsedCertificates.length} subcontractor certificates have lapsed`,
      why: first.expiresOn
        ? `Expired ${first.expiresOn}, and they are on site.`
        : "No expiry on file, and they are on site.",
      action: { label: "Request a copy", href: "/dashboard/m/jobs/subcontractors" },
    });
  }

  // `bad` first, and otherwise the order they were derived in, which is the
  // order the page's own panels run in.
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "bad" ? -1 : 1));
}
