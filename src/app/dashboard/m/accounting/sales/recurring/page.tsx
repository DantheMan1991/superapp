import { and, asc, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Repeat } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import {
  recurringTemplateSchema,
} from "@/modules/accounting/invoicing/recurring";
import {
  formatCentsSigned,
} from "@/modules/accounting/lib/money";
import {
  invoiceTotalCents,
  computeLineAmounts,
} from "@/modules/accounting/invoicing/lines";
import { SalesNav } from "../sales-nav";
import {
  AddRecurringButton,
  GenerateNowButton,
  RecurringRowActions,
} from "./recurring-controls";

export const dynamic = "force-dynamic";

export default async function RecurringPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const templates = await tx.query.recurringInvoices.findMany({
      where: eq(schema.recurringInvoices.tenantId, ctx.tenant.id),
      orderBy: asc(schema.recurringInvoices.name),
    });
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
        eq(schema.accounts.accountType, "income"),
      ),
      orderBy: asc(schema.accounts.code),
    });
    return { templates, customers, incomeAccounts };
  });

  const customerName = new Map(data.customers.map((c) => [c.id, c.name]));
  const isOwner = ctx.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recurring invoices"
        description="Templates that generate draft invoices each month — you review before anything posts."
        actions={
          isOwner && (
            <>
              <GenerateNowButton />
              <AddRecurringButton
                customers={data.customers.map((c) => ({
                  id: c.id,
                  name: c.name,
                }))}
                incomeAccounts={data.incomeAccounts.map((a) => ({
                  id: a.id,
                  code: a.code,
                  name: a.name,
                }))}
              />
            </>
          )
        }
      />

      <AccountingNav />
      <SalesNav />

      <Panel
        isEmpty={data.templates.length === 0}
        empty={
          <EmptyState
            icon={<Repeat />}
            title="Set up a recurring invoice"
            description="Ideal for rent, retainers and subscriptions. Each month it drafts the invoice and waits for you."
          />
        }
      >
        <ul className="divide-y divide-divider">
          {data.templates.map((t) => {
            const parsed = recurringTemplateSchema.safeParse(t.template);
            const total = parsed.success
              ? invoiceTotalCents(computeLineAmounts(parsed.data.lines))
              : 0;
            return (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {t.name}
                    {!t.isActive && <Badge variant="outline">paused</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {customerName.get(t.customerId) ?? "Customer"} ·{" "}
                    <span className="tabular-nums">
                      {formatCentsSigned(total)}
                    </span>
                    /mo · next run{" "}
                    <span className="font-mono tabular-nums">
                      {t.nextRunDate}
                    </span>
                    {t.lastGeneratedAt
                      ? ` · last generated ${t.lastGeneratedAt.toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                {isOwner && (
                  <RecurringRowActions
                    template={{
                      id: t.id,
                      version: t.version,
                      isActive: t.isActive,
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
