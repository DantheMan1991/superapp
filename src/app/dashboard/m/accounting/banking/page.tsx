import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { Landmark } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { plaidConfigured, plaidEnv } from "@/lib/plaid";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getBalances, getSettings } from "@/modules/accounting/core";
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
    const settings = await getSettings(tx, tenantId);
    const today = todayInTimezone(settings.bookkeepingTimezone);
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Banking</h1>
          <p className="text-sm text-muted-foreground">
            Bank feeds, imports, and reconciliation for {ctx.tenant.name}.
          </p>
        </div>
        {isOwner && (
          <BankingHeaderButtons
            plaidReady={plaidConfigured()}
            bankAccounts={bankAccountOptions}
            categories={categoryOptions}
          />
        )}
      </div>

      <AccountingNav />

      {plaidConfigured() && plaidEnv() === "sandbox" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No bank accounts yet. Connect a bank or add one manually to start
            the feed.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.bankAccounts.map((b) => {
            const net = balanceOf.get(b.accountId) ?? 0;
            const display = b.kind === "credit_card" ? -net : net;
            const pending = unreviewedOf.get(b.id) ?? 0;
            return (
              <Link key={b.id} href={`/dashboard/m/accounting/banking/${b.id}`}>
                <Card className="h-full transition-colors hover:border-brand/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-md bg-brand/10 text-brand">
                          <Landmark className="size-4" />
                        </div>
                        <CardTitle className="text-base">{b.name}</CardTitle>
                      </div>
                      {!b.isActive && <Badge variant="outline">inactive</Badge>}
                    </div>
                    <CardDescription>
                      {b.kind.replaceAll("_", " ")}
                      {b.institution ? ` · ${b.institution}` : ""}
                      {b.last4 ? ` ···· ${b.last4}` : ""}
                      {b.plaidItemId ? " · connected" : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {b.kind === "credit_card" ? "Owed" : "Balance"}
                      </p>
                      <p className="font-mono text-xl font-semibold">
                        {formatCentsSigned(display)}
                      </p>
                    </div>
                    {pending > 0 && (
                      <Badge className="bg-brand hover:bg-brand">
                        {pending} to review
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
