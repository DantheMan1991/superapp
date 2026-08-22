import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
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
import { listRecordHistory } from "@/modules/accounting/history/list";
import { RecordHistory } from "@/modules/accounting/components/record-history";
import { EntityThreads } from "@/modules/email/components/entity-threads";
import { loadBillLines, findPossibleDuplicates } from "@/modules/accounting/payables/bills";
import { isCodableAccount, listEntities } from "@/modules/accounting/core";
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
    /**
     * EVERY active register, including other companies' — and that reverses
     * what slice 1b did here on purpose.
     *
     * Slice 1b filtered this list because paying one company's bill from
     * another's account was refused, so offering it was offering a choice that
     * always failed. Slice 2 records it instead, as a linked intercompany pair,
     * so it is now a real option. The dialog labels whose account each one is;
     * `recordBillPayment` decides from the register which shape to write.
     */
    const registers = await tx.query.bankAccounts.findMany({
      where: and(
        eq(schema.bankAccounts.tenantId, tenantId),
        eq(schema.bankAccounts.isActive, true),
      ),
    });
    const companies = await listEntities(tx, tenantId, { includeInactive: true });
    const vendors = await tx.query.vendors.findMany({
      where: and(
        eq(schema.vendors.tenantId, tenantId),
        eq(schema.vendors.isActive, true),
      ),
      orderBy: (v, { asc }) => [asc(v.name)],
    });
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
    // Bill, its payments and its approval entry — a bill payment is audited
    // against the PAYMENT, so the bill alone would omit the money paid out.
    const history = await listRecordHistory(tx, ctx.tenant.id, [
      { type: "bill", id: bill.id },
      ...payments.map((p) => ({ type: "bill_payment", id: p.id })),
      ...(bill.journalEntryId
        ? [{ type: "journal_entry", id: bill.journalEntryId }]
        : []),
    ]);
    return {
      companies,
      bill,
      vendor,
      lines,
      history,
      accounts,
      allAccounts,
      payments,
      paid,
      registers,
      vendors,
      duplicates,
      today: todayInTimezone(ctx.tenant.timezone),
    };
  });
  if (!data) notFound();
  const { bill, vendor, lines, payments } = data;

  /**
   * WHOSE ACCOUNT A PAYMENT CAME OUT OF, when it was not this bill's own
   * company. Undefined at one company, and undefined for the ordinary payment,
   * so the row is exactly what it was in every case but the one that needs
   * explaining.
   *
   * The register's NAME is not the answer: it reads as an explanation only when
   * a tenant happens to have called the account after its company. "Main
   * Checking" on somebody else's books looks like your own.
   */
  const payerOf = (paidFromAccountId: string): string | undefined => {
    if (data.companies.length < 2) return undefined;
    const register = data.registers.find((r) => r.accountId === paidFromAccountId);
    if (!register || register.entityId === bill.entityId) return undefined;
    return data.companies.find((c) => c.id === register.entityId)?.name ?? "another company";
  };

  const accountName = new Map(
    data.allAccounts.map((a) => [a.id, `${a.code} · ${a.name}`]),
  );
  const registerIds = new Set(data.registers.map((r) => r.accountId));
  /**
   * What may be PICKED, plus whatever the lines are already coded to.
   *
   * **A SELECT CANNOT SHOW A VALUE THAT IS NOT AMONG ITS OPTIONS.** Matching a
   * bill to a delivery codes its line to Goods Received Not Invoiced, and GRNI
   * is deliberately excluded from the pickable list so nobody hand-codes to it
   * — so a matched line rendered with an EMPTY account box, on a screen whose
   * own footnote says "approval requires accounts on every line". It looked
   * uncoded and was not.
   *
   * Already-used accounts are added back for display. They stay out of the list
   * for every other line, which is the part that mattered.
   */
  const usedAccountIds = new Set(
    data.lines.map((l) => l.accountId).filter((id): id is string => !!id),
  );
  const codableAccounts = data.accounts.filter(
    (a) => isCodableAccount(a, registerIds) || usedAccountIds.has(a.id),
  );
  const coding = readBillCoding(bill.aiCoding);
  const isOwner = ctx.role === "owner";
  const isDraft = bill.status === "draft";
  const remaining = bill.totalCents - data.paid;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/m/accounting/purchases/bills"
          className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground"
        >
          ← Bills
        </Link>
        <PageHeader
          title={vendor?.name ?? "Bill"}
          description={
            <>
              {bill.billNumber && (
                <>
                  Vendor invoice{" "}
                  <span className="font-mono">{bill.billNumber}</span>
                  {" · "}
                </>
              )}
              {bill.billDate}
              {bill.dueDate && ` · due ${bill.dueDate}`}
              {" · "}
              <span className="font-mono font-medium tabular-nums">
                {formatCentsSigned(bill.totalCents)}
              </span>
              {["approved", "partial"].includes(bill.status) && (
                <>
                  {" · "}
                  <span className="font-mono tabular-nums">
                    {formatCentsSigned(remaining)}
                  </span>{" "}
                  remaining
                </>
              )}
            </>
          }
          actions={
            <>
              <Badge variant={STATUS_BADGE[bill.status] ?? "outline"}>
                {bill.status.replaceAll("_", " ")}
              </Badge>
              <BillActions
                billId={bill.id}
                version={bill.version}
                status={bill.status}
                isOwner={isOwner}
                journalEntryId={bill.journalEntryId}
              />
            </>
          }
        />
      </div>

      <AccountingNav />
      <PurchasesNav />

      {data.duplicates.length > 0 && bill.status !== "paid" && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
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
                  // Named only when it is somebody ELSE'S account, because
                  // that is the only time the answer changes what gets
                  // written — and a label on every row would be noise for
                  // the single-company tenant.
                  otherCompany:
                    r.entityId === bill.entityId
                      ? undefined
                      : (data.companies.find((c) => c.id === r.entityId)?.name ??
                        "another company"),
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
                      {payerOf(p.paidFromAccountId) && (
                        // The same words the ledger entry carries in its memo,
                        // so the row and the journal agree.
                        <span className="text-muted-foreground">
                          {" · paid by "}
                          {payerOf(p.paidFromAccountId)}
                        </span>
                      )}
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

      <RecordHistory events={data.history} />

      <DocumentAttachments
        tenantId={tenantId}
        target={{ type: "bill", id: bill.id }}
      />

      {/* Renders nothing at all until a conversation is attached. */}
      <EntityThreads ctx={ctx} target={{ entityType: "bill", entityId: bill.id }} />
    </div>
  );
}
