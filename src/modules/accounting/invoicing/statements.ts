import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Customer } from "@/db/schema";
import { buildCustomerStatement, type CustomerStatement } from "./statement";

/**
 * Everything one customer's statement needs, from the database — the rows
 * go through `buildCustomerStatement`, which is where the arithmetic lives.
 * Null when the customer is not this tenant's.
 */
export async function loadCustomerStatement(
  tx: Tx,
  tenantId: string,
  customerId: string,
  range: { from: string; to: string },
): Promise<{ customer: Customer; statement: CustomerStatement } | null> {
  const customer = await tx.query.customers.findFirst({
    where: and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, customerId)),
  });
  if (!customer) return null;
  const invoices = await tx.query.invoices.findMany({
    where: and(
      eq(schema.invoices.tenantId, tenantId),
      eq(schema.invoices.customerId, customer.id),
    ),
    orderBy: asc(schema.invoices.issueDate),
    columns: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      totalCents: true,
      status: true,
      entityId: true,
    },
  });
  const payments =
    invoices.length === 0
      ? []
      : await tx.query.invoicePayments.findMany({
          where: and(
            eq(schema.invoicePayments.tenantId, tenantId),
            inArray(
              schema.invoicePayments.invoiceId,
              invoices.map((i) => i.id),
            ),
          ),
          orderBy: asc(schema.invoicePayments.paymentDate),
          columns: {
            id: true,
            invoiceId: true,
            paymentDate: true,
            amountCents: true,
            method: true,
            memo: true,
          },
        });
  return {
    customer,
    statement: buildCustomerStatement(invoices, payments, range.from, range.to),
  };
}
