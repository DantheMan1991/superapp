import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { listContactPointsFor } from "@/lib/parties/contacts";
import { preferredContactValue } from "@/lib/parties/contact-values";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { formatCentsSigned, toSafeCents } from "@/modules/accounting/lib/money";
import { SalesNav } from "../sales-nav";
import { AddCustomerButton, CustomerRowActions } from "./customer-dialogs";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const customers = await tx.query.customers.findMany({
      where: eq(schema.customers.tenantId, ctx.tenant.id),
      orderBy: asc(schema.customers.name),
    });
    const invoiced = await tx
      .select({
        customerId: schema.invoices.customerId,
        total: sql<string>`coalesce(sum(${schema.invoices.totalCents}), 0)`,
      })
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.tenantId, ctx.tenant.id),
          inArray(schema.invoices.status, ["issued", "partial"]),
        ),
      )
      .groupBy(schema.invoices.customerId);
    const paid = await tx
      .select({
        customerId: schema.invoices.customerId,
        paid: sql<string>`coalesce(sum(${schema.invoicePayments.amountCents}), 0)`,
      })
      .from(schema.invoicePayments)
      .innerJoin(
        schema.invoices,
        and(
          eq(schema.invoices.tenantId, schema.invoicePayments.tenantId),
          eq(schema.invoices.id, schema.invoicePayments.invoiceId),
        ),
      )
      .where(
        and(
          eq(schema.invoicePayments.tenantId, ctx.tenant.id),
          inArray(schema.invoices.status, ["issued", "partial"]),
        ),
      )
      .groupBy(schema.invoices.customerId);
    // One query for every customer's addresses rather than one per row. The
    // contact points ARE the email and phone this page shows — the columns
    // were retired in 0075.
    const contacts = await listContactPointsFor(
      tx,
      ctx.tenant.id,
      customers.map((c) => c.partyId),
    );
    return { customers, invoiced, paid, contacts };
  });

  const reach = (partyId: string) => {
    const points = data.contacts.get(partyId) ?? [];
    return {
      email: preferredContactValue(points, "email"),
      phone: preferredContactValue(points, "phone"),
    };
  };

  const paidOf = new Map(data.paid.map((p) => [p.customerId, toSafeCents(p.paid)]));
  const openOf = new Map(
    data.invoiced.map((b) => [
      b.customerId,
      toSafeCents(b.total) - (paidOf.get(b.customerId) ?? 0),
    ]),
  );
  const isOwnerOrStaff = true; // staff may manage customers (P21)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Who {ctx.tenant.name} bills.
          </p>
        </div>
        {isOwnerOrStaff && <AddCustomerButton />}
      </div>

      <AccountingNav />
      <SalesNav />

      <Card>
        <CardContent className="p-0">
          {data.customers.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No customers yet — add the first one to start invoicing.
            </p>
          ) : (
            <ul className="divide-y">
              {data.customers.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {c.name}
                      {!c.isActive && <Badge variant="outline">inactive</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[reach(c.partyId).email, reach(c.partyId).phone]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {(openOf.get(c.id) ?? 0) > 0 && (
                      <span className="font-mono text-sm">
                        {formatCentsSigned(openOf.get(c.id)!)} open
                      </span>
                    )}
                    <CustomerRowActions
                      customer={{
                        id: c.id,
                        version: c.version,
                        name: c.name,
                        email: reach(c.partyId).email,
                        phone: reach(c.partyId).phone,
                        address: c.address,
                        notes: c.notes,
                        isActive: c.isActive,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
