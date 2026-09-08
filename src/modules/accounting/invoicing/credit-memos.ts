import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CreditMemo, Invoice } from "@/db/schema";
import { LedgerError, postEntry, requireOwnerRole, type LedgerCtx } from "../core";
import { deriveStatus } from "./lines";
import { loadInvoice } from "./invoices";
import { paidCentsFor, unapplyPayment } from "./payments";
import { suggestCreditMemoNumber } from "./numbering";

/**
 * Credit memos — see the table's comment in `src/db/schema/invoicing.ts` for
 * the decision that shapes this file: a memo posts its own entry and settles
 * the invoice as a payment row does, so nothing that reads a balance had to
 * learn a new word.
 */

const OPEN_INVOICE_STATUSES = new Set(["issued", "partial"]);

async function findArAccount(tx: Tx, tenantId: string): Promise<string> {
  const ar = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.subtype, "accounts_receivable"),
      eq(schema.accounts.isSystem, true),
    ),
  });
  if (!ar) throw new LedgerError("ACCOUNT_NOT_FOUND", "Accounts Receivable missing");
  return ar.id;
}

export async function loadCreditMemo(
  tx: Tx,
  tenantId: string,
  creditMemoId: string,
): Promise<CreditMemo> {
  const memo = await tx.query.creditMemos.findFirst({
    where: and(
      eq(schema.creditMemos.tenantId, tenantId),
      eq(schema.creditMemos.id, creditMemoId),
    ),
  });
  if (!memo) throw new LedgerError("CREDIT_MEMO_NOT_FOUND", "credit memo missing");
  return memo;
}

/**
 * Issue a credit against an open invoice.
 *
 * The amount may not exceed what the invoice still owes — a credit larger
 * than the balance is a refund, which moves money and is a different thing.
 * The number is minted the way invoice numbers are: the unique index is the
 * race arbiter and a collision re-mints once.
 */
export async function issueCreditMemo(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    invoiceId: string;
    expectedVersion: number;
    amountCents: number;
    incomeAccountId: string;
    issueDate: string;
    memo?: string;
  },
): Promise<{ creditMemo: CreditMemo; invoice: Invoice }> {
  requireOwnerRole(ctx);
  const invoice = await loadInvoice(tx, ctx.tenantId, args.invoiceId);
  if (!OPEN_INVOICE_STATUSES.has(invoice.status)) {
    throw new LedgerError("INVOICE_NOT_OPEN", `invoice is ${invoice.status}`);
  }
  if (invoice.version !== args.expectedVersion) {
    throw new LedgerError("STALE_VERSION", "invoice changed since loaded");
  }
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    throw new LedgerError("CREDIT_MEMO_AMOUNT_INVALID", `amount ${args.amountCents}`);
  }
  const alreadyPaid = await paidCentsFor(tx, ctx.tenantId, invoice.id);
  const remaining = invoice.totalCents - alreadyPaid;
  if (args.amountCents > remaining) {
    throw new LedgerError("INVOICE_OVERPAYMENT", `remaining ${remaining}`, {
      remainingCents: remaining,
    });
  }
  const account = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, ctx.tenantId),
      eq(schema.accounts.id, args.incomeAccountId),
    ),
  });
  if (!account || !account.isActive || account.accountType !== "income") {
    throw new LedgerError("CREDIT_MEMO_ACCOUNT_INVALID", "not an active income account");
  }
  const arAccountId = await findArAccount(tx, ctx.tenantId);
  const reason = args.memo?.trim() ?? "";

  const creditMemoId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  // The reversal: what the invoice recognised, taken back, against the
  // receivable it raised. Posted in the invoice's company (ADR 0010).
  const { entry } = await postEntry(tx, ctx, {
    entityId: invoice.entityId,
    status: "posted",
    entryDate: args.issueDate,
    memo: `Credit memo — ${invoice.invoiceNumber}${reason ? ` · ${reason}` : ""}`,
    source: "credit_memo",
    sourceId: creditMemoId,
    idempotencyKey: `creditmemo:${creditMemoId}`,
    lines: [
      { accountId: args.incomeAccountId, amountCents: args.amountCents, memo: reason || undefined },
      { accountId: arAccountId, amountCents: -args.amountCents },
    ],
  });

  // The settlement row: the memo's entry settles the invoice by this much.
  // Its "deposit account" is the income account the credit came off, which
  // is what keeps it out of Undeposited Funds and the deposit buckets.
  const paymentMemo = (number: string) => `${number}${reason ? ` · ${reason}` : ""}`;
  let number = await suggestCreditMemoNumber(tx, ctx.tenantId);
  await tx.insert(schema.invoicePayments).values({
    id: paymentId,
    tenantId: ctx.tenantId,
    invoiceId: invoice.id,
    paymentDate: args.issueDate,
    amountCents: args.amountCents,
    depositAccountId: args.incomeAccountId,
    method: "credit_memo",
    memo: paymentMemo(number),
    journalEntryId: entry.id,
    createdByClerkUserId: ctx.userId,
  });

  const values = (n: string) => ({
    id: creditMemoId,
    tenantId: ctx.tenantId,
    entityId: invoice.entityId,
    customerId: invoice.customerId,
    invoiceId: invoice.id,
    paymentId,
    number: n,
    issueDate: args.issueDate,
    memo: reason,
    incomeAccountId: args.incomeAccountId,
    totalCents: args.amountCents,
    status: "issued",
    journalEntryId: entry.id,
    createdByClerkUserId: ctx.userId,
  });
  let [creditMemo] = await tx
    .insert(schema.creditMemos)
    .values(values(number))
    .onConflictDoNothing()
    .returning();
  if (!creditMemo) {
    // Somebody minted the same number a moment ago: take the next one, and
    // keep the settlement row's memo in step.
    number = await suggestCreditMemoNumber(tx, ctx.tenantId);
    await tx
      .update(schema.invoicePayments)
      .set({ memo: paymentMemo(number) })
      .where(
        and(
          eq(schema.invoicePayments.tenantId, ctx.tenantId),
          eq(schema.invoicePayments.id, paymentId),
        ),
      );
    [creditMemo] = await tx
      .insert(schema.creditMemos)
      .values(values(number))
      .onConflictDoNothing()
      .returning();
  }
  if (!creditMemo) {
    throw new LedgerError("INVOICE_NUMBER_TAKEN", `credit memo number ${number} taken`);
  }

  const status = deriveStatus(invoice.totalCents, alreadyPaid + args.amountCents);
  const rows = await tx
    .update(schema.invoices)
    .set({ status, version: args.expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        eq(schema.invoices.id, invoice.id),
        eq(schema.invoices.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "invoice changed since loaded");
  }
  return { creditMemo, invoice: rows[0] };
}

/**
 * Void a credit memo: its entry is voided (the mutability tiers apply), its
 * settlement row is removed and the invoice's status re-derived — all of
 * which `unapplyPayment` already does for a payment, so it does it here too,
 * told that the caller is the memo. The memo is detached from the row first,
 * because its FK would otherwise refuse the delete.
 */
export async function voidCreditMemo(
  tx: Tx,
  ctx: LedgerCtx,
  args: { creditMemoId: string; expectedVersion: number },
): Promise<{ creditMemo: CreditMemo; invoice: Invoice | null; voidedEntryId: string }> {
  requireOwnerRole(ctx);
  const memo = await loadCreditMemo(tx, ctx.tenantId, args.creditMemoId);
  if (memo.version !== args.expectedVersion) {
    throw new LedgerError("STALE_VERSION", "credit memo changed since loaded");
  }
  if (memo.status !== "issued") {
    throw new LedgerError("CREDIT_MEMO_NOT_ISSUED", `credit memo is ${memo.status}`);
  }
  const rows = await tx
    .update(schema.creditMemos)
    .set({ status: "void", paymentId: null, version: memo.version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.creditMemos.tenantId, ctx.tenantId),
        eq(schema.creditMemos.id, memo.id),
        eq(schema.creditMemos.version, memo.version),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "credit memo changed since loaded");
  }
  let invoice: Invoice | null = null;
  if (memo.paymentId) {
    const payment = await tx.query.invoicePayments.findFirst({
      where: and(
        eq(schema.invoicePayments.tenantId, ctx.tenantId),
        eq(schema.invoicePayments.id, memo.paymentId),
      ),
    });
    if (payment) {
      const undone = await unapplyPayment(
        tx,
        ctx,
        { paymentId: payment.id, expectedVersion: payment.version },
        { viaCreditMemo: true },
      );
      invoice = undone.invoice;
    }
  }
  return { creditMemo: rows[0], invoice, voidedEntryId: memo.journalEntryId };
}
