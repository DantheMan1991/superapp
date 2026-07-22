import { and, asc, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Recurring invoices
          </h1>
          <p className="text-sm text-muted-foreground">
            Templates that generate draft invoices each month — you review
            before anything posts.
          </p>
        </div>
        {isOwner && (
          <div className="flex gap-2">
            <GenerateNowButton />
            <AddRecurringButton
              customers={data.customers.map((c) => ({ id: c.id, name: c.name }))}
              incomeAccounts={data.incomeAccounts.map((a) => ({
                id: a.id,
                code: a.code,
                name: a.name,
              }))}
            />
          </div>
        )}
      </div>

      <AccountingNav />
      <SalesNav />

      <Card>
        <CardContent className="p-0">
          {data.templates.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No recurring templates yet — perfect for rent, retainers, and
              subscriptions.
            </p>
          ) : (
            <ul className="divide-y">
              {data.templates.map((t) => {
                const parsed = recurringTemplateSchema.safeParse(t.template);
                const total = parsed.success
                  ? invoiceTotalCents(computeLineAmounts(parsed.data.lines))
                  : 0;
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {t.name}
                        {!t.isActive && <Badge variant="outline">paused</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {customerName.get(t.customerId) ?? "Customer"} ·{" "}
                        {formatCentsSigned(total)}/mo · next run{" "}
                        <span className="font-mono">{t.nextRunDate}</span>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
