import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { listAccounts, type AccountTypeValue } from "@/modules/accounting/core";
import { AddAccountButton, AccountRowActions, type SlimAccount } from "./account-dialogs";

export const dynamic = "force-dynamic";

const TYPE_ORDER: AccountTypeValue[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

const TYPE_LABELS: Record<AccountTypeValue, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

export default async function AccountsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const accounts = await withTenant(ctx.tenant.id, (tx) =>
    listAccounts(tx, ctx.tenant.id),
  );

  const slim: SlimAccount[] = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    accountType: a.accountType,
    subtype: a.subtype,
    parentId: a.parentId,
    description: a.description,
    isActive: a.isActive,
    isSystem: a.isSystem,
    version: a.version,
  }));

  // Order children directly under their parents within each type group.
  const byParent = new Map<string | null, SlimAccount[]>();
  for (const a of slim) {
    const list = byParent.get(a.parentId) ?? [];
    list.push(a);
    byParent.set(a.parentId, list);
  }
  function tree(parentId: string | null, type: AccountTypeValue, depth: number): Array<SlimAccount & { depth: number }> {
    return (byParent.get(parentId) ?? [])
      .filter((a) => a.accountType === type)
      .flatMap((a) => [{ ...a, depth }, ...tree(a.id, type, depth + 1)]);
  }

  const isOwner = ctx.role === "owner";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Chart of Accounts
          </h1>
          <p className="text-sm text-muted-foreground">
            The categories every dollar in {ctx.tenant.name} flows through.
          </p>
        </div>
        {isOwner && <AddAccountButton accounts={slim} />}
      </div>

      <AccountingNav />

      <div className="space-y-4">
        {TYPE_ORDER.map((type) => {
          const rows = tree(null, type, 0);
          if (rows.length === 0) return null;
          return (
            <Card key={type}>
              <CardContent className="p-0">
                <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">
                  {TYPE_LABELS[type]}
                </div>
                <ul className="divide-y">
                  {rows.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div
                        className="flex min-w-0 items-center gap-3"
                        style={{ paddingLeft: `${a.depth * 20}px` }}
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {a.code}
                        </span>
                        <span className="truncate text-sm font-medium">
                          {a.name}
                        </span>
                        {a.isSystem && (
                          <Badge variant="secondary" className="text-[10px]">
                            system
                          </Badge>
                        )}
                        {!a.isActive && (
                          <Badge variant="outline" className="text-[10px]">
                            inactive
                          </Badge>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          {a.subtype.replaceAll("_", " ")}
                        </span>
                        {isOwner && (
                          <AccountRowActions account={a} accounts={slim} />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
