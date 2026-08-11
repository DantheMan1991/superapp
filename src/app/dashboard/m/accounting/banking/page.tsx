import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { Filter, Landmark } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { plaidConfigured, plaidEnv } from "@/lib/plaid";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getBalances } from "@/modules/accounting/core";
import {
  formatCentsSigned,
  todayInTimezone,
} from "@/modules/accounting/lib/money";
import {
  BankingHeaderButtons,
  PlaidConnectionCard,
} from "./banking-controls";

export const dynamic = "force-dynamic";

export default async function BankingPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;

  const data = await withTenant(tenantId, async (tx) => {
    const bankAccounts = await tx.query.bankAccounts.findMany({
      where: eq(schema.bankAccounts.tenantId, tenantId),
      orderBy: (b, { asc }) => [asc(b.createdAt)],
    });
    const today = todayInTimezone(ctx.tenant.timezone);
    const balances =
      bankAccounts.length > 0
        ? await getBalances(tx, tenantId, {
            asOf: today,
            accountIds: bankAccounts.map((b) => b.accountId),
          })
        : [];
    const unreviewed = await tx
      .select({
        bankAccountId: schema.bankTransactions.bankAccountId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.bankTransactions)
      .where(
        and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.status, "unreviewed"),
        ),
      )
      .groupBy(schema.bankTransactions.bankAccountId);
    const items = await tx.query.plaidItems.findMany({
      where: eq(schema.plaidItems.tenantId, tenantId),
    });
    const categories = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.isActive, true),
      ),
      orderBy: (a, { asc }) => [asc(a.code)],
    });
    return { bankAccounts, balances, unreviewed, items, categories };
  });

  const balanceOf = new Map(data.balances.map((b) => [b.accountId, b.netCents]));
  const unreviewedOf = new Map(data.unreviewed.map((u) => [u.bankAccountId, u.n]));
  const isOwner = ctx.role === "owner";
  const bankAccountOptions = data.bankAccounts
    .filter((b) => b.isActive)
    .map((b) => ({ id: b.id, name: b.name, kind: b.kind }));
  const categoryOptions = data.categories.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    accountType: a.accountType,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banking"
        description={`Bank feeds, imports, and reconciliation for ${ctx.tenant.name}.`}
        actions={
          <>
            {/* Was a hand-rolled anchor styled to look like a button. The real
                Button keeps the focus ring and the disabled/active behaviour. */}
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/m/accounting/banking/rules">
                <Filter className="size-4" />
                Rules
              </Link>
            </Button>
            {isOwner && (
              <BankingHeaderButtons
                plaidReady={plaidConfigured()}
                bankAccounts={bankAccountOptions}
                categories={categoryOptions}
              />
            )}
          </>
        }
      />

      <AccountingNav />

      {plaidConfigured() && plaidEnv() === "sandbox" && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          Plaid is in <strong>sandbox</strong> mode — bank connections use
          Plaid&apos;s test institutions, not real banks.
        </p>
      )}

      {data.items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.items.map((item) => (
            <PlaidConnectionCard
              key={item.id}
              item={{
                plaidItemId: item.plaidItemId,
                institutionName: item.institutionName,
                status: item.status,
                lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
                linkedAccounts: data.bankAccounts
                  .filter((b) => b.plaidItemId === item.plaidItemId)
                  .map((b) => b.name),
              }}
              canManage={isOwner}
            />
          ))}
        </div>
      )}

      {data.bankAccounts.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Landmark />}
            title="Connect a bank"
            description="Connect an account or add one manually, and the feed starts filling in."
          />
        </Panel>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.bankAccounts.map((b) => {
            const net = balanceOf.get(b.accountId) ?? 0;
            const display = b.kind === "credit_card" ? -net : net;
            const pending = unreviewedOf.get(b.id) ?? 0;
            return (
              <Link
                key={b.id}
                href={`/dashboard/m/accounting/banking/${b.id}`}
                // Elevation and a lift on hover, rather than a border that
                // changes colour. `text-brand` on the icon chip was 2.81:1 —
                // `--module-accent` is pitched to clear AA.
                className="flex h-full flex-col justify-between gap-4 rounded-2xl bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-module-accent/10 text-module-accent">
                        <Landmark className="size-4" />
                      </div>
                      <p className="truncate font-heading font-medium tracking-heading">
                        {b.name}
                      </p>
                    </div>
                    {!b.isActive && <Badge variant="outline">inactive</Badge>}
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {b.kind.replaceAll("_", " ")}
                    {b.institution ? ` · ${b.institution}` : ""}
                    {b.last4 ? ` ···· ${b.last4}` : ""}
                    {b.plaidItemId ? " · connected" : ""}
                  </p>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[13px] text-muted-foreground">
                      {b.kind === "credit_card" ? "Owed" : "Balance"}
                    </p>
                    <p className="font-heading text-2xl font-semibold tracking-heading tabular-nums">
                      {formatCentsSigned(display)}
                    </p>
                  </div>
                  {pending > 0 && (
                    <Badge variant="secondary">{pending} to review</Badge>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
