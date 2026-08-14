import { and, asc, eq } from "drizzle-orm";
import { CalendarClock, Package, Percent, Wallet } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import {
  listPaymentMethods,
  listPaymentTerms,
  listProducts,
  listSalesTaxRates,
} from "@/modules/accounting/invoicing/catalogue";
import { formatRatePpm } from "@/modules/accounting/invoicing/tax";
import { formatCentsSigned } from "@/modules/accounting/lib/money";
import { SalesNav } from "../sales-nav";
import {
  ActiveToggle,
  AddMethodButton,
  AddProductButton,
  AddTermButton,
  RestoreDefaultsButton,
  DefaultBadge,
  MakeDefaultButton,
  MakeDefaultRateButton,
  TaxRateDialogButton,
} from "./catalogue-controls";

export const dynamic = "force-dynamic";

export default async function CataloguePage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [products, terms, methods, taxRates, incomeAccounts] = await Promise.all([
      listProducts(tx, ctx.tenant.id),
      listPaymentTerms(tx, ctx.tenant.id),
      listPaymentMethods(tx, ctx.tenant.id),
      listSalesTaxRates(tx, ctx.tenant.id),
      tx.query.accounts.findMany({
        where: and(
          eq(schema.accounts.tenantId, ctx.tenant.id),
          eq(schema.accounts.isActive, true),
          eq(schema.accounts.accountType, "income"),
        ),
        orderBy: asc(schema.accounts.code),
      }),
    ]);
    return { products, terms, methods, taxRates, incomeAccounts };
  });

  const isOwner = ctx.role === "owner";
  const accountLabel = new Map(
    data.incomeAccounts.map((a) => [a.id, `${a.code} · ${a.name}`]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalogue"
        description="What you sell, when you expect to be paid, how the money arrives, and what tax you charge. Deactivating keeps history intact — nothing here is ever deleted."
      />

      <AccountingNav />
      <SalesNav />

      {/* -- saved items -- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-heading">Saved items</h2>
          {isOwner && (
            <AddProductButton
              incomeAccounts={data.incomeAccounts.map((a) => ({
                id: a.id,
                code: a.code,
                name: a.name,
              }))}
            />
          )}
        </div>
        <Panel
          isEmpty={data.products.length === 0}
          empty={
            <EmptyState
              icon={<Package />}
              title="Nothing saved yet"
              description="Save the things you invoice for repeatedly, so the tenth invoice does not need the description and price typed again."
            />
          }
        >
          <ul className="divide-y divide-divider">
            {data.products.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {p.name}
                    {!p.isActive && <Badge variant="outline">inactive</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {formatCentsSigned(p.unitPriceCents)}
                    </span>
                    {p.incomeAccountId
                      ? ` · ${accountLabel.get(p.incomeAccountId) ?? "account"}`
                      : ""}
                    {p.description ? ` · ${p.description}` : ""}
                  </p>
                </div>
                {isOwner && (
                  <ActiveToggle
                    id={p.id}
                    version={p.version}
                    active={p.isActive}
                    kind="product"
                  />
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* -- terms -- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-heading">Payment terms</h2>
          {isOwner && <AddTermButton />}
        </div>
        <Panel
          isEmpty={data.terms.length === 0}
          empty={
            <EmptyState
              icon={<CalendarClock />}
              title="No payment terms yet"
              description="Terms set an invoice's due date from its issue date — Net 30, Due on receipt, and so on. The standard set covers most businesses."
              action={isOwner ? <RestoreDefaultsButton what="terms" /> : undefined}
            />
          }
        >
          <ul className="divide-y divide-divider">
            {data.terms.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {t.name}
                    {t.isDefault && <DefaultBadge />}
                    {!t.isActive && <Badge variant="outline">inactive</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.dueInDays === 0
                      ? "Due the day it is issued"
                      : `Due ${t.dueInDays} days after the issue date`}
                  </p>
                </div>
                {isOwner && (
                  <div className="flex items-center gap-1">
                    {!t.isDefault && t.isActive && (
                      <MakeDefaultButton termId={t.id} />
                    )}
                    <ActiveToggle
                      id={t.id}
                      version={t.version}
                      active={t.isActive}
                      kind="term"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* -- payment methods -- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-heading">
            Payment methods
          </h2>
          {isOwner && <AddMethodButton />}
        </div>
        <Panel
          isEmpty={data.methods.length === 0}
          empty={
            <EmptyState
              icon={<Wallet />}
              title="No payment methods yet"
              description="How the money arrived — cheque, card, bank transfer. Recording a payment asks for one, so this list needs at least a row in it."
              action={
                isOwner ? <RestoreDefaultsButton what="methods" /> : undefined
              }
            />
          }
        >
          <ul className="divide-y divide-divider">
            {data.methods.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  {m.name}
                  {!m.isActive && <Badge variant="outline">inactive</Badge>}
                  <span className="font-mono text-xs text-subtle-foreground">
                    {m.code}
                  </span>
                </p>
                {isOwner && (
                  <ActiveToggle
                    id={m.id}
                    version={m.version}
                    active={m.isActive}
                    kind="method"
                  />
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* -- sales tax rates -- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-heading">
            Sales tax rates
          </h2>
          {isOwner && data.taxRates.length > 0 && <TaxRateDialogButton />}
        </div>
        <Panel
          isEmpty={data.taxRates.length === 0}
          empty={
            <EmptyState
              icon={<Percent />}
              title="No sales tax rates yet"
              description="Add a rate only if you charge sales tax. There is no standard set to restore here — the right rate depends on where you are and what you sell, so nothing is filled in for you."
              action={isOwner ? <TaxRateDialogButton /> : undefined}
            />
          }
        >
          <ul className="divide-y divide-divider">
            {data.taxRates.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {r.name}
                    {r.isDefault && <DefaultBadge />}
                    {!r.isActive && <Badge variant="outline">inactive</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatRatePpm(r.ratePpm)}%</span>{" "}
                    · charged on the lines you mark taxable
                  </p>
                </div>
                {isOwner && (
                  <div className="flex items-center gap-1">
                    {!r.isDefault && r.isActive && (
                      <MakeDefaultRateButton rateId={r.id} />
                    )}
                    <TaxRateDialogButton
                      rate={{
                        id: r.id,
                        name: r.name,
                        ratePpm: r.ratePpm,
                        version: r.version,
                      }}
                    />
                    <ActiveToggle
                      id={r.id}
                      version={r.version}
                      active={r.isActive}
                      kind="taxRate"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        {data.taxRates.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Tax you charge is money held for the tax authority, so it lands in
            Sales Tax Payable rather than in income — it never appears on your
            profit and loss. What you have collected and not yet remitted is on
            the{" "}
            <span className="font-medium">Reports → Sales tax summary</span>{" "}
            page.
          </p>
        )}
      </div>
    </div>
  );
}
