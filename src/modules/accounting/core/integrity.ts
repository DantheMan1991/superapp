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
 *
 * `entityId` NARROWS IT TO ONE COMPANY, and the close checklist always passes
 * one (ADR 0010 slice 4). The platform health check deliberately passes none:
 * "is this tenant's ledger sound" is the right question for an operator, while
 * "may I close Maple's June" must not be answered no because OAK is out of
 * balance. Note a combined zero is not evidence each company balances — see
 * `ledgerIsBalancedPerEntity` — which is why the narrowed call exists at all.
 */
export async function getLedgerIntegrity(
  tx: Tx,
  tenantId: string,
  entityId?: string,
): Promise<LedgerIntegrity> {
  const jl = schema.journalLines;
  const je = schema.journalEntries;
  const inEntity = entityId ? eq(je.entityId, entityId) : undefined;
  const perEntry = await tx
    .select({
      entryId: jl.entryId,
      balance: sql<string>`sum(${jl.amountCents})`,
    })
    .from(jl)
    .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
    .where(and(eq(jl.tenantId, tenantId), eq(je.status, "posted" as const), inEntity))
    .groupBy(jl.entryId)
    .having(sql`sum(${jl.amountCents}) <> 0`)
    .limit(5);
  const total = await tx
    .select({ total: sql<string>`coalesce(sum(${jl.amountCents}), 0)` })
    .from(jl)
    .innerJoin(je, and(eq(jl.tenantId, je.tenantId), eq(jl.entryId, je.id)))
    .where(and(eq(jl.tenantId, tenantId), eq(je.status, "posted" as const), inEntity));
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
