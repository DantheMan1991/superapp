import "server-only";
import { and, eq, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { failureSentence } from "../core/errors";
import { formatCents } from "../lib/money";
import { addDaysIso } from "../lib/dates";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";
import { approveBillFromAttentionAction } from "./actions";

/**
 * What the books say you still owe: money owed TO the business that is late,
 * bills waiting on somebody to approve them, and a standing instruction the
 * 6am sweep could not carry out.
 *
 * ── THE THIRD ONE IS A FAILURE, NOT A DATE ───────────────────────────────────
 *
 * A recurring template that fails leaves its code in `last_error` (the sweep's
 * note, cleared only by that template's next clean run) and does NOT advance
 * `next_run_date` — so the stored date is the period that was due and was not
 * written. That is an obligation in exactly this contract's sense: derived from
 * the row, gone the morning the template runs clean, and pointing at the record
 * that needs the fixing. Before this the note was visible only on the recurring
 * list, a page nobody opens unless they already suspect something.
 *
 * ACTIVE AND DUE, which is exactly the sweep's own predicate. The note is
 * cleared only by the template's next clean run — not by an edit, not by a
 * pause; "edited" is not "fixed" — so the item must bound itself on what the
 * sweep is currently being ASKED to do, or it nags about nothing:
 *
 *   - `is_active`: a paused template is not asked to run, so nothing is owed
 *     on it. Without this the feed would nag about a template somebody
 *     deliberately took out of service.
 *   - `next_run_date <= today`: an edit may move the date forward past today
 *     and deliberately leaves the note (the ordinary recovery is "fix the
 *     cause, skip the month"), and nothing can clear that note before the new
 *     date because the sweep only loads what is due. Without this bound such a
 *     template would read as overdue, with a future date and a stale reason,
 *     every morning for up to a month, and only Pause would make it stop. The
 *     adversarial pass found this; the first cut had it wrong.
 *
 * So the item has three honest exits: the fix (the next clean run clears the
 * note), the pause, and a forward edit past today, which parks it until that
 * date's run — when it either succeeds and clears, or fails and comes back.
 *
 * ── WHO GETS THESE, AND THE HONEST LIMITATION ────────────────────────────────
 *
 * Invoices and bills have no assignee column. There is no per-record answer to
 * "whose job is this", so the only truthful scoping available is by ROLE, and
 * the answer is: the owner's.
 *
 * That is a real narrowing and worth stating rather than hiding. In v1 a staff
 * member's digest carries no accounting items at all — not because their work
 * does not matter, but because the data cannot say which of it is theirs, and
 * inventing an answer ("everyone sees every overdue invoice") would produce
 * exactly the untrustworthy noise the whole design is written against. A
 * per-record owner on invoices and bills is the fix, and it is a schema change
 * that should be driven by somebody actually wanting it.
 *
 * The expert (outside accountant) is excluded from bill approvals for a
 * different and firmer reason: that role is read-only by construction and can
 * never post. Telling it to approve something would be an instruction it is
 * structurally barred from following.
 */

/** Unpaid, from the business's point of view: issued and part-paid both count. */
const UNPAID_INVOICE_STATUSES = ["issued", "partial"] as const;

/** Owed, from the business's point of view: approved and part-paid both count. */
const OWED_BILL_STATUSES = ["approved", "partial"] as const;

/**
 * How far ahead a bill we owe is worth a line (2026-09-07) — the AP mirror
 * of the customer reminders. A week is the invoice list's own "due soon"
 * horizon, and a fixed one rather than a setting: the customer reminders
 * have a schedule because they go OUT to somebody and a wrong day costs
 * goodwill; this only tells the owner, and seven days is what "coming up"
 * means to anyone paying bills on a Friday.
 */
export const BILL_DUE_SOON_DAYS = 7;

async function collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
  // See the header: no assignee column means role is the only honest scope.
  if (ctx.role !== "owner") return [];

  const [overdueInvoices, billsToApprove, billsDue, failingTemplates] = await Promise.all([
    tx
      .select({
        id: schema.invoices.id,
        number: schema.invoices.invoiceNumber,
        dueDate: schema.invoices.dueDate,
        totalCents: schema.invoices.totalCents,
      })
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.tenantId, ctx.tenantId),
          inArray(schema.invoices.status, [...UNPAID_INVOICE_STATUSES]),
          isNotNull(schema.invoices.dueDate),
          // Strictly less than today: an invoice due TODAY is not yet late.
          lt(schema.invoices.dueDate, ctx.today),
        ),
      )
      .limit(50),
    tx
      .select({
        id: schema.bills.id,
        number: schema.bills.billNumber,
        dueDate: schema.bills.dueDate,
        totalCents: schema.bills.totalCents,
        // The CAS the one-tap Approve sends, so the feed cannot approve a bill
        // somebody edited after the list was drawn.
        version: schema.bills.version,
      })
      .from(schema.bills)
      .where(
        and(
          eq(schema.bills.tenantId, ctx.tenantId),
          eq(schema.bills.status, "awaiting_approval"),
        ),
      )
      .limit(50),
    // Bills we owe that fall due within the week, or already have. The
    // balance rather than the total: a part-paid bill is a smaller ask.
    tx
      .select({
        id: schema.bills.id,
        number: schema.bills.billNumber,
        dueDate: schema.bills.dueDate,
        vendorName: schema.vendors.name,
        balanceCents: sql<string>`(${schema.bills.totalCents} - coalesce((select sum(${schema.billPayments.amountCents}) from ${schema.billPayments} where ${schema.billPayments.tenantId} = ${schema.bills.tenantId} and ${schema.billPayments.billId} = ${schema.bills.id}), 0))`,
      })
      .from(schema.bills)
      .innerJoin(
        schema.vendors,
        and(
          eq(schema.vendors.tenantId, schema.bills.tenantId),
          eq(schema.vendors.id, schema.bills.vendorId),
        ),
      )
      .where(
        and(
          eq(schema.bills.tenantId, ctx.tenantId),
          inArray(schema.bills.status, [...OWED_BILL_STATUSES]),
          isNotNull(schema.bills.dueDate),
          lte(schema.bills.dueDate, addDaysIso(ctx.today, BILL_DUE_SOON_DAYS)),
        ),
      )
      .limit(50),
    tx
      .select({
        id: schema.recurringEntries.id,
        kind: schema.recurringEntries.kind,
        name: schema.recurringEntries.name,
        nextRunDate: schema.recurringEntries.nextRunDate,
        lastError: schema.recurringEntries.lastError,
      })
      .from(schema.recurringEntries)
      .where(
        and(
          eq(schema.recurringEntries.tenantId, ctx.tenantId),
          eq(schema.recurringEntries.isActive, true),
          ne(schema.recurringEntries.lastError, ""),
          // The sweep's own due predicate; see the header for why it matters.
          lte(schema.recurringEntries.nextRunDate, ctx.today),
        ),
      )
      .limit(50),
  ]);

  const items: AttentionItem[] = [];

  for (const inv of overdueInvoices) {
    const days = daysBetween(inv.dueDate!, ctx.today);
    items.push({
      key: `invoice:${inv.id}`,
      title: `Invoice ${inv.number} is ${days === 1 ? "1 day" : `${days} days`} overdue`,
      detail: formatCents(inv.totalCents),
      urgency: "overdue",
      dueOn: inv.dueDate,
      href: `/dashboard/m/accounting/sales/invoices/${inv.id}`,
    });
  }

  for (const bill of billsToApprove) {
    // Waiting on a person, not on a date: a bill sits in awaiting_approval
    // until somebody acts, so its due date describes when payment is needed
    // rather than when the approval is late. Urgency follows that date when
    // there is one, and is "today" when there is not — it is on somebody's
    // desk right now either way.
    const overdue = bill.dueDate !== null && bill.dueDate < ctx.today;
    items.push({
      key: `bill:${bill.id}`,
      title: `Bill ${bill.number || "(no number)"} is waiting for approval`,
      detail: formatCents(bill.totalCents),
      urgency: overdue ? "overdue" : "today",
      dueOn: bill.dueDate,
      href: `/dashboard/m/accounting/purchases/bills/${bill.id}`,
      // The only one-tap verb accounting offers: approval is a decision the
      // owner makes from the title and the amount. An overdue invoice's verb
      // is "record the payment", which needs a form, so it stays a link.
      action: {
        kind: "bill.approve",
        label: "Approve",
        done: "Approved and posted.",
        args: { billId: bill.id, version: bill.version },
      },
    });
  }

  for (const bill of billsDue) {
    // The mirror of the overdue invoice, one week early: a bill due Friday is
    // worth a line on Monday, because the cash has to be there. The verb is
    // "record the payment", which needs a form, so this stays a link.
    const days = daysBetween(bill.dueDate!, ctx.today);
    const name = `Bill ${bill.number || "(no number)"} from ${bill.vendorName}`;
    items.push({
      key: `bill-due:${bill.id}`,
      title:
        days > 0
          ? `${name} is ${days === 1 ? "1 day" : `${days} days`} overdue`
          : days === 0
            ? `${name} is due today`
            : `${name} is due in ${days === -1 ? "1 day" : `${-days} days`}`,
      detail: `${formatCents(Number(bill.balanceCents))} owed`,
      urgency: days > 0 ? "overdue" : days === 0 ? "today" : "soon",
      dueOn: bill.dueDate,
      href: `/dashboard/m/accounting/purchases/bills/${bill.id}`,
    });
  }

  for (const t of failingTemplates) {
    // `next_run_date` is the period the sweep is being asked for and could
    // not write: the sweep does not move it on a failure, and the WHERE keeps
    // out a date an edit moved past today. Urgency follows the date the way the
    // bill branch does — a run that failed for today's period is "today", one
    // from an earlier day is "overdue" — and the title carries the day count,
    // because the email prints title and detail only and the invoice beside it
    // says "6 days overdue". The code becomes the same sentence the list page
    // shows, so the two surfaces cannot disagree about why.
    const behind = daysBetween(t.nextRunDate, ctx.today);
    const noun = `Recurring ${RECURRING_NOUN[t.kind]} "${t.name}"`;
    items.push({
      key: `recurring:${t.id}`,
      title:
        behind === 0
          ? `${noun} could not run today`
          : `${noun} could not run, ${behind === 1 ? "1 day" : `${behind} days`} behind`,
      detail: failureSentence(t.lastError),
      urgency: behind > 0 ? "overdue" : "today",
      dueOn: t.nextRunDate,
      href: `/dashboard/m/accounting/recurring#${t.id}`,
    });
  }

  return items;
}

/** The noun in "Recurring bill" — lower case, mid-sentence. */
const RECURRING_NOUN: Record<"journal" | "invoice" | "bill", string> = {
  journal: "journal",
  invoice: "invoice",
  bill: "bill",
};

/** Whole days between two `yyyy-mm-dd` strings, both treated as midnight UTC. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

export const accountingAttentionSource: AttentionSource = {
  slug: "accounting",
  moduleSlug: "accounting",
  label: "Accounting",
  collect,
  actions: { "bill.approve": approveBillFromAttentionAction },
};
