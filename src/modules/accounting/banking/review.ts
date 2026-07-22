import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { BankTransaction, JournalEntry } from "@/db/schema";
import {
  LedgerError,
  postEntry,
  requireOwnerRole,
  type LedgerCtx,
} from "../core";
import { loadBankAccount } from "./accounts";

/** Shape of the ai_suggestion jsonb on bank_transactions. */
export interface StoredAiSuggestion {
  accountId: string;
  accountCode: string;
  confidence: number;
  reason?: string;
  model: string;
  at: string;
}

export function readAiSuggestion(txn: BankTransaction): StoredAiSuggestion | null {
  const s = txn.aiSuggestion as StoredAiSuggestion | null;
  return s && typeof s.accountId === "string" ? s : null;
}

async function loadUnreviewedTxn(
  tx: Tx,
  tenantId: string,
  transactionId: string,
): Promise<BankTransaction> {
  const txn = await tx.query.bankTransactions.findFirst({
    where: and(
      eq(schema.bankTransactions.tenantId, tenantId),
      eq(schema.bankTransactions.id, transactionId),
    ),
  });
  if (!txn) throw new LedgerError("TXN_NOT_UNREVIEWED", "transaction missing");
  if (txn.status !== "unreviewed") {
    throw new LedgerError("TXN_NOT_UNREVIEWED", `transaction is ${txn.status}`);
  }
  return txn;
}

/**
 * Categorize one staged transaction: post the 2-line entry through the
 * core engine (idempotent per txn) and link the staging row — one
 * transaction, race-guarded by the conditional status update.
 */
export async function categorizeTransaction(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    transactionId: string;
    accountId: string;
    dimensionMemberIds?: string[];
    memo?: string;
  },
): Promise<{ entry: JournalEntry; fromSuggestion: boolean; confidence: number | null }> {
  requireOwnerRole(ctx);
  const txn = await loadUnreviewedTxn(tx, ctx.tenantId, args.transactionId);
  const bankAccount = await loadBankAccount(tx, ctx.tenantId, txn.bankAccountId);
  if (args.accountId === bankAccount.accountId) {
    throw new LedgerError("ACCOUNT_NOT_FOUND", "cannot categorize to the register's own account");
  }

  const a = txn.amountCents;
  // Inflow: Dr bank / Cr category. Outflow: Dr category / Cr bank.
  const lines =
    a > 0
      ? [
          { accountId: bankAccount.accountId, amountCents: a },
          {
            accountId: args.accountId,
            amountCents: -a,
            dimensionMemberIds: args.dimensionMemberIds,
          },
        ]
      : [
          {
            accountId: args.accountId,
            amountCents: -a,
            dimensionMemberIds: args.dimensionMemberIds,
          },
          { accountId: bankAccount.accountId, amountCents: a },
        ];

  // Idempotency key is per-attempt: a voided categorization must be
  // re-categorizable into a FRESH posted entry, so the key counts prior
  // entries for this txn. Double-click safety does not depend on it — the
  // conditional staging update below rolls the loser's whole tx back.
  const priorEntries = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, ctx.tenantId),
        eq(schema.journalEntries.source, "bank_import"),
        eq(schema.journalEntries.sourceId, txn.id),
      ),
    );
  const { entry } = await postEntry(tx, ctx, {
    status: "posted",
    entryDate: txn.txnDate,
    memo: args.memo ?? txn.description,
    source: "bank_import",
    sourceId: txn.id,
    idempotencyKey: `banktxn:${txn.id}:${priorEntries.length}`,
    lines,
  });

  const updated = await tx
    .update(schema.bankTransactions)
    .set({ status: "posted", journalEntryId: entry.id, updatedAt: new Date() })
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

  const suggestion = readAiSuggestion(txn);
  return {
    entry,
    fromSuggestion: suggestion?.accountId === args.accountId,
    confidence: suggestion?.confidence ?? null,
  };
}

/** unreviewed ↔ excluded. Posted rows never move through here. */
export async function setTransactionExcluded(
  tx: Tx,
  ctx: LedgerCtx,
  args: { transactionId: string; excluded: boolean },
): Promise<BankTransaction> {
  requireOwnerRole(ctx);
  const fromStatus = args.excluded ? "unreviewed" : "excluded";
  const toStatus = args.excluded ? "excluded" : "unreviewed";
  const rows = await tx
    .update(schema.bankTransactions)
    .set({ status: toStatus, updatedAt: new Date() })
    .where(
      and(
        eq(schema.bankTransactions.tenantId, ctx.tenantId),
        eq(schema.bankTransactions.id, args.transactionId),
        eq(schema.bankTransactions.status, fromStatus),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("TXN_NOT_UNREVIEWED", "transaction not in the expected state");
  }
  return rows[0];
}
