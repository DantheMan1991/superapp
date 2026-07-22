import "server-only";
import { createHash } from "node:crypto";
import { schema, type Tx } from "@/db";
import { requireOwnerRole, type LedgerCtx } from "../core";
import { loadBankAccount } from "./accounts";
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
): Promise<{ imported: number; skippedDuplicates: number }> {
  requireOwnerRole(ctx);
  const bankAccount = await loadBankAccount(tx, ctx.tenantId, args.bankAccountId);
  let imported = 0;
  const CHUNK = 500;
  for (let i = 0; i < args.txns.length; i += CHUNK) {
    const chunk = args.txns.slice(i, i + CHUNK);
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
  return { imported, skippedDuplicates: args.txns.length - imported };
}
