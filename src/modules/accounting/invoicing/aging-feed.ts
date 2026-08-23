import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { toSafeCents } from "../lib/money";
import { entityScopeCondition, type FilterScope } from "../core/entities";
import { buildArAging, type ArAgingReport } from "./aging";

/**
 * Server feed for the A/R aging report (pure builder does the math).
 *
 * IT TAKES AN ENTITY SCOPE NOW, and that is the change slice 1b unlocked.
 * Aging declined one before because invoices carried no company, and scoping half a
 * report is worse than scoping none. They do now, so it does — required, like
 * every other report engine (ADR 0010).
 *
 * A `FilterScope`, so it CANNOT be asked to consolidate (slice 3). This report
 * reads invoices, and an affiliate balance never becomes one: money one company
 * owes another is recorded as an intercompany pair, never as a receivable. There
 * is nothing here to eliminate, so consolidated would be combined wearing a
 * different name.
 */
export async function getArAging(
  tx: Tx,
  tenantId: string,
  asOf: string,
  scope: FilterScope,
): Promise<ArAgingReport> {
  const rows = await tx
    .select({
      invoiceId: schema.invoices.id,
      invoiceNumber: schema.invoices.invoiceNumber,
      customerId: schema.invoices.customerId,
      customerName: schema.customers.name,
      dueDate: schema.invoices.dueDate,
      totalCents: schema.invoices.totalCents,
      paidCents: sql<string>`coalesce(sum(${schema.invoicePayments.amountCents}) filter (where ${schema.invoicePayments.paymentDate} <= ${asOf}), 0)`,
    })
    .from(schema.invoices)
    .innerJoin(
      schema.customers,
      and(
        eq(schema.customers.tenantId, schema.invoices.tenantId),
        eq(schema.customers.id, schema.invoices.customerId),
      ),
    )
    .leftJoin(
      schema.invoicePayments,
      and(
        eq(schema.invoicePayments.tenantId, schema.invoices.tenantId),
        eq(schema.invoicePayments.invoiceId, schema.invoices.id),
      ),
    )
    .where(
      and(
        eq(schema.invoices.tenantId, tenantId),
        entityScopeCondition(scope, schema.invoices.entityId),
        inArray(schema.invoices.status, ["issued", "partial", "paid"]),
        lte(schema.invoices.issueDate, asOf),
      ),
    )
    .groupBy(
      schema.invoices.id,
      schema.invoices.invoiceNumber,
      schema.invoices.customerId,
      schema.customers.name,
      schema.invoices.dueDate,
      schema.invoices.totalCents,
    );

  return buildArAging(
    rows.map((r) => ({
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      customerId: r.customerId,
      customerName: r.customerName,
      dueDate: r.dueDate,
      totalCents: r.totalCents,
      paidCents: toSafeCents(r.paidCents),
    })),
    asOf,
  );
}
