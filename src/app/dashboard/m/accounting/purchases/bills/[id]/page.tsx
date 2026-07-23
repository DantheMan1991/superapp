import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { DocumentAttachments } from "@/modules/accounting/components/document-attachments";
import { getSettings } from "@/modules/accounting/core";
import { loadBillLines, findPossibleDuplicates } from "@/modules/accounting/payables/bills";
import { paidCentsFor } from "@/modules/accounting/payables/payments";
import { readBillCoding } from "@/modules/accounting/ai/bill-validate";
import {
  formatCentsSigned,
  todayInTimezone,
} from "@/modules/accounting/lib/money";
import { PurchasesNav } from "../../purchases-nav";
import { BillBuilder } from "../bill-builder";
import { BillActions, RecordBillPaymentDialogButton, UnapplyBillPaymentButton } from "./bill-detail-controls";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  awaiting_approval: "secondary",
  approved: "default",
  partial: "default",
  paid: "secondary",
  void: "outline",
};

export default async function BillDetailPage({
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
    const bill = await tx.query.bills.findFirst({
      where: and(eq(schema.bills.tenantId, tenantId), eq(schema.bills.id, id)),
    });
    if (!bill) return null;
    const vendor = await tx.query.vendors.findFirst({
      where: and(
        eq(schema.vendors.tenantId, tenantId),
        eq(schema.vendors.id, bill.vendorId),
      ),
    });
    const lines = await loadBillLines(tx, tenantId, bill.id);
    const accounts = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.isActive, true),
      ),
      orderBy: (a, { asc }) => [asc(a.code)],
    });
    const allAccounts = await tx.query.accounts.findMany({
      where: eq(schema.accounts.tenantId, tenantId),
    });
    const payments = await tx.query.billPayments.findMany({
      where: and(
        eq(schema.billPayments.tenantId, tenantId),
        eq(schema.billPayments.billId, bill.id),
      ),
      orderBy: (p, { asc }) => [asc(p.paymentDate)],
    });
    const paid = await paidCentsFor(tx, tenantId, bill.id);
    const registers = await tx.query.bankAccounts.findMany({
      where: and(
        eq(schema.bankAccounts.tenantId, tenantId),
        eq(schema.bankAccounts.isActive, true),
      ),
    });
    const vendors = await tx.query.vendors.findMany({
      where: and(
        eq(schema.vendors.tenantId, tenantId),
        eq(schema.vendors.isActive, true),
      ),
      orderBy: (v, { asc }) => [asc(v.name)],
    });
    const settings = await getSettings(tx, tenantId);
    const duplicates =
      bill.status === "void"
        ? []
        : await findPossibleDuplicates(tx, tenantId, {
            vendorId: bill.vendorId,
            billNumber: bill.billNumber,
            totalCents: bill.totalCents,
            billDate: bill.billDate,
            excludeBillId: bill.id,
          });
    return {
      bill,
      vendor,
      lines,
      accounts,
      allAccounts,
      payments,
      paid,
      registers,
      vendors,
      duplicates,
      today: todayInTimezone(settings.bookkeepingTimezone),
    };
  });
  if (!data) notFound();
  const { bill, vendor, lines, payments } = data;

  const accountName = new Map(
    data.allAccounts.map((a) => [a.id, `${a.code} · ${a.name}`]),
  );
  const registerIds = new Set(data.registers.map((r) => r.accountId));
  const codableAccounts = data.accounts.filter(
    (a) =>
      !registerIds.has(a.id) &&
      a.subtype !== "opening_balance" &&
      !(a.isSystem &&
        ["accounts_receivable", "accounts_payable"].includes(a.subtype)),
  );
  const coding = readBillCoding(bill.aiCoding);
  const isOwner = ctx.role === "owner";
  const isDraft = bill.status === "draft";
  const remaining = bill.totalCents - data.paid;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/m/accounting/purchases/bills"
            className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground"
          >
            ← Bills
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {vendor?.name ?? "Bill"}
            </h1>
            <Badge variant={STATUS_BADGE[bill.status] ?? "outline"}>
              {bill.status.replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {bill.billNumber && (
              <>
                Vendor invoice <span className="font-mono">{bill.billNumber}</span>
                {" · "}
              </>
            )}
            {bill.billDate}
            {bill.dueDate && ` · due ${bill.dueDate}`}
            {" · "}
            <span className="font-mono font-medium">
              {formatCentsSigned(bill.totalCents)}
            </span>
            {["approved", "partial"].includes(bill.status) && (
              <>
                {" · "}
                <span className="font-mono">{formatCentsSigned(remaining)}</span>{" "}
                remaining
              </>
            )}
          </p>
        </div>
        <BillActions
          billId={bill.id}
          version={bill.version}
          status={bill.status}
          isOwner={isOwner}
          journalEntryId={bill.journalEntryId}
        />
      </div>

      <AccountingNav />
      <PurchasesNav />

      {data.duplicates.length > 0 && bill.status !== "paid" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Possible duplicate: this vendor also has{" "}
          {data.duplicates
            .map((d) => `${d.billNumber || "a bill"} (${d.billDate}, ${d.status})`)
            .join(", ")}
          .
        </p>
      )}

      {isDraft ? (
        <BillBuilder
          vendors={data.vendors.map((v) => ({ id: v.id, name: v.name }))}
          accounts={codableAccounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
          }))}
          today={data.today}
          bill={{
            id: bill.id,
            version: bill.version,
            vendorId: bill.vendorId,
            billNumber: bill.billNumber,
            billDate: bill.billDate,
            dueDate: bill.dueDate,
            memo: bill.memo,
            lines: lines.map((l) => ({
              id: l.id,
              description: l.description,
              amountCents: l.amountCents,
              accountId: l.accountId,
            })),
            suggestions: coding?.suggestions ?? [],
          }}
        />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lines</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-sm">{l.description || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {l.accountId ? accountName.get(l.accountId) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCentsSigned(l.amountCents)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell className="text-sm">Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono text-sm">
                    {formatCentsSigned(bill.totalCents)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {["approved", "partial", "paid"].includes(bill.status) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Payments</CardTitle>
            {isOwner && ["approved", "partial"].includes(bill.status) && (
              <RecordBillPaymentDialogButton
                billId={bill.id}
                version={bill.version}
                remainingCents={remaining}
                today={data.today}
                registers={data.registers.map((r) => ({
                  ledgerAccountId: r.accountId,
                  name: r.name,
                  kind: r.kind,
                }))}
              />
            )}
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            ) : (
              <ul className="space-y-2">
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {p.paymentDate} · {p.method.replaceAll("_", " ")}
                      {" · "}
                      {accountName.get(p.paidFromAccountId) ?? "account"}
                      {p.memo && ` · ${p.memo}`}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono">
                        {formatCentsSigned(p.amountCents)}
                      </span>
                      {isOwner && (
                        <UnapplyBillPaymentButton
                          paymentId={p.id}
                          version={p.version}
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <DocumentAttachments
        tenantId={tenantId}
        target={{ type: "bill", id: bill.id }}
      />
    </div>
  );
}
