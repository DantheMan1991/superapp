import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { BankTransaction, JournalEntry } from "@/db/schema";
import {
  LedgerError,
  postEntry,
  requireOwnerRole,
  voidEntry,
  type LedgerCtx,
} from "../core";
import type { EntryLineInput } from "../core/types";
import { splitFarSide, type SplitInput } from "./split";
import { loadWritableBankAccount } from "./accounts";
import { resetBankLinkForEntry } from "./match";

/** Shape of the ai_suggestion jsonb on bank_transactions. */
export interface StoredAiSuggestion {
  /** Null when the assistant said the line is not the business's (`personal`). */
  accountId: string | null;
  accountCode: string;
  /**
   * True on a PERSONAL register when the assistant judged the line to be the
   * owner's own (ADR 0034). Accepting it sets the row aside rather than
   * posting anything.
   */
  personal?: boolean;
  confidence: number;
  reason?: string;
  model: string;
  at: string;
}

export function readAiSuggestion(txn: BankTransaction): StoredAiSuggestion | null {
  const s = txn.aiSuggestion as StoredAiSuggestion | null;
  if (!s) return null;
  if (s.personal === true) return { ...s, accountId: null };
  return typeof s.accountId === "string" ? s : null;
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
 * Categorize one staged transaction: post the entry through the core engine
 * (idempotent per txn) and link the staging row — one transaction,
 * race-guarded by the conditional status update.
 *
 * Two lines for one category; with `splits`, one line per category on the
 * far side of the bank (2026-09-07). Either way it is ONE entry for ONE row,
 * so P12 and everything built on it — Undo, void from the journal, the
 * per-attempt idempotency key — read a split exactly as a plain posting.
 */
export async function categorizeTransaction(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    transactionId: string;
    /** The one category. Ignored when `splits` is given. */
    accountId?: string;
    dimensionMemberIds?: string[];
    memo?: string;
    /** Several categories, positive amounts adding up to the row — `split.ts`. */
    splits?: SplitInput[];
  },
): Promise<{
  entry: JournalEntry;
  bankAccountId: string;
  fromSuggestion: boolean;
  fromRule: boolean;
  confidence: number | null;
}> {
  requireOwnerRole(ctx);
  const txn = await loadUnreviewedTxn(tx, ctx.tenantId, args.transactionId);
  const bankAccount = await loadWritableBankAccount(tx, ctx.tenantId, txn.bankAccountId);

  const a = txn.amountCents;
  // The far side of the bank: the one category, or the split's several.
  let far: EntryLineInput[];
  if (args.splits) {
    far = splitFarSide(args.splits, Math.abs(a), bankAccount.accountId, a > 0);
  } else {
    if (!args.accountId) {
      throw new LedgerError("ACCOUNT_NOT_FOUND", "no category given");
    }
    if (args.accountId === bankAccount.accountId) {
      throw new LedgerError("ACCOUNT_NOT_FOUND", "cannot categorize to the register's own account");
    }
    far = [
      {
        accountId: args.accountId,
        amountCents: -a,
        dimensionMemberIds: args.dimensionMemberIds,
      },
    ];
  }
  // Inflow: Dr bank / Cr categories. Outflow: Dr categories / Cr bank.
  const lines =
    a > 0
      ? [{ accountId: bankAccount.accountId, amountCents: a }, ...far]
      : [...far, { accountId: bankAccount.accountId, amountCents: a }];

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
    // THE REGISTER'S company. A bank transaction is money that moved through
    // one company's account, so there is nothing to choose and nothing to
    // inherit — it is a property of the account the row arrived on.
    entityId: bankAccount.entityId,
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

  // Which source the human actually agreed with. `fromRule` is what makes a
  // rule's hit rate measurable; `fromSuggestion` is the AI's. A split agrees
  // with neither: both suggest one account.
  const suggestion = readAiSuggestion(txn);
  const rule = txn.ruleSuggestion as { accountId?: string } | null;
  const picked = args.splits ? null : args.accountId;
  return {
    entry,
    bankAccountId: txn.bankAccountId,
    fromSuggestion: picked !== null && suggestion?.accountId === picked,
    fromRule: picked !== null && rule?.accountId === picked,
    confidence: suggestion?.confidence ?? null,
  };
}

/**
 * Undo a categorization: void the entry the row posted and put the row back
 * under review, in one transaction.
 *
 * Only for an entry BORN from this row — `source = bank_import` and
 * `sourceId` the row itself. A row MATCHED to an invoice payment or to a
 * hand-written entry goes back with `unmatchTransaction`, which leaves that
 * entry posted, because the money it records is real whether or not the feed
 * row points at it. `unmatchTransaction` states the same rule from the other
 * side: a bank-import entry is undone by voiding it, never by unlinking.
 *
 * `voidEntry` applies the mutability tiers, so a reconciled line or a closed
 * period refuses the undo exactly as it refuses a void from the journal. The
 * Undo on the toast is a shortcut to that void, not a way around it.
 */
export async function undoCategorization(
  tx: Tx,
  ctx: LedgerCtx,
  args: { transactionId: string },
): Promise<{ entry: JournalEntry; bankAccountId: string }> {
  requireOwnerRole(ctx);
  const txn = await tx.query.bankTransactions.findFirst({
    where: and(
      eq(schema.bankTransactions.tenantId, ctx.tenantId),
      eq(schema.bankTransactions.id, args.transactionId),
    ),
  });
  if (!txn || txn.status !== "posted" || !txn.journalEntryId) {
    throw new LedgerError("TXN_NOT_UNDOABLE", "transaction is not posted");
  }
  const entry = await tx.query.journalEntries.findFirst({
    where: and(
      eq(schema.journalEntries.tenantId, ctx.tenantId),
      eq(schema.journalEntries.id, txn.journalEntryId),
    ),
  });
  if (!entry || entry.source !== "bank_import" || entry.sourceId !== txn.id) {
    throw new LedgerError(
      "TXN_NOT_UNDOABLE",
      "the entry was matched to this row, not posted from it",
    );
  }
  const voided = await voidEntry(tx, ctx, {
    entryId: entry.id,
    expectedVersion: entry.version,
  });
  await resetBankLinkForEntry(tx, ctx.tenantId, entry.id);
  return { entry: voided, bankAccountId: txn.bankAccountId };
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
