import { and, asc, eq } from "drizzle-orm";
import { Repeat } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { listRecurringEntries } from "@/modules/accounting/recurring/generate";
import { parseRecurringEntryTemplate } from "@/modules/accounting/recurring/template";
import { formatCentsSigned, todayInTimezone } from "@/modules/accounting/lib/money";
import {
  computeLineAmounts,
  invoiceSubtotalCents,
} from "@/modules/accounting/invoicing/lines";
import {
  AddRecurringEntryButton,
  GenerateRecurringEntriesButton,
  RecurringEntryToggle,
} from "./recurring-entry-controls";

export const dynamic = "force-dynamic";

const accountOption = (a: { id: string; code: string; name: string }) => ({
  id: a.id,
  code: a.code,
  name: a.name,
});

export default async function RecurringEntriesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [entries, accounts, registers, vendors, customers] = await Promise.all([
      listRecurringEntries(tx, ctx.tenant.id),
      tx.query.accounts.findMany({
        where: and(
          eq(schema.accounts.tenantId, ctx.tenant.id),
          eq(schema.accounts.isActive, true),
        ),
        orderBy: asc(schema.accounts.code),
      }),
      tx.query.bankAccounts.findMany({
        where: eq(schema.bankAccounts.tenantId, ctx.tenant.id),
      }),
      tx.query.vendors.findMany({
        where: and(
          eq(schema.vendors.tenantId, ctx.tenant.id),
          eq(schema.vendors.isActive, true),
        ),
        orderBy: asc(schema.vendors.name),
      }),
      tx.query.customers.findMany({
        where: and(
          eq(schema.customers.tenantId, ctx.tenant.id),
          eq(schema.customers.isActive, true),
        ),
        orderBy: asc(schema.customers.name),
      }),
    ]);

    /**
     * THREE lists, because the three kinds may not post to the same places and
     * the one-list version let a rent invoice be coded to Checking.
     *
     * Each mirrors the one-off builder for that kind, so a template and a
     * hand-keyed document offer the same choices:
     *   - invoice lines → income only (`sales/invoices/new`)
     *   - bill lines    → codable: no bank register, no opening balance, no
     *                     system AR/AP (`purchases/bills/new`)
     *   - journal lines → everything, which is what a journal is for
     */
    const registerIds = new Set(registers.map((r) => r.accountId));
    return {
      entries,
      vendors,
      customers,
      journalAccounts: accounts,
      incomeAccounts: accounts.filter((a) => a.accountType === "income"),
      codableAccounts: accounts.filter(
        (a) =>
          !registerIds.has(a.id) &&
          a.subtype !== "opening_balance" &&
          !(
            a.isSystem &&
            ["accounts_receivable", "accounts_payable"].includes(a.subtype)
          ),
      ),
    };
  });

  const isOwner = ctx.role === "owner";
  const vendorName = new Map(data.vendors.map((v) => [v.id, v.name]));
  const customerName = new Map(data.customers.map((c) => [c.id, c.name]));
  const today = todayInTimezone(ctx.tenant.timezone);

  /**
   * What one run of this template is worth, so a row shows its size at a
   * glance. A journal sums its DEBITS only (summing both sides would always
   * give zero); the other two sum their lines, an invoice line being
   * quantity × unit price.
   */
  function templateSize(template: unknown): number {
    const parsed = parseRecurringEntryTemplate(template);
    if (!parsed) return 0;
    if (parsed.kind === "journal") {
      return parsed.lines
        .filter((l) => l.amountCents > 0)
        .reduce((s, l) => s + l.amountCents, 0);
    }
    if (parsed.kind === "bill") {
      return parsed.lines.reduce((s, l) => s + l.amountCents, 0);
    }
    // Pre-tax on purpose: this is a size hint for the list, and the template's
    // rate is resolved live at generation, so a tax figure here would be a
    // guess at next month's rate rather than a fact.
    return invoiceSubtotalCents(computeLineAmounts(parsed.lines));
  }

  const KIND_LABEL = {
    journal: "Journal",
    bill: "Bill",
    invoice: "Invoice",
  } as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recurring entries"
        description="Everything the books produce every month — invoices, bills and journals. Catch-up dates each one to the month it was for, never to today."
        actions={
          isOwner && (
            <>
              <GenerateRecurringEntriesButton />
              <AddRecurringEntryButton
                journalAccounts={data.journalAccounts.map(accountOption)}
                incomeAccounts={data.incomeAccounts.map(accountOption)}
                codableAccounts={data.codableAccounts.map(accountOption)}
                vendors={data.vendors.map((v) => ({ id: v.id, name: v.name }))}
                customers={data.customers.map((c) => ({ id: c.id, name: c.name }))}
                today={today}
              />
            </>
          )
        }
      />

      <AccountingNav />

      <Panel
        isEmpty={data.entries.length === 0}
        empty={
          <EmptyState
            icon={<Repeat />}
            title="Nothing recurring yet"
            description="The rent you invoice on the first, the rent you pay on the fifth, or the monthly depreciation journal — anything the books produce on a schedule."
          />
        }
      >
        <ul className="divide-y divide-divider">
          {data.entries.map((e) => {
            const broken = parseRecurringEntryTemplate(e.template) === null;
            const size = templateSize(e.template);
            const party =
              e.kind === "bill"
                ? e.vendorId && (vendorName.get(e.vendorId) ?? "Supplier")
                : e.kind === "invoice"
                  ? e.customerId && (customerName.get(e.customerId) ?? "Customer")
                  : null;
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {e.name}
                    <Badge variant="outline">{KIND_LABEL[e.kind]}</Badge>
                    {e.autoPost && <Badge>posts automatically</Badge>}
                    {!e.isActive && <Badge variant="outline">paused</Badge>}
                    {broken && (
                      <Badge variant="destructive">template needs fixing</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {party ? `${party} · ` : ""}
                    <span className="tabular-nums">{formatCentsSigned(size)}</span>
                    {" · day "}
                    {e.dayOfMonth}
                    {" · next run "}
                    <span className="font-mono tabular-nums">{e.nextRunDate}</span>
                    {e.lastGeneratedAt
                      ? ` · last generated ${e.lastGeneratedAt.toISOString().slice(0, 10)}`
                      : ""}
                  </p>
                </div>
                {isOwner && (
                  <RecurringEntryToggle
                    id={e.id}
                    version={e.version}
                    active={e.isActive}
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
