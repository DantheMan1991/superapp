import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { listEntities } from "@/modules/accounting/core";
import { formatCents } from "@/modules/accounting/lib/money";
import { VoidDepositButton } from "./deposit-controls";

export const dynamic = "force-dynamic";

/** One deposit: what went to the bank, the entry it posted, and Void. */
export default async function DepositPage({
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
    const deposit = await tx.query.deposits.findFirst({
      where: and(eq(schema.deposits.tenantId, tenantId), eq(schema.deposits.id, id)),
    });
    if (!deposit) return null;
    const register = await tx.query.bankAccounts.findFirst({
      where: and(
        eq(schema.bankAccounts.tenantId, tenantId),
        eq(schema.bankAccounts.id, deposit.bankAccountId),
      ),
      columns: { id: true, name: true },
    });
    const p = schema.invoicePayments;
    const payments = await tx
      .select({
        id: p.id,
        paymentDate: p.paymentDate,
        amountCents: p.amountCents,
        method: p.method,
        memo: p.memo,
        invoiceId: p.invoiceId,
        invoiceNumber: schema.invoices.invoiceNumber,
        customerName: schema.customers.name,
      })
      .from(p)
      .innerJoin(
        schema.invoices,
        and(eq(schema.invoices.tenantId, p.tenantId), eq(schema.invoices.id, p.invoiceId)),
      )
      .innerJoin(
        schema.customers,
        and(
          eq(schema.customers.tenantId, schema.invoices.tenantId),
          eq(schema.customers.id, schema.invoices.customerId),
        ),
      )
      .where(and(eq(p.tenantId, tenantId), eq(p.depositId, deposit.id)))
      .orderBy(asc(p.paymentDate), asc(p.createdAt));
    return {
      deposit,
      register,
      payments,
      entities: await listEntities(tx, tenantId, { includeInactive: true }),
    };
  });
  if (!data) notFound();
  const { deposit, register, payments } = data;
  const isOwner = ctx.role === "owner";
  const isVoid = deposit.status === "void";
  const companyName = data.entities.find((e) => e.id === deposit.entityId)?.name;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deposit"
        description={
          <>
            <span className="font-mono font-medium tabular-nums">
              {formatCents(deposit.totalCents)}
            </span>{" "}
            into {register?.name ?? "a closed account"} on{" "}
            <span className="font-mono">{deposit.depositDate}</span>
            {data.entities.length > 1 && companyName ? ` · ${companyName}` : ""}
            {deposit.memo ? ` · ${deposit.memo}` : ""}
          </>
        }
        actions={
          <>
            {isVoid && <Badge variant="outline">void</Badge>}
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard/m/accounting/journal/${deposit.journalEntryId}`}>
                Journal entry
              </Link>
            </Button>
            {register && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/dashboard/m/accounting/banking/${register.id}`}>
                  {register.name}
                </Link>
              </Button>
            )}
            {isOwner && !isVoid && (
              <VoidDepositButton depositId={deposit.id} version={deposit.version} />
            )}
          </>
        }
      />

      <AccountingNav />

      {isVoid && (
        <p className="text-sm text-muted-foreground">
          This deposit was voided. Its entry is void and these payments went
          back to Undeposited Funds, where they can be deposited again.
        </p>
      )}

      <DataTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="hidden sm:table-cell">Method</TableHead>
              <TableHead className="hidden md:table-cell">Memo</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {p.paymentDate}
                </TableCell>
                <TableCell className="font-medium">{p.customerName}</TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/m/accounting/sales/invoices/${p.invoiceId}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {p.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                  {p.method.replaceAll("_", " ")}
                </TableCell>
                <TableCell className="hidden max-w-[240px] truncate text-xs text-muted-foreground md:table-cell">
                  {p.memo || "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatCents(p.amountCents)}
                </TableCell>
              </TableRow>
            ))}
            {payments.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  {isVoid
                    ? "The payments this deposit banked are back in Undeposited Funds."
                    : "No payments are linked to this deposit."}
                </TableCell>
              </TableRow>
            )}
            <TableRow className="font-medium">
              <TableCell colSpan={5} className="text-right text-sm">
                Total
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatCents(deposit.totalCents)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
