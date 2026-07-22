import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import {
  getReconciliationView,
  listReconciliations,
} from "@/modules/accounting/core";
import { formatCentsSigned } from "@/modules/accounting/lib/money";
import {
  ReconcileWorkbench,
  ReconciliationHistory,
  StartReconciliationForm,
} from "./reconcile-workbench";

export const dynamic = "force-dynamic";

export default async function ReconcilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;

  const data = await withTenant(tenantId, async (tx) => {
    const bankAccount = await tx.query.bankAccounts.findFirst({
      where: and(
        eq(schema.bankAccounts.tenantId, tenantId),
        eq(schema.bankAccounts.id, id),
      ),
    });
    if (!bankAccount) return null;
    const history = await listReconciliations(tx, tenantId, id);
    const active = history.find((r) => r.status === "in_progress");
    const view = active
      ? await getReconciliationView(tx, tenantId, active.id)
      : null;
    return { bankAccount, history, view };
  });
  if (!data) notFound();
  const { bankAccount, history, view } = data;
  const isOwner = ctx.role === "owner";
  const latestCompletedId = history.find((r) => r.status === "completed")?.id ?? null;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Reconcile — {bankAccount.name}
          </h1>
          {view && <Badge variant="secondary">in progress</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          Match the books to the bank statement. Cleared entries are locked —
          uncheck a transaction to edit its entry.
        </p>
      </div>

      <AccountingNav />

      {!isOwner ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Only the business owner can reconcile.
          </CardContent>
        </Card>
      ) : view ? (
        <ReconcileWorkbench
          view={{
            reconciliationId: view.reconciliation.id,
            version: view.reconciliation.version,
            statementEndDate: view.reconciliation.statementEndDate,
            statementEndBalanceCents: view.reconciliation.statementEndBalanceCents,
            kind: bankAccount.kind,
            candidates: view.candidates,
            priorReconciledCents: view.priorReconciledCents,
            checkedCents: view.checkedCents,
            expectedLedgerCents: view.expectedLedgerCents,
            differenceCents: view.differenceCents,
          }}
        />
      ) : (
        <StartReconciliationForm bankAccountId={id} kind={bankAccount.kind} />
      )}

      {history.filter((r) => r.status === "completed").length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Completed reconciliations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {history
                .filter((r) => r.status === "completed")
                .map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span>
                      Statement through{" "}
                      <span className="font-mono">{r.statementEndDate}</span> ·{" "}
                      <span className="font-mono">
                        {formatCentsSigned(r.statementEndBalanceCents)}
                      </span>
                    </span>
                    <ReconciliationHistory
                      reconciliationId={r.id}
                      version={r.version}
                      canReopen={r.id === latestCompletedId && !view}
                    />
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
