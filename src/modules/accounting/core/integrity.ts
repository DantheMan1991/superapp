import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { toSafeCents } from "../lib/money";

export interface LedgerIntegrity {
  balanced: boolean;
  /** Σ signed cents over all posted lines (should be 0). */
  totalCents: number;
  /** Posted entries whose own lines don't sum to zero (should be none). */
  unbalancedEntries: Array<{ entryId: string; balanceCents: number }>;
}

/**
 * Read-only health check for the superadmin dashboard. The DB trigger
 * makes drift impossible in theory; this proves it in practice. Callable
 * under withSystem (reads only — the "withSystem never writes accounting
 * rows" rule is untouched).
 */
export async function getLedgerIntegrity(
  tx: Tx,
  tenantId: string,
): Promise<LedgerIntegrity> {
  const jl = schema.journalLines;
  const je = schema.journalEntries;
  const perEntry = await tx
    .select({
      entryId: jl.entryId,
      balance: sql<string>`sum(${jl.amountCents})`,
    })
    .from(jl)
    .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
    .where(and(eq(jl.tenantId, tenantId), eq(je.status, "posted" as const)))
    .groupBy(jl.entryId)
    .having(sql`sum(${jl.amountCents}) <> 0`)
    .limit(5);
  const total = await tx
    .select({ total: sql<string>`coalesce(sum(${jl.amountCents}), 0)` })
    .from(jl)
    .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
    .where(and(eq(jl.tenantId, tenantId), eq(je.status, "posted" as const)));
  const totalCents = toSafeCents(total[0]?.total ?? 0);
  const unbalancedEntries = perEntry.map((r) => ({
    entryId: r.entryId,
    balanceCents: toSafeCents(r.balance),
  }));
  return {
    balanced: totalCents === 0 && unbalancedEntries.length === 0,
    totalCents,
    unbalancedEntries,
  };
}
