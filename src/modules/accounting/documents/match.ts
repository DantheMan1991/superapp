import "server-only";
import { and, asc, between, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { addDaysIso, } from "../lib/dates";

/**
 * The killer flow's engine: given an extracted receipt (total + date),
 * suggest unreviewed bank transactions it probably pays for. Suggestion
 * only — attaching posts nothing; categorization stays the banking flow.
 */

export const MATCH_WINDOW_DAYS = 7;
export const MATCH_LIMIT = 5;

/** Pure: candidate amounts for a receipt total (charge or refund side). */
export function matchAmounts(totalCents: number): number[] {
  return totalCents === 0 ? [] : [totalCents, -totalCents];
}

/** Pure: inclusive date window around the document date. */
export function matchWindow(documentDate: string): { from: string; to: string } {
  return {
    from: addDaysIso(documentDate, -MATCH_WINDOW_DAYS),
    to: addDaysIso(documentDate, MATCH_WINDOW_DAYS),
  };
}

/** Pure: is this txn a candidate for the given extraction? */
export function isCandidateMatch(
  txn: { amountCents: number; txnDate: string },
  doc: { totalCents: number; documentDate: string },
): boolean {
  if (!matchAmounts(doc.totalCents).includes(txn.amountCents)) return false;
  const { from, to } = matchWindow(doc.documentDate);
  return txn.txnDate >= from && txn.txnDate <= to;
}

export interface BankTxnCandidate {
  transactionId: string;
  bankAccountId: string;
  bankAccountName: string;
  txnDate: string;
  description: string;
  amountCents: number;
}

export async function findBankTxnCandidatesForDocument(
  tx: Tx,
  tenantId: string,
  doc: { totalCents: number; documentDate: string },
): Promise<BankTxnCandidate[]> {
  const amounts = matchAmounts(doc.totalCents);
  if (amounts.length === 0) return [];
  const { from, to } = matchWindow(doc.documentDate);

  const rows = await tx
    .select({
      transactionId: schema.bankTransactions.id,
      bankAccountId: schema.bankTransactions.bankAccountId,
      bankAccountName: schema.bankAccounts.name,
      txnDate: schema.bankTransactions.txnDate,
      description: schema.bankTransactions.description,
      amountCents: schema.bankTransactions.amountCents,
    })
    .from(schema.bankTransactions)
    .innerJoin(
      schema.bankAccounts,
      and(
        eq(schema.bankAccounts.tenantId, schema.bankTransactions.tenantId),
        eq(schema.bankAccounts.id, schema.bankTransactions.bankAccountId),
      ),
    )
    .where(
      and(
        eq(schema.bankTransactions.tenantId, tenantId),
        eq(schema.bankTransactions.status, "unreviewed"),
        inArray(schema.bankTransactions.amountCents, amounts),
        between(schema.bankTransactions.txnDate, from, to),
      ),
    )
    .orderBy(
      asc(
        sql`abs(${schema.bankTransactions.txnDate}::date - ${doc.documentDate}::date)`,
      ),
      asc(schema.bankTransactions.txnDate),
    )
    .limit(MATCH_LIMIT);
  return rows;
}
