import { and, asc, eq, inArray } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import {
  listPaymentTerms,
  listProducts,
  listSalesTaxRates,
} from "@/modules/accounting/invoicing/catalogue";
import {
  getDefaultEntityId,
  listDimensionMembers,
  listEntities,
} from "@/modules/accounting/core";
import { dimensionTypesFrom } from "@/lib/dimension-options";
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
    const [productRows, termRows, taxRateRows] = await Promise.all([
      listProducts(tx, ctx.tenant.id, { activeOnly: true }),
      listPaymentTerms(tx, ctx.tenant.id, { activeOnly: true }),
      // ACTIVE only: a retired rate must not be offered, and the server
      // refuses one anyway (TAX_RATE_INVALID).
      listSalesTaxRates(tx, ctx.tenant.id, { activeOnly: true }),
    ]);
    const products = productRows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      unitPriceCents: p.unitPriceCents,
      incomeAccountId: p.incomeAccountId,
    }));
    const terms = termRows.map((t) => ({
      id: t.id,
      name: t.name,
      dueInDays: t.dueInDays,
    }));
    const defaultTermId = termRows.find((t) => t.isDefault)?.id ?? null;
    const taxRates = taxRateRows.map((r) => ({
      id: r.id,
      name: r.name,
      ratePpm: r.ratePpm,
    }));
    const defaultTaxRateId = taxRateRows.find((r) => r.isDefault)?.id ?? null;
    return {
      customers,
      entities: await listEntities(tx, ctx.tenant.id),
      defaultEntityId: await getDefaultEntityId(tx, ctx.tenant.id),
      incomeAccounts,
      suggestedNumber,
      products,
      terms,
      defaultTermId,
      taxRates,
      defaultTaxRateId,
      // Unfiltered: `dimensionTypesFrom` owns the active-only rule.
      dimensionMembers: await listDimensionMembers(tx, ctx.tenant.id),
      today: todayInTimezone(ctx.tenant.timezone),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="New invoice"
        description="Saved as a draft — nothing posts to the books until you issue it."
      />
      <AccountingNav />
      <SalesNav />
      {data.customers.length === 0 ? (
        <p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
          Add a customer first (Sales → Customers).
        </p>
      ) : (
        <InvoiceBuilder
          customers={data.customers.map((c) => ({ id: c.id, name: c.name }))}
          entities={data.entities.map((e) => ({ id: e.id, name: e.name }))}
          defaultEntityId={data.defaultEntityId}
          incomeAccounts={data.incomeAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
          }))}
          suggestedNumber={data.suggestedNumber}
          today={data.today}
          products={data.products}
          terms={data.terms}
          defaultTermId={data.defaultTermId}
          taxRates={data.taxRates}
          defaultTaxRateId={data.defaultTaxRateId}
          dimensionTypes={dimensionTypesFrom(data.dimensionMembers)}
        />
      )}
    </div>
  );
}
