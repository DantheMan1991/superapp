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
import {
  failureSentence,
  isCodableAccount,
  listDimensionMembers,
} from "@/modules/accounting/core";
import { dimensionTypesFrom } from "@/lib/dimension-options";
import { listRecurringEntries } from "@/modules/accounting/recurring/generate";
import { parseRecurringEntryTemplate } from "@/modules/accounting/recurring/template";
import { formatCentsSigned, todayInTimezone } from "@/modules/accounting/lib/money";
import {
  computeLineAmounts,
  invoiceSubtotalCents,
} from "@/modules/accounting/invoicing/lines";
import {
  GenerateRecurringEntriesButton,
  RecurringEntryDialogButton,
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
    const [entries, accounts, registers, vendors, customers, dimensionMembers] =
      await Promise.all([
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
        // Unfiltered: `dimensionTypesFrom` owns the active-only rule.
        listDimensionMembers(tx, ctx.tenant.id),
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
      dimensionMembers,
      vendors,
      customers,
      journalAccounts: accounts,
      incomeAccounts: accounts.filter((a) => a.accountType === "income"),
      codableAccounts: accounts.filter((a) => isCodableAccount(a, registerIds)),
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

  /**
   * **WHAT A TEMPLATE IS TAGGED WITH, so somebody can check it.**
   *
   * This list is the only screen a template has — there is no detail route —
   * so a tag that does not appear here is one nobody can ever verify. The same
   * test the journal entry page had to pass: an entry that can be tagged and
   * cannot be SEEN to be tagged is half a feature. (Until 2026-09-01 there was
   * no update action either, and the only correction was pause-and-rewrite;
   * the Edit button beside each row is what changed that.)
   *
   * DISTINCT names across the template's lines, not per line: this row is one
   * line of muted text and the question it answers is "what will next month's
   * entry be tagged with", not "which line carries which".
   *
   * Retired members are named too, and MARKED — `listDimensionMembers` is
   * unfiltered, and `dimensionTypesFrom` uses the same `(retired)` suffix for
   * the same reason. A tag pointing at a retired member is the one worth
   * seeing: generation will drop it and count it, and Edit offers it back
   * (marked) so it can be taken off — a save that still names it is refused.
   * This is the sole screen where it is visible at all.
   */
  const memberName = new Map(
    data.dimensionMembers.map((m) => [
      m.id,
      m.isActive ? m.displayName : `${m.displayName} (retired)`,
    ]),
  );

  function templateTags(template: unknown): string[] {
    const parsed = parseRecurringEntryTemplate(template);
    if (!parsed) return [];
    const ids = new Set(
      (parsed.lines as ReadonlyArray<{ dimensionMemberIds?: string[] }>).flatMap(
        (l) => l.dimensionMemberIds ?? [],
      ),
    );
    return [...ids]
      .map((id) => memberName.get(id))
      .filter((name): name is string => !!name)
      .sort((a, b) => a.localeCompare(b));
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
              <RecurringEntryDialogButton
                journalAccounts={data.journalAccounts.map(accountOption)}
                incomeAccounts={data.incomeAccounts.map(accountOption)}
                codableAccounts={data.codableAccounts.map(accountOption)}
                vendors={data.vendors.map((v) => ({ id: v.id, name: v.name }))}
                customers={data.customers.map((c) => ({ id: c.id, name: c.name }))}
                today={today}
                dimensionTypes={dimensionTypesFrom(data.dimensionMembers)}
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
            const parsed = parseRecurringEntryTemplate(e.template);
            const broken = parsed === null;
            const size = templateSize(e.template);
            const tags = templateTags(e.template);
            /**
             * **WHICH ROWS MAY BE EDITED.** A row that no longer parses has
             * nothing to load into the dialog, and its badge already says
             * pause-and-rewrite. A bill template with other than exactly one
             * line cannot be shown by a dialog that holds one — nothing this
             * app writes makes such a template, but the schema allows it, and
             * an Edit that silently dropped lines would be worse than none.
             */
            const editable =
              isOwner &&
              parsed !== null &&
              (parsed.kind !== "bill" || parsed.lines.length === 1);
            const ownIds = parsed
              ? (parsed.lines as ReadonlyArray<{ dimensionMemberIds?: string[] }>).flatMap(
                  (l) => l.dimensionMemberIds ?? [],
                )
              : [];
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
                    {/*
                      **THE NOTE THE SWEEP LEFT.** Until this column existed a
                      template that failed at 6am rendered exactly as it had the
                      day before; the only badge was a SHAPE check that a dead
                      account, a closed period or a bad rate never tripped. It
                      clears itself on the template's next clean run and on
                      nothing else — so it survives an edit, which is right,
                      because "edited" is not "fixed".
                    */}
                    {e.lastError !== "" && (
                      <Badge variant="destructive">failing</Badge>
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
                  {e.lastError !== "" && (
                    <p className="mt-0.5 text-xs text-destructive">
                      {failureSentence(e.lastError)}
                      {e.lastErrorAt
                        ? ` — ${e.lastErrorAt.toISOString().slice(0, 10)}`
                        : ""}
                    </p>
                  )}
                  {tags.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {tags.map((name) => (
                        <span
                          key={name}
                          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground"
                        >
                          {name}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {isOwner && (
                  <div className="flex shrink-0 items-center gap-1">
                    {editable && parsed && (
                      <RecurringEntryDialogButton
                        journalAccounts={data.journalAccounts.map(accountOption)}
                        incomeAccounts={data.incomeAccounts.map(accountOption)}
                        codableAccounts={data.codableAccounts.map(accountOption)}
                        vendors={data.vendors.map((v) => ({ id: v.id, name: v.name }))}
                        customers={data.customers.map((c) => ({ id: c.id, name: c.name }))}
                        today={today}
                        /* This template's own ids as keepIds, so a retired
                           member it already holds is offered back, marked. */
                        dimensionTypes={dimensionTypesFrom(data.dimensionMembers, {
                          keepIds: ownIds,
                        })}
                        existing={{
                          id: e.id,
                          version: e.version,
                          kind: e.kind,
                          name: e.name,
                          dayOfMonth: e.dayOfMonth,
                          nextRunDate: e.nextRunDate,
                          autoPost: e.autoPost,
                          vendorId: e.vendorId,
                          customerId: e.customerId,
                          template: parsed,
                        }}
                      />
                    )}
                    <RecurringEntryToggle
                      id={e.id}
                      version={e.version}
                      active={e.isActive}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
