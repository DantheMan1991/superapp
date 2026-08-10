import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { listRules } from "@/modules/accounting/banking/rules";
import { describeConditions } from "@/modules/accounting/banking/rules-match";
import { RulesTable } from "./rules-controls";

export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;

  const data = await withTenant(tenantId, async (tx) => {
    const rules = await listRules(tx, tenantId);
    const bankAccounts = await tx.query.bankAccounts.findMany({
      where: eq(schema.bankAccounts.tenantId, tenantId),
      orderBy: (b, { asc }) => [asc(b.createdAt)],
    });
    const categories = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.isActive, true),
      ),
      orderBy: (a, { asc }) => [asc(a.code)],
    });
    return { rules, bankAccounts, categories };
  });

  // A rule may not code to a register's own account — that would be a transfer,
  // not a categorization, and the posting engine rejects it anyway.
  const registerAccountIds = new Set(data.bankAccounts.map((b) => b.accountId));
  const accountName = new Map(data.categories.map((a) => [a.id, `${a.code} · ${a.name}`]));
  const registerName = new Map(data.bankAccounts.map((b) => [b.id, b.name]));

  const rows = data.rules.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    isActive: r.isActive,
    isSuggested: r.isSuggested,
    appliesTo: r.appliesTo,
    bankAccountId: r.bankAccountId,
    appliedTo: r.bankAccountId
      ? (registerName.get(r.bankAccountId) ?? "Unknown register")
      : "All registers",
    matchMode: r.matchMode,
    conditions: r.conditions,
    conditionsLabel: describeConditions(r.conditions, r.matchMode),
    setAccountId: r.setAccountId,
    setsLabel: `Set category to "${accountName.get(r.setAccountId) ?? "Unknown"}"`,
    setMemo: r.setMemo,
    autoPost: r.autoPost,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/m/accounting/banking"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Banking
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Rules</h1>
        <p className="text-sm text-muted-foreground">
          Tell the books how to categorize a transaction once, and it happens
          every time. Rules run before the AI suggestion and win where both have
          an opinion.
        </p>
      </div>
      <AccountingNav />
      <RulesTable
        rows={rows}
        registers={data.bankAccounts.map((b) => ({ id: b.id, name: b.name }))}
        categories={data.categories
          .filter((a) => !registerAccountIds.has(a.id))
          .map((a) => ({ id: a.id, code: a.code, name: a.name }))}
        canAct={ctx.role === "owner"}
      />
    </div>
  );
}
