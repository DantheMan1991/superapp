import "server-only";
import { createHash } from "node:crypto";
import { schema, type Tx } from "@/db";
import { getBooksStartOn, requireOwnerRole, type LedgerCtx } from "../core";
import { loadWritableBankAccount } from "./accounts";
import { applyRulesToUnreviewed, type ApplyRulesResult } from "./rules";
import type { NormalizedTxn } from "./csv-parse";

/**
 * Dedup hash for CSV rows. The trailing dupIndex lets two genuinely
 * identical same-day charges in ONE file coexist while a re-imported
 * overlapping file still dedups (its identical rows produce identical
 * dupIndexes in row order).
 */
export function externalHashFor(bankAccountId: string, t: NormalizedTxn): string {
  return createHash("sha256")
    .update(`${bankAccountId}|${t.txnDate}|${t.amountCents}|${t.description}|${t.dupIndex}`)
    .digest("hex");
}

export async function importTransactions(
  tx: Tx,
  ctx: LedgerCtx,
  args: { bankAccountId: string; txns: NormalizedTxn[] },
): Promise<{
  imported: number;
  skippedDuplicates: number;
  /** Rows dated before the register's company's books begin (ADR 0035). */
  skippedBeforeStart: number;
  booksStartOn: string | null;
  rules: ApplyRulesResult;
}> {
  requireOwnerRole(ctx);
  const bankAccount = await loadWritableBankAccount(tx, ctx.tenantId, args.bankAccountId);
  /**
   * Lines from before the books began are NOT imported, rather than imported
   * and set aside (ADR 0035): a row the books can never take would sit on the
   * Excluded tab forever and be one Restore away from posting 2025 into 2026.
   * Counted, so the summary can say what happened to them.
   */
  const booksStartOn = await getBooksStartOn(tx, ctx.tenantId, bankAccount.entityId);
  const eligible = booksStartOn
    ? args.txns.filter((t) => t.txnDate >= booksStartOn)
    : args.txns;
  const skippedBeforeStart = args.txns.length - eligible.length;
  let imported = 0;
  const CHUNK = 500;
  for (let i = 0; i < eligible.length; i += CHUNK) {
    const chunk = eligible.slice(i, i + CHUNK);
    const rows = await tx
      .insert(schema.bankTransactions)
      .values(
        chunk.map((t) => ({
          tenantId: ctx.tenantId,
          bankAccountId: bankAccount.id,
          txnDate: t.txnDate,
          description: t.description,
          amountCents: t.amountCents,
          externalHash: externalHashFor(bankAccount.id, t),
          source: "csv" as const,
          raw: t.raw,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.bankTransactions.id });
    imported += rows.length;
  }
  // Rules run over the whole unreviewed queue, not just this batch: a rule
  // written after the first import should still reach rows already waiting.
  const rules = await applyRulesToUnreviewed(tx, ctx, {
    bankAccountId: bankAccount.id,
  });
  return {
    imported,
    skippedDuplicates: eligible.length - imported,
    skippedBeforeStart,
    booksStartOn,
    rules,
  };
}
