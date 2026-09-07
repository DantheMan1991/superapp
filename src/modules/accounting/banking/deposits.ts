import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Deposit } from "@/db/schema";
import {
  LedgerError,
  postEntry,
  requireOwnerRole,
  voidEntry,
  type LedgerCtx,
} from "../core";

/**
 * Bank deposits: the payments a business recorded into Undeposited Funds,
 * banked together as one entry (Dr the register / Cr Undeposited Funds).
 *
 * WHY THIS EXISTS. A payment recorded "to Undeposited Funds" is a cheque in
 * the drawer. When three of them go to the bank on Friday the statement
 * shows ONE line for their sum, and until now nothing in the books did: the
 * three Dr 1250 postings sat there forever, the `Not deposited` tile counted
 * them forever, and the feed row for the deposit had nothing to match. This
 * is the slip the teller stamps: a row that names the payments it took, the
 * entry that moves their sum into the register, and the feed row matches the
 * entry the way it matches a payment.
 *
 * A deposit is immutable once posted. The correction is a void, which voids
 * the entry (the mutability tiers apply — a reconciled deposit blocks with
 * ENTRY_IMMUTABLE) and sends every payment back to waiting. The journal
 * refuses to void the entry directly (`deposit` is in MANAGED_SOURCES).
 */

export interface UndepositedPayment {
  id: string;
  paymentDate: string;
  amountCents: number;
  method: string;
  memo: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  /** The invoice's company — the only company's register this can go into. */
  entityId: string;
  /** The Undeposited Funds account the payment was recorded into. */
  accountId: string;
}

/**
 * Every payment recorded into Undeposited Funds that no deposit has banked
 * yet, oldest first — the order they went into the drawer. `undeposited_funds`
 * is read as a SUBTYPE rather than an account id, as the invoice list does:
 * a tenant may have renumbered 1250.
 */
export async function listUndepositedPayments(
  tx: Tx,
  tenantId: string,
  opts: { entityId?: string } = {},
): Promise<UndepositedPayment[]> {
  const p = schema.invoicePayments;
  const rows = await tx
    .select({
      id: p.id,
      paymentDate: p.paymentDate,
      amountCents: p.amountCents,
      method: p.method,
      memo: p.memo,
      invoiceId: p.invoiceId,
      invoiceNumber: schema.invoices.invoiceNumber,
      customerName: schema.customers.name,
      entityId: schema.invoices.entityId,
      accountId: p.depositAccountId,
    })
    .from(p)
    .innerJoin(
      schema.accounts,
      and(
        eq(schema.accounts.tenantId, p.tenantId),
        eq(schema.accounts.id, p.depositAccountId),
      ),
    )
    .innerJoin(
      schema.invoices,
      and(eq(schema.invoices.tenantId, p.tenantId), eq(schema.invoices.id, p.invoiceId)),
    )
    .innerJoin(
      schema.customers,
      and(
        eq(schema.customers.tenantId, schema.invoices.tenantId),
        eq(schema.customers.id, schema.invoices.customerId),
      ),
    )
    .where(
      and(
        eq(p.tenantId, tenantId),
        eq(schema.accounts.subtype, "undeposited_funds"),
        isNull(p.depositId),
        opts.entityId ? eq(schema.invoices.entityId, opts.entityId) : undefined,
      ),
    )
    .orderBy(asc(p.paymentDate), asc(p.createdAt));
  return rows;
}

/** The memo an owner gets when they leave the box empty. */
export function depositMemo(payments: ReadonlyArray<{ customerName: string }>): string {
  if (payments.length === 1) return `Deposit — ${payments[0].customerName}`;
  return `Deposit — ${payments.length} payments`;
}

export async function loadDeposit(
  tx: Tx,
  tenantId: string,
  depositId: string,
): Promise<Deposit> {
  const deposit = await tx.query.deposits.findFirst({
    where: and(eq(schema.deposits.tenantId, tenantId), eq(schema.deposits.id, depositId)),
  });
  if (!deposit) throw new LedgerError("DEPOSIT_NOT_FOUND", "deposit missing");
  return deposit;
}

/**
 * Bank a set of undeposited payments into one register as one entry.
 *
 * Everything is checked against the CURRENT rows, not the list the screen
 * was drawn from: a payment somebody else deposited a minute ago, or
 * unapplied, is refused with DEPOSIT_PAYMENT_UNAVAILABLE rather than banked
 * twice. The final UPDATE is the race guard — it claims only rows still
 * waiting, and a claim that comes up short rolls the whole deposit back.
 */
export async function recordDeposit(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    bankAccountId: string;
    depositDate: string;
    memo?: string;
    paymentIds: string[];
  },
): Promise<{ deposit: Deposit; entryId: string }> {
  requireOwnerRole(ctx);
  const ids = [...new Set(args.paymentIds)];
  if (ids.length === 0) throw new LedgerError("DEPOSIT_EMPTY", "no payments picked");

  const register = await tx.query.bankAccounts.findFirst({
    where: and(
      eq(schema.bankAccounts.tenantId, ctx.tenantId),
      eq(schema.bankAccounts.id, args.bankAccountId),
    ),
  });
  if (!register) throw new LedgerError("BANK_ACCOUNT_NOT_FOUND", "register missing");
  if (!register.isActive) {
    throw new LedgerError("BANK_ACCOUNT_INACTIVE", "register is closed");
  }

  const waiting = await listUndepositedPayments(tx, ctx.tenantId);
  const byId = new Map(waiting.map((p) => [p.id, p]));
  const picked = ids.map((id) => byId.get(id));
  if (picked.some((p) => !p)) {
    throw new LedgerError(
      "DEPOSIT_PAYMENT_UNAVAILABLE",
      "a payment is missing, already deposited, or not in Undeposited Funds",
    );
  }
  const payments = picked as UndepositedPayment[];
  // ONE COMPANY PER DEPOSIT — see the table's comment. The register decides
  // which company the entry posts in, so every payment must be that
  // company's; the screen only offers that company's payments, and this is
  // the check that makes the screen's rule the ledger's.
  if (payments.some((p) => p.entityId !== register.entityId)) {
    throw new LedgerError("DEPOSIT_CROSS_COMPANY", "payment of another company");
  }

  const total = payments.reduce((s, p) => s + p.amountCents, 0);
  // One credit per Undeposited Funds account the payments sit in. There is
  // one such account in every chart this code has met; the loop costs
  // nothing and keeps the entry balanced if a tenant ever has two.
  const creditByAccount = new Map<string, number>();
  for (const p of payments) {
    creditByAccount.set(p.accountId, (creditByAccount.get(p.accountId) ?? 0) + p.amountCents);
  }

  const depositId = crypto.randomUUID();
  const memo = args.memo?.trim() || depositMemo(payments);
  const { entry } = await postEntry(tx, ctx, {
    entityId: register.entityId,
    status: "posted",
    entryDate: args.depositDate,
    memo,
    source: "deposit",
    sourceId: depositId,
    idempotencyKey: `deposit:${depositId}`,
    lines: [
      { accountId: register.accountId, amountCents: total },
      ...[...creditByAccount].map(([accountId, cents]) => ({
        accountId,
        amountCents: -cents,
      })),
    ],
  });

  const [deposit] = await tx
    .insert(schema.deposits)
    .values({
      id: depositId,
      tenantId: ctx.tenantId,
      entityId: register.entityId,
      bankAccountId: register.id,
      depositDate: args.depositDate,
      memo,
      totalCents: total,
      status: "posted",
      journalEntryId: entry.id,
      createdByClerkUserId: ctx.userId,
    })
    .returning();

  const claimed = await tx
    .update(schema.invoicePayments)
    .set({ depositId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.invoicePayments.tenantId, ctx.tenantId),
        inArray(schema.invoicePayments.id, ids),
        isNull(schema.invoicePayments.depositId),
      ),
    )
    .returning({ id: schema.invoicePayments.id });
  if (claimed.length !== ids.length) {
    throw new LedgerError(
      "DEPOSIT_PAYMENT_UNAVAILABLE",
      "a payment was deposited by somebody else meanwhile",
    );
  }
  return { deposit, entryId: entry.id };
}

/**
 * Void a deposit: void its entry (a reconciled one blocks with
 * ENTRY_IMMUTABLE, and the deposit stays), send its payments back to
 * waiting, mark the row void. The caller's action also resets any bank-feed
 * link on the entry (P13), as every void does.
 */
export async function voidDeposit(
  tx: Tx,
  ctx: LedgerCtx,
  args: { depositId: string; expectedVersion: number },
): Promise<{ deposit: Deposit; voidedEntryId: string }> {
  requireOwnerRole(ctx);
  const deposit = await loadDeposit(tx, ctx.tenantId, args.depositId);
  if (deposit.version !== args.expectedVersion) {
    throw new LedgerError("STALE_VERSION", "deposit changed since loaded");
  }
  if (deposit.status !== "posted") {
    throw new LedgerError("DEPOSIT_NOT_POSTED", `deposit is ${deposit.status}`);
  }
  const entry = await tx.query.journalEntries.findFirst({
    where: and(
      eq(schema.journalEntries.tenantId, ctx.tenantId),
      eq(schema.journalEntries.id, deposit.journalEntryId),
    ),
  });
  if (entry && entry.status === "posted") {
    await voidEntry(tx, ctx, { entryId: entry.id, expectedVersion: entry.version });
  }
  await tx
    .update(schema.invoicePayments)
    .set({ depositId: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.invoicePayments.tenantId, ctx.tenantId),
        eq(schema.invoicePayments.depositId, deposit.id),
      ),
    );
  const rows = await tx
    .update(schema.deposits)
    .set({ status: "void", version: deposit.version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.deposits.tenantId, ctx.tenantId),
        eq(schema.deposits.id, deposit.id),
        eq(schema.deposits.version, deposit.version),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "deposit changed since loaded");
  }
  return { deposit: rows[0], voidedEntryId: deposit.journalEntryId };
}
