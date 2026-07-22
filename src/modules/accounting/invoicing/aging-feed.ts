import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { toSafeCents } from "../lib/money";
import { buildArAging, type ArAgingReport } from "./aging";

/** Server feed for the A/R aging report (pure builder does the math). */
export async function getArAging(
  tx: Tx,
  tenantId: string,
  asOf: string,
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
