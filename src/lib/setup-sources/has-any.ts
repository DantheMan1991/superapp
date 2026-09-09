import { and, eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "@/db";

/**
 * "Has a row of this table ever been written for this tenant?" — the one
 * question every setup step asks, kept in one place so a dozen sources do not
 * each spell out a `LIMIT 1`.
 *
 * Deliberately not a COUNT. A count walks every row a big tenant has to answer
 * yes or no, and the Overview asks this a dozen times on every load. `LIMIT 1`
 * on the tenant index stops at the first row it finds.
 *
 * `extra` narrows the question — "an asset that is a storage location" — and
 * is ANDed with the tenant filter, never in place of it. The tenant filter is
 * belt to RLS's braces: the caller's `tx` already cannot see another tenant's
 * rows, and stating it here too is what makes the query cheap.
 */
export async function hasAny(
  tx: Tx,
  table: PgTable & { tenantId: PgColumn },
  tenantId: string,
  extra?: SQL,
): Promise<boolean> {
  const rows = await tx
    .select({ one: sql<number>`1` })
    .from(table)
    .where(extra ? and(eq(table.tenantId, tenantId), extra) : eq(table.tenantId, tenantId))
    .limit(1);
  return rows.length > 0;
}
