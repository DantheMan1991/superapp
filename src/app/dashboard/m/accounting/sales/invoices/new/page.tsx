import { and, asc, eq, inArray } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getSettings } from "@/modules/accounting/core";
import { suggestInvoiceNumber } from "@/modules/accounting/invoicing/numbering";
import { todayInTimezone } from "@/modules/accounting/lib/money";
import { SalesNav } from "../../sales-nav";
import { InvoiceBuilder } from "../invoice-builder";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const customers = await tx.query.customers.findMany({
      where: and(
        eq(schema.customers.tenantId, ctx.tenant.id),
        eq(schema.customers.isActive, true),
      ),
      orderBy: asc(schema.customers.name),
    });
    const incomeAccounts = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, ctx.tenant.id),
        eq(schema.accounts.isActive, true),
        inArray(schema.accounts.accountType, ["income"]),
      ),
      orderBy: asc(schema.accounts.code),
    });
    const suggestedNumber = await suggestInvoiceNumber(tx, ctx.tenant.id);
    const settings = await getSettings(tx, ctx.tenant.id);
    return {
      customers,
      incomeAccounts,
      suggestedNumber,
      today: todayInTimezone(settings.bookkeepingTimezone),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New invoice</h1>
        <p className="text-sm text-muted-foreground">
          Saved as a draft — nothing posts to the books until you issue it.
        </p>
      </div>
      <AccountingNav />
      <SalesNav />
      {data.customers.length === 0 ? (
        <p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
          Add a customer first (Sales → Customers).
        </p>
      ) : (
        <InvoiceBuilder
          customers={data.customers.map((c) => ({ id: c.id, name: c.name }))}
          incomeAccounts={data.incomeAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
          }))}
          suggestedNumber={data.suggestedNumber}
          today={data.today}
        />
      )}
    </div>
  );
}
