import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Invoice, InvoicePayment } from "@/db/schema";
import {
  LedgerError,
  postEntry,
  requireOwnerRole,
  voidEntry,
  type LedgerCtx,
} from "../core";
import { toSafeCents } from "../lib/money";
import { deriveStatus } from "./lines";
import { loadInvoice } from "./invoices";

/**
 * Payments are immutable rows created atomically with their entry
 * (Dr deposit / Cr AR). Invoice partial/paid status is DERIVED here in
 * the same tx; the invoice-version CAS serializes concurrent payments,
 * which doubles as the overpayment race guard.
 */

export async function paidCentsFor(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
): Promise<number> {
  const [row] = await tx
    .select({ paid: sql<string>`coalesce(sum(${schema.invoicePayments.amountCents}), 0)` })
    .from(schema.invoicePayments)
    .where(
      and(
        eq(schema.invoicePayments.tenantId, tenantId),
        eq(schema.invoicePayments.invoiceId, invoiceId),
      ),
    );
  return toSafeCents(row?.paid ?? 0);
}

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

async function assertDepositAccount(
  tx: Tx,
  tenantId: string,
  accountId: string,
): Promise<void> {
  const account = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.id, accountId),
    ),
  });
  if (!account || !account.isActive) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", "deposit account invalid");
  }
  const allowed =
    account.subtype === "undeposited_funds" ||
    (await tx.query.bankAccounts.findFirst({
      where: and(
        eq(schema.bankAccounts.tenantId, tenantId),
        eq(schema.bankAccounts.accountId, accountId),
      ),
    })) !== undefined;
  if (!allowed) {
    throw new LedgerError(
      "ACCOUNT_NOT_FOUND",
      "deposit target must be a bank register or Undeposited Funds",
    );
  }
}

export async function recordPayment(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    invoiceId: string;
    expectedVersion: number;
    paymentDate: string;
    amountCents: number;
    depositAccountId: string;
    method: string;
    memo?: string;
  },
): Promise<{ payment: InvoicePayment; invoice: Invoice }> {
  requireOwnerRole(ctx);
  const invoice = await loadInvoice(tx, ctx.tenantId, args.invoiceId);
  if (!["issued", "partial"].includes(invoice.status)) {
    throw new LedgerError("INVOICE_NOT_OPEN", `invoice is ${invoice.status}`);
  }
  await assertDepositAccount(tx, ctx.tenantId, args.depositAccountId);
  const alreadyPaid = await paidCentsFor(tx, ctx.tenantId, invoice.id);
  const remaining = invoice.totalCents - alreadyPaid;
  if (args.amountCents > remaining) {
    throw new LedgerError("INVOICE_OVERPAYMENT", `remaining ${remaining}`, {
      remainingCents: remaining,
    });
  }
  const arAccountId = await findArAccount(tx, ctx.tenantId);

  // Pre-generate the payment id so the entry can reference it as sourceId
  // and the payment row is born with its real entry id — no placeholder,
  // no FK gymnastics. Both inserts share this transaction.
  const paymentId = crypto.randomUUID();
  const { entry } = await postEntry(tx, ctx, {
    status: "posted",
    entryDate: args.paymentDate,
    memo: `Payment — ${invoice.invoiceNumber}`,
    source: "invoice_payment",
    sourceId: paymentId,
    idempotencyKey: `invpay:${paymentId}`,
    lines: [
      { accountId: args.depositAccountId, amountCents: args.amountCents },
      { accountId: arAccountId, amountCents: -args.amountCents },
    ],
  });
  const [linkedPayment] = await tx
    .insert(schema.invoicePayments)
    .values({
      id: paymentId,
      tenantId: ctx.tenantId,
      invoiceId: invoice.id,
      paymentDate: args.paymentDate,
      amountCents: args.amountCents,
      depositAccountId: args.depositAccountId,
      method: args.method,
      memo: args.memo ?? "",
      journalEntryId: entry.id,
      createdByClerkUserId: ctx.userId,
    })
    .returning();

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
  return { payment: linkedPayment, invoice: rows[0] };
}

/**
 * Unapply: void the payment entry (mutability tiers apply — a reconciled
 * deposit line blocks with ENTRY_IMMUTABLE), delete the row, re-derive
 * status. The caller's action also resets any bank-feed link (P13).
 */
export async function unapplyPayment(
  tx: Tx,
  ctx: LedgerCtx,
  args: { paymentId: string; expectedVersion: number },
): Promise<{ payment: InvoicePayment; invoice: Invoice; voidedEntryId: string }> {
  requireOwnerRole(ctx);
  const payment = await tx.query.invoicePayments.findFirst({
    where: and(
      eq(schema.invoicePayments.tenantId, ctx.tenantId),
      eq(schema.invoicePayments.id, args.paymentId),
    ),
  });
  if (!payment) throw new LedgerError("PAYMENT_NOT_FOUND", "payment missing");
  if (payment.version !== args.expectedVersion) {
    throw new LedgerError("STALE_VERSION", "payment changed since loaded");
  }
  const invoice = await loadInvoice(tx, ctx.tenantId, payment.invoiceId);

  const entry = await tx.query.journalEntries.findFirst({
    where: and(
      eq(schema.journalEntries.tenantId, ctx.tenantId),
      eq(schema.journalEntries.id, payment.journalEntryId),
    ),
  });
  if (entry && entry.status === "posted") {
    await voidEntry(tx, ctx, { entryId: entry.id, expectedVersion: entry.version });
  }
  await tx
    .delete(schema.invoicePayments)
    .where(
      and(
        eq(schema.invoicePayments.tenantId, ctx.tenantId),
        eq(schema.invoicePayments.id, payment.id),
      ),
    );

  const paidNow = await paidCentsFor(tx, ctx.tenantId, invoice.id);
  const status = deriveStatus(invoice.totalCents, paidNow);
  const rows = await tx
    .update(schema.invoices)
    .set({ status, updatedAt: new Date(), version: invoice.version + 1 })
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        eq(schema.invoices.id, invoice.id),
        eq(schema.invoices.version, invoice.version),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "invoice changed since loaded");
  }
  return { payment, invoice: rows[0], voidedEntryId: payment.journalEntryId };
}
