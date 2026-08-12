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
  AddRecurringEntryButton,
  GenerateRecurringEntriesButton,
  RecurringEntryToggle,
} from "./recurring-entry-controls";

export const dynamic = "force-dynamic";

export default async function RecurringEntriesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const [entries, accounts, vendors] = await Promise.all([
      listRecurringEntries(tx, ctx.tenant.id),
      tx.query.accounts.findMany({
        where: and(
          eq(schema.accounts.tenantId, ctx.tenant.id),
          eq(schema.accounts.isActive, true),
        ),
        orderBy: asc(schema.accounts.code),
      }),
      tx.query.vendors.findMany({
        where: and(
          eq(schema.vendors.tenantId, ctx.tenant.id),
          eq(schema.vendors.isActive, true),
        ),
        orderBy: asc(schema.vendors.name),
      }),
    ]);
    return { entries, accounts, vendors };
  });

  const isOwner = ctx.role === "owner";
  const vendorName = new Map(data.vendors.map((v) => [v.id, v.name]));
  const today = todayInTimezone(ctx.tenant.timezone);

  /** Σ debits, so a journal row can show its size at a glance. */
  function journalSize(template: unknown): number {
    const parsed = parseRecurringEntryTemplate(template);
    if (!parsed || parsed.kind !== "journal") return 0;
    return parsed.lines
      .filter((l) => l.amountCents > 0)
      .reduce((s, l) => s + l.amountCents, 0);
  }

  function billSize(template: unknown): number {
    const parsed = parseRecurringEntryTemplate(template);
    if (!parsed || parsed.kind !== "bill") return 0;
    return parsed.lines.reduce((s, l) => s + l.amountCents, 0);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recurring entries"
        description="Journals and bills the books produce every month. Catch-up dates each one to the month it was for, never to today."
        actions={
          isOwner && (
            <>
              <GenerateRecurringEntriesButton />
              <AddRecurringEntryButton
                accounts={data.accounts.map((a) => ({
                  id: a.id,
                  code: a.code,
                  name: a.name,
                }))}
                vendors={data.vendors.map((v) => ({ id: v.id, name: v.name }))}
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
            description="A monthly depreciation journal, or the rent that arrives whether or not anybody sends a copy. Invoices have their own list under Sales."
          />
        }
      >
        <ul className="divide-y divide-divider">
          {data.entries.map((e) => {
            const broken = parseRecurringEntryTemplate(e.template) === null;
            const size = e.kind === "journal" ? journalSize(e.template) : billSize(e.template);
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {e.name}
                    <Badge variant="outline">
                      {e.kind === "journal" ? "Journal" : "Bill"}
                    </Badge>
                    {e.autoPost && <Badge>posts automatically</Badge>}
                    {!e.isActive && <Badge variant="outline">paused</Badge>}
                    {broken && (
                      <Badge variant="destructive">template needs fixing</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.kind === "bill" && e.vendorId
                      ? `${vendorName.get(e.vendorId) ?? "Supplier"} · `
                      : ""}
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
