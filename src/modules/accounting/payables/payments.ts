import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Bill, BillPayment } from "@/db/schema";
import {
  LedgerError,
  postEntry,
  requireOwnerRole,
  voidEntry,
  type LedgerCtx,
} from "../core";
import { toSafeCents } from "../lib/money";
import { deriveBillStatus } from "./lines";
import { findApAccount, loadBill } from "./bills";
import { loadVendor } from "./vendors";

/**
 * Bill payments are immutable rows created atomically with their entry
 * (Dr AP / Cr paid-from). Bill partial/paid status is DERIVED here in
 * the same tx; the bill-version CAS serializes concurrent payments,
 * which doubles as the overpayment race guard. Record-keeping only —
 * nothing here moves money (P24).
 */

export async function paidCentsFor(
  tx: Tx,
  tenantId: string,
  billId: string,
): Promise<number> {
  const [row] = await tx
    .select({ paid: sql<string>`coalesce(sum(${schema.billPayments.amountCents}), 0)` })
    .from(schema.billPayments)
    .where(
      and(
        eq(schema.billPayments.tenantId, tenantId),
        eq(schema.billPayments.billId, billId),
      ),
    );
  return toSafeCents(row?.paid ?? 0);
}

/** Paid-from must be a bank-register ledger account, any kind (P11). */
async function assertPaidFromAccount(
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
    throw new LedgerError("ACCOUNT_NOT_FOUND", "paid-from account invalid");
  }
  const register = await tx.query.bankAccounts.findFirst({
    where: and(
      eq(schema.bankAccounts.tenantId, tenantId),
      eq(schema.bankAccounts.accountId, accountId),
    ),
  });
  if (!register) {
    throw new LedgerError(
      "ACCOUNT_NOT_FOUND",
      "paid-from must be a bank or credit-card register",
    );
  }
}

export async function recordBillPayment(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    billId: string;
    expectedVersion: number;
    paymentDate: string;
    amountCents: number;
    paidFromAccountId: string;
    method: string;
    memo?: string;
  },
): Promise<{ payment: BillPayment; bill: Bill }> {
  requireOwnerRole(ctx);
  const bill = await loadBill(tx, ctx.tenantId, args.billId);
  if (!["approved", "partial"].includes(bill.status)) {
    throw new LedgerError("BILL_NOT_OPEN", `bill is ${bill.status}`);
  }
  await assertPaidFromAccount(tx, ctx.tenantId, args.paidFromAccountId);
  const alreadyPaid = await paidCentsFor(tx, ctx.tenantId, bill.id);
  const remaining = bill.totalCents - alreadyPaid;
  if (args.amountCents > remaining) {
    throw new LedgerError("BILL_OVERPAYMENT", `remaining ${remaining}`, {
      remainingCents: remaining,
    });
  }
  const apAccountId = await findApAccount(tx, ctx.tenantId);
  const vendor = await loadVendor(tx, ctx.tenantId, bill.vendorId);

  // Pre-generate the payment id so the entry can reference it as sourceId
  // and the payment row is born with its real entry id (invoicing mirror).
  const paymentId = crypto.randomUUID();
  const { entry } = await postEntry(tx, ctx, {
    status: "posted",
    entryDate: args.paymentDate,
    memo: `Bill payment — ${vendor.name}${bill.billNumber ? ` ${bill.billNumber}` : ""}`,
    source: "bill_payment",
    sourceId: paymentId,
    idempotencyKey: `billpay:${paymentId}`,
    lines: [
      { accountId: apAccountId, amountCents: args.amountCents },
      { accountId: args.paidFromAccountId, amountCents: -args.amountCents },
    ],
  });
  const [payment] = await tx
    .insert(schema.billPayments)
    .values({
      id: paymentId,
      tenantId: ctx.tenantId,
      billId: bill.id,
      paymentDate: args.paymentDate,
      amountCents: args.amountCents,
      paidFromAccountId: args.paidFromAccountId,
      method: args.method,
      memo: args.memo ?? "",
      journalEntryId: entry.id,
      createdByClerkUserId: ctx.userId,
    })
    .returning();

  const status = deriveBillStatus(bill.totalCents, alreadyPaid + args.amountCents);
  const rows = await tx
    .update(schema.bills)
    .set({ status, version: args.expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.bills.tenantId, ctx.tenantId),
        eq(schema.bills.id, bill.id),
        eq(schema.bills.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "bill changed since loaded");
  }
  return { payment, bill: rows[0] };
}

/**
 * Unapply: void the payment entry (mutability tiers apply — a reconciled
 * register line blocks with ENTRY_IMMUTABLE), delete the row, re-derive
 * status. The caller's action also resets any bank-feed link (P13).
 */
export async function unapplyBillPayment(
  tx: Tx,
  ctx: LedgerCtx,
  args: { paymentId: string; expectedVersion: number },
): Promise<{ payment: BillPayment; bill: Bill; voidedEntryId: string }> {
  requireOwnerRole(ctx);
  const payment = await tx.query.billPayments.findFirst({
    where: and(
      eq(schema.billPayments.tenantId, ctx.tenantId),
      eq(schema.billPayments.id, args.paymentId),
    ),
  });
  if (!payment) throw new LedgerError("BILL_PAYMENT_NOT_FOUND", "payment missing");
  if (payment.version !== args.expectedVersion) {
    throw new LedgerError("STALE_VERSION", "payment changed since loaded");
  }
  const bill = await loadBill(tx, ctx.tenantId, payment.billId);

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
    .delete(schema.billPayments)
    .where(
      and(
        eq(schema.billPayments.tenantId, ctx.tenantId),
        eq(schema.billPayments.id, payment.id),
      ),
    );

  const paidNow = await paidCentsFor(tx, ctx.tenantId, bill.id);
  const status = deriveBillStatus(bill.totalCents, paidNow);
  const rows = await tx
    .update(schema.bills)
    .set({ status, updatedAt: new Date(), version: bill.version + 1 })
    .where(
      and(
        eq(schema.bills.tenantId, ctx.tenantId),
        eq(schema.bills.id, bill.id),
        eq(schema.bills.version, bill.version),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "bill changed since loaded");
  }
  return { payment, bill: rows[0], voidedEntryId: payment.journalEntryId };
}
