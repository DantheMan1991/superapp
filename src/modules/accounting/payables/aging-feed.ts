import "server-only";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { toSafeCents } from "../lib/money";
import { buildApAging, type ApAgingReport } from "./aging";

/** Server feed for the A/P aging report (pure builder does the math). */
export async function getApAging(
  tx: Tx,
  tenantId: string,
  asOf: string,
): Promise<ApAgingReport> {
  const rows = await tx
    .select({
      billId: schema.bills.id,
      billNumber: schema.bills.billNumber,
      vendorId: schema.bills.vendorId,
      vendorName: schema.vendors.name,
      dueDate: schema.bills.dueDate,
      totalCents: schema.bills.totalCents,
      paidCents: sql<string>`coalesce(sum(${schema.billPayments.amountCents}) filter (where ${schema.billPayments.paymentDate} <= ${asOf}), 0)`,
    })
    .from(schema.bills)
    .innerJoin(
      schema.vendors,
      and(
        eq(schema.vendors.tenantId, schema.bills.tenantId),
        eq(schema.vendors.id, schema.bills.vendorId),
      ),
    )
    .leftJoin(
      schema.billPayments,
      and(
        eq(schema.billPayments.tenantId, schema.bills.tenantId),
        eq(schema.billPayments.billId, schema.bills.id),
      ),
    )
    .where(
      and(
        eq(schema.bills.tenantId, tenantId),
        inArray(schema.bills.status, ["approved", "partial", "paid"]),
        lte(schema.bills.billDate, asOf),
      ),
    )
    .groupBy(
      schema.bills.id,
      schema.bills.billNumber,
      schema.bills.vendorId,
      schema.vendors.name,
      schema.bills.dueDate,
      schema.bills.totalCents,
    );

  return buildApAging(
    rows.map((r) => ({
      billId: r.billId,
      billNumber: r.billNumber,
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      dueDate: r.dueDate,
      totalCents: r.totalCents,
      paidCents: toSafeCents(r.paidCents),
    })),
    asOf,
  );
}
