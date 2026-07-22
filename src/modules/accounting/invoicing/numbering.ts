import "server-only";
import { eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/**
 * Invoice numbering: "INV-" + zero-padded max numeric suffix + 1.
 * User-edited numbers that don't match the pattern simply don't
 * participate in the max. The unique index (tenant, number) is the race
 * arbiter — see invoices.ts for the onConflictDoNothing retry.
 */

export function formatInvoiceNumber(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}

/** "INV-0009" → 9; null for anything else. Pure, exported for tests. */
export function parseInvoiceNumberSuffix(invoiceNumber: string): number | null {
  const m = invoiceNumber.match(/^INV-(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

export async function suggestInvoiceNumber(
  tx: Tx,
  tenantId: string,
): Promise<string> {
  const [row] = await tx
    .select({
      next: sql<string>`coalesce(max((substring(${schema.invoices.invoiceNumber} from '^INV-(\\d+)$'))::bigint), 0) + 1`,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.tenantId, tenantId));
  return formatInvoiceNumber(Number(row?.next ?? 1));
}
