import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { listEntities } from "@/modules/accounting/core";
import { formatCents } from "@/modules/accounting/lib/money";
import { SalesNav } from "../../sales-nav";
import { VoidCreditMemoButton } from "./credit-memo-controls";

export const dynamic = "force-dynamic";

/** One credit memo: what it credited, against which invoice, and Void. */
export default async function CreditMemoPage({
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
    const memo = await tx.query.creditMemos.findFirst({
      where: and(eq(schema.creditMemos.tenantId, tenantId), eq(schema.creditMemos.id, id)),
    });
    if (!memo) return null;
    const [invoice, customer, account] = await Promise.all([
      tx.query.invoices.findFirst({
        where: and(eq(schema.invoices.tenantId, tenantId), eq(schema.invoices.id, memo.invoiceId)),
        columns: { id: true, invoiceNumber: true, status: true },
      }),
      tx.query.customers.findFirst({
        where: and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, memo.customerId)),
        columns: { id: true, name: true },
      }),
      tx.query.accounts.findFirst({
        where: and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.id, memo.incomeAccountId)),
        columns: { code: true, name: true },
      }),
    ]);
    return {
      memo,
      invoice,
      customer,
      account,
      entities: await listEntities(tx, tenantId, { includeInactive: true }),
    };
  });
  if (!data) notFound();
  const { memo, invoice, customer, account } = data;
  const isOwner = ctx.role === "owner";
  const isVoid = memo.status === "void";
  const companyName = data.entities.find((e) => e.id === memo.entityId)?.name;

  const rows: Array<[string, React.ReactNode]> = [
    ["Customer", customer?.name ?? "—"],
    [
      "Against",
      invoice ? (
        <Link
          href={`/dashboard/m/accounting/sales/invoices/${invoice.id}`}
          className="font-mono text-xs hover:underline"
        >
          {invoice.invoiceNumber}
        </Link>
      ) : (
        "—"
      ),
    ],
    ["Date", <span key="d" className="font-mono text-xs">{memo.issueDate}</span>],
    ["Amount", <span key="a" className="font-mono tabular-nums">{formatCents(memo.totalCents)}</span>],
    ["Comes off", account ? `${account.code} · ${account.name}` : "—"],
    ["Reason", memo.memo || "—"],
    ...(data.entities.length > 1 ? ([["Company", companyName ?? "—"]] as Array<[string, React.ReactNode]>) : []),
    ["Status", <Badge key="s" variant={isVoid ? "outline" : "default"}>{memo.status}</Badge>],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={memo.number}
        description={
          <>
            Credit memo · {customer?.name ?? "—"} · against {invoice?.invoiceNumber ?? "—"} ·{" "}
            <span className="font-mono tabular-nums">{formatCents(memo.totalCents)}</span>
            {memo.memo ? ` · ${memo.memo}` : ""}
          </>
        }
        actions={
          <>
            {isVoid && <Badge variant="outline">void</Badge>}
            {invoice && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/dashboard/m/accounting/sales/invoices/${invoice.id}`}>
                  {invoice.invoiceNumber}
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard/m/accounting/journal/${memo.journalEntryId}`}>
                Journal entry
              </Link>
            </Button>
            {isOwner && !isVoid && (
              <VoidCreditMemoButton
                creditMemoId={memo.id}
                version={memo.version}
                invoiceNumber={invoice?.invoiceNumber ?? "the invoice"}
              />
            )}
          </>
        }
      />

      <AccountingNav />
      <SalesNav />

      {isVoid && (
        <p className="text-sm text-muted-foreground">
          This credit memo was voided. Its entry is void and the invoice owes the
          credited amount again.
        </p>
      )}

      <Panel>
        <dl className="divide-y divide-divider">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
