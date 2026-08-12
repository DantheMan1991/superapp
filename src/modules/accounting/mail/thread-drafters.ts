import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  DraftableThread,
  DraftedRecord,
  EntityLinkCtx,
  LinkableEntityRef,
  MailThreadDrafter,
} from "@/lib/mail-extensions/types";
import { LedgerError, type LedgerCtx } from "../core";
import { createInvoiceDraft } from "../invoicing/invoices";
import { createBillDraft } from "../payables/bills";
import { lineAmountCents, parseQuantityHundredths } from "../invoicing/lines";
import { draftFromThread, resolveDraftParty } from "../ai/thread-draft";

/**
 * What Accounting offers Mail: "this conversation is an invoice", and "this
 * conversation is a bill".
 *
 * Both directions share one AI engine and one validator; they differ only in
 * which party table they match against and what a line means at the far end.
 * See `docs/modules/accounting.md`.
 *
 * NOTHING HERE POSTS. `accept` creates a DRAFT, which is then edited, issued
 * or approved by the ordinary lifecycle — the same rule every AI surface in
 * this module follows, and the reason a wrong suggestion costs a click rather
 * than a journal entry.
 */

/** `EntityLinkCtx` and `LedgerCtx` are structurally the same three fields. */
function ledgerCtx(ctx: EntityLinkCtx): LedgerCtx {
  return { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
}

/**
 * The income account a drafted invoice line lands on.
 *
 * The prompt deliberately does NOT ask the model to categorise revenue: the
 * hard part of reading a thread is working out what was agreed and for how
 * much, and loading the whole chart of accounts into that question makes it
 * worse at the part that matters. Every line lands on the lowest-numbered
 * active income account — conventionally 4000 Sales — and the reviewer
 * re-points it in the invoice builder if it belongs elsewhere.
 *
 * Bills need no equivalent, because `bill_lines.account_id` is nullable by
 * design (P9) and the existing bill-coding AI codes them afterwards.
 */
async function defaultIncomeAccountId(tx: Tx, tenantId: string): Promise<string> {
  const row = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.accountType, "income"),
      eq(schema.accounts.isActive, true),
    ),
    orderBy: asc(schema.accounts.code),
  });
  if (!row) {
    throw new LedgerError(
      "ACCOUNT_NOT_FOUND",
      "no active income account to put these lines on",
    );
  }
  return row.id;
}

/**
 * Lines worth creating, re-derived from the reviewed record.
 *
 * The record came back through a browser, so every figure is re-parsed here
 * rather than trusted — and a zero-value line is dropped, because an invoice
 * line worth nothing is a note, not a charge.
 */
function usableLines(record: DraftedRecord): DraftedRecord["lines"] {
  return record.lines.filter((l) => {
    if (parseQuantityHundredths(l.quantity) === null) return false;
    return l.unitPriceCents !== 0;
  });
}

function memoFor(record: DraftedRecord): string {
  // Provenance in a sentence, for anyone opening the record later. The durable
  // link is the mail_links row mail writes; this is the human-readable half.
  const caveat = record.caveats.length > 0 ? ` (${record.caveats.length} caveat${record.caveats.length === 1 ? "" : "s"} at drafting)` : "";
  return `Drafted from an email conversation${caveat}.`;
}

export const invoiceThreadDrafter: MailThreadDrafter = {
  kind: "invoice",
  label: "Draft an invoice",

  async draft(
    tx: Tx,
    ctx: EntityLinkCtx,
    thread: DraftableThread,
  ): Promise<DraftedRecord | null> {
    return draftFromThread(tx, ctx, "invoice", thread);
  },

  async accept(
    tx: Tx,
    ctx: EntityLinkCtx,
    record: DraftedRecord,
  ): Promise<LinkableEntityRef> {
    const customer = await resolveDraftParty(
      tx,
      ctx.tenantId,
      "invoice",
      record.partyId,
    );
    if (!customer) {
      throw new LedgerError(
        "CUSTOMER_NOT_FOUND",
        "pick the customer this invoice is for",
      );
    }
    const lines = usableLines(record);
    if (lines.length === 0) {
      throw new LedgerError("INVOICE_EMPTY", "nothing to invoice");
    }
    const incomeAccountId = await defaultIncomeAccountId(tx, ctx.tenantId);

    const invoice = await createInvoiceDraft(tx, ledgerCtx(ctx), {
      customerId: customer.id,
      issueDate: record.issueDate,
      dueDate: record.dueDate,
      memo: memoFor(record),
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        incomeAccountId,
      })),
    });
    return { entityType: "invoice", entityId: invoice.id };
  },
};

export const billThreadDrafter: MailThreadDrafter = {
  kind: "bill",
  label: "Draft a bill",

  async draft(
    tx: Tx,
    ctx: EntityLinkCtx,
    thread: DraftableThread,
  ): Promise<DraftedRecord | null> {
    return draftFromThread(tx, ctx, "bill", thread);
  },

  async accept(
    tx: Tx,
    ctx: EntityLinkCtx,
    record: DraftedRecord,
  ): Promise<LinkableEntityRef> {
    const vendor = await resolveDraftParty(tx, ctx.tenantId, "bill", record.partyId);
    if (!vendor) {
      throw new LedgerError("VENDOR_NOT_FOUND", "pick the supplier this bill is from");
    }
    const lines = usableLines(record);
    if (lines.length === 0) {
      throw new LedgerError("BILL_EMPTY", "nothing to bill");
    }

    const bill = await createBillDraft(tx, ledgerCtx(ctx), {
      vendorId: vendor.id,
      billDate: record.issueDate,
      dueDate: record.dueDate,
      memo: memoFor(record),
      // A bill line is amount-only (P10) and UNCODED (P9) — quantity × price
      // collapses to one amount here, and the existing bill-coding AI puts an
      // account on it afterwards, which is a job it is already good at.
      lines: lines.map((l) => ({
        description: l.description,
        amountCents: lineAmountCents(
          parseQuantityHundredths(l.quantity)!,
          l.unitPriceCents,
        ),
        accountId: null,
      })),
    });
    return { entityType: "bill", entityId: bill.id };
  },
};

export const accountingThreadDrafters: readonly MailThreadDrafter[] = [
  invoiceThreadDrafter,
  billThreadDrafter,
];
