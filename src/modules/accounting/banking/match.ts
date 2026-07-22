import "server-only";
import { and, eq, gte, inArray, lte, ne, notExists, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";
import { addDaysIso } from "../lib/dates";
import { loadBankAccount } from "./accounts";

/**
 * Bank-feed matching — closes the double-count trap. A recorded invoice
 * payment (or quick-add) posts to the bank ledger; when the same deposit
 * arrives in the feed, MATCH links the staged row to the EXISTING entry
 * instead of posting again.
 *
 * Invariant (P12): a bank transaction is satisfied by exactly one posted
 * entry — newly posted (categorize) or existing (match). DB backstop:
 * the UNIQUE partial index on bank_transactions(tenant_id,
 * journal_entry_id).
 */

const MATCH_WINDOW_DAYS = 7;

export interface MatchCandidate {
  entryId: string;
  entryDate: string;
  memo: string;
  source: string;
  label: string;
}

/**
 * Candidates for ONE unreviewed transaction: posted entries (source ≠
 * bank_import) whose lines on the register's ledger account sum to
 * exactly the transaction amount, dated within ±7 days, not already
 * linked from any bank transaction. Sign alignment: an inflow posts a
 * debit on the register account, so the ledger sum equals the signed
 * amount directly.
 */
export async function findMatchCandidates(
  tx: Tx,
  tenantId: string,
  args: { ledgerAccountId: string; amountCents: number; txnDate: string },
): Promise<MatchCandidate[]> {
  const je = schema.journalEntries;
  const jl = schema.journalLines;
  const bt = schema.bankTransactions;

  const rows = await tx
    .select({
      entryId: je.id,
      entryDate: je.entryDate,
      memo: je.memo,
      source: je.source,
      sourceId: je.sourceId,
    })
    .from(je)
    .innerJoin(jl, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
    .where(
      and(
        eq(je.tenantId, tenantId),
        eq(je.status, "posted"),
        ne(je.source, "bank_import"),
        eq(jl.accountId, args.ledgerAccountId),
        gte(je.entryDate, addDaysIso(args.txnDate, -MATCH_WINDOW_DAYS)),
        lte(je.entryDate, addDaysIso(args.txnDate, MATCH_WINDOW_DAYS)),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(bt)
            .where(and(eq(bt.tenantId, je.tenantId), eq(bt.journalEntryId, je.id))),
        ),
      ),
    )
    .groupBy(je.id, je.entryDate, je.memo, je.source, je.sourceId)
    .having(sql`sum(${jl.amountCents}) = ${args.amountCents}`)
    .orderBy(sql`abs(${je.entryDate} - ${args.txnDate}::date)`, je.createdAt)
    .limit(5);

  // Label invoice payments "Payment — INV-0003 · Customer".
  const paymentIds = rows
    .filter((r) => r.source === "invoice_payment" && r.sourceId)
    .map((r) => r.sourceId!);
  const labels = new Map<string, string>();
  if (paymentIds.length > 0) {
    const payments = await tx
      .select({
        paymentId: schema.invoicePayments.id,
        invoiceNumber: schema.invoices.invoiceNumber,
        customerName: schema.customers.name,
      })
      .from(schema.invoicePayments)
      .innerJoin(
        schema.invoices,
        and(
          eq(schema.invoices.tenantId, schema.invoicePayments.tenantId),
          eq(schema.invoices.id, schema.invoicePayments.invoiceId),
        ),
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
          eq(schema.invoicePayments.tenantId, tenantId),
          sql`${schema.invoicePayments.id} in ${paymentIds}`,
        ),
      );
    for (const p of payments) {
      labels.set(p.paymentId, `Payment — ${p.invoiceNumber} · ${p.customerName}`);
    }
  }

  return rows.map((r) => ({
    entryId: r.entryId,
    entryDate: r.entryDate,
    memo: r.memo,
    source: r.source,
    label:
      (r.sourceId && labels.get(r.sourceId)) ||
      r.memo ||
      r.source.replaceAll("_", " "),
  }));
}

/**
 * Batch variant for the register page: ONE window query for all displayed
 * unreviewed transactions, amounts matched in JS. Returns txnId → candidates.
 */
export async function findMatchCandidatesBatch(
  tx: Tx,
  tenantId: string,
  args: {
    ledgerAccountId: string;
    txns: Array<{ id: string; amountCents: number; txnDate: string }>;
  },
): Promise<Map<string, MatchCandidate[]>> {
  const out = new Map<string, MatchCandidate[]>();
  if (args.txns.length === 0) return out;
  const dates = args.txns.map((t) => t.txnDate).sort();
  const from = addDaysIso(dates[0], -MATCH_WINDOW_DAYS);
  const to = addDaysIso(dates[dates.length - 1], MATCH_WINDOW_DAYS);

  const je = schema.journalEntries;
  const jl = schema.journalLines;
  const bt = schema.bankTransactions;
  const entries = await tx
    .select({
      entryId: je.id,
      entryDate: je.entryDate,
      memo: je.memo,
      source: je.source,
      sourceId: je.sourceId,
      sum: sql<string>`sum(${jl.amountCents})`,
    })
    .from(je)
    .innerJoin(jl, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
    .where(
      and(
        eq(je.tenantId, tenantId),
        eq(je.status, "posted"),
        ne(je.source, "bank_import"),
        eq(jl.accountId, args.ledgerAccountId),
        gte(je.entryDate, from),
        lte(je.entryDate, to),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(bt)
            .where(and(eq(bt.tenantId, je.tenantId), eq(bt.journalEntryId, je.id))),
        ),
      ),
    )
    .groupBy(je.id, je.entryDate, je.memo, je.source, je.sourceId);

  const paymentIds = entries
    .filter((e) => e.source === "invoice_payment" && e.sourceId)
    .map((e) => e.sourceId!);
  const labels = new Map<string, string>();
  if (paymentIds.length > 0) {
    const payments = await tx
      .select({
        paymentId: schema.invoicePayments.id,
        invoiceNumber: schema.invoices.invoiceNumber,
        customerName: schema.customers.name,
      })
      .from(schema.invoicePayments)
      .innerJoin(
        schema.invoices,
        and(
          eq(schema.invoices.tenantId, schema.invoicePayments.tenantId),
          eq(schema.invoices.id, schema.invoicePayments.invoiceId),
        ),
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
          eq(schema.invoicePayments.tenantId, tenantId),
          inArray(schema.invoicePayments.id, paymentIds),
        ),
      );
    for (const p of payments) {
      labels.set(p.paymentId, `Payment — ${p.invoiceNumber} · ${p.customerName}`);
    }
  }

  const daysApart = (a: string, b: string) => {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    return Math.abs(
      Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000),
    );
  };

  for (const txn of args.txns) {
    const candidates = entries
      .filter(
        (e) =>
          Number(e.sum) === txn.amountCents &&
          daysApart(e.entryDate, txn.txnDate) <= MATCH_WINDOW_DAYS,
      )
      .sort((a, b) => daysApart(a.entryDate, txn.txnDate) - daysApart(b.entryDate, txn.txnDate))
      .slice(0, 5)
      .map((e) => ({
        entryId: e.entryId,
        entryDate: e.entryDate,
        memo: e.memo,
        source: e.source,
        label:
          (e.sourceId && labels.get(e.sourceId)) ||
          e.memo ||
          e.source.replaceAll("_", " "),
      }));
    if (candidates.length > 0) out.set(txn.id, candidates);
  }
  return out;
}

/** Link a staged transaction to an existing posted entry. Posts NOTHING. */
export async function matchTransactionToEntry(
  tx: Tx,
  ctx: LedgerCtx,
  args: { transactionId: string; journalEntryId: string },
): Promise<void> {
  requireOwnerRole(ctx);
  const txn = await tx.query.bankTransactions.findFirst({
    where: and(
      eq(schema.bankTransactions.tenantId, ctx.tenantId),
      eq(schema.bankTransactions.id, args.transactionId),
    ),
  });
  if (!txn || txn.status !== "unreviewed") {
    throw new LedgerError("TXN_NOT_UNREVIEWED", "transaction not reviewable");
  }
  const bankAccount = await loadBankAccount(tx, ctx.tenantId, txn.bankAccountId);
  const candidates = await findMatchCandidates(tx, ctx.tenantId, {
    ledgerAccountId: bankAccount.accountId,
    amountCents: txn.amountCents,
    txnDate: txn.txnDate,
  });
  if (!candidates.some((c) => c.entryId === args.journalEntryId)) {
    throw new LedgerError("TXN_MATCH_INVALID", "entry is not a valid candidate");
  }
  const updated = await tx
    .update(schema.bankTransactions)
    .set({
      status: "posted",
      journalEntryId: args.journalEntryId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.bankTransactions.tenantId, ctx.tenantId),
        eq(schema.bankTransactions.id, txn.id),
        eq(schema.bankTransactions.status, "unreviewed"),
      ),
    )
    .returning({ id: schema.bankTransactions.id });
  if (updated.length === 0) {
    throw new LedgerError("TXN_NOT_UNREVIEWED", "transaction changed concurrently");
  }
}

/**
 * Unmatch: clear the link, txn back to review; the entry STAYS posted
 * (P14). Blocked for bank_import entries — those un-do by voiding the
 * entry (the existing flow).
 */
export async function unmatchTransaction(
  tx: Tx,
  ctx: LedgerCtx,
  args: { transactionId: string },
): Promise<void> {
  requireOwnerRole(ctx);
  const txn = await tx.query.bankTransactions.findFirst({
    where: and(
      eq(schema.bankTransactions.tenantId, ctx.tenantId),
      eq(schema.bankTransactions.id, args.transactionId),
    ),
  });
  if (!txn || txn.status !== "posted" || !txn.journalEntryId) {
    throw new LedgerError("TXN_MATCH_INVALID", "transaction is not matched");
  }
  const entry = await tx.query.journalEntries.findFirst({
    where: and(
      eq(schema.journalEntries.tenantId, ctx.tenantId),
      eq(schema.journalEntries.id, txn.journalEntryId),
    ),
  });
  if (entry?.source === "bank_import") {
    throw new LedgerError(
      "TXN_MATCH_INVALID",
      "bank-import entries are undone by voiding the entry",
    );
  }
  await tx
    .update(schema.bankTransactions)
    .set({ status: "unreviewed", journalEntryId: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.bankTransactions.tenantId, ctx.tenantId),
        eq(schema.bankTransactions.id, txn.id),
      ),
    );
}

/**
 * P13: voiding ANY entry linked from a bank transaction sends that
 * transaction back to review — called from voidPostedEntry and
 * unapplyPayment. No-op when nothing links to the entry.
 */
export async function resetBankLinkForEntry(
  tx: Tx,
  tenantId: string,
  entryId: string,
): Promise<void> {
  await tx
    .update(schema.bankTransactions)
    .set({ status: "unreviewed", journalEntryId: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.bankTransactions.tenantId, tenantId),
        eq(schema.bankTransactions.journalEntryId, entryId),
      ),
    );
}
