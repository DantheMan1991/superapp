import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { PiggyBank } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { LinkRow } from "@/components/app/link-row";
import { Pager } from "@/components/app/pager";
import { pageFrom, pageWindow } from "@/lib/list-query";
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
import { listUndepositedPayments } from "@/modules/accounting/banking/deposits";
import { formatCents } from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Every deposit made, newest first, and what is still waiting to be one.
 *
 * The waiting figure sits above the list rather than in a tile because it is
 * not a filter — it is the reason to press the one button on this page.
 */
export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;
  const sp = await searchParams;

  const data = await withTenant(tenantId, async (tx) => {
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.deposits)
      .where(eq(schema.deposits.tenantId, tenantId));
    const window = pageWindow(pageFrom(sp.page), PAGE_SIZE, total);
    const deposits = await tx
      .select({
        id: schema.deposits.id,
        depositDate: schema.deposits.depositDate,
        memo: schema.deposits.memo,
        totalCents: schema.deposits.totalCents,
        status: schema.deposits.status,
        entityId: schema.deposits.entityId,
        registerName: schema.bankAccounts.name,
        payments: sql<number>`(select count(*)::int from ${schema.invoicePayments} where ${schema.invoicePayments.tenantId} = ${schema.deposits.tenantId} and ${schema.invoicePayments.depositId} = ${schema.deposits.id})`,
      })
      .from(schema.deposits)
      .innerJoin(
        schema.bankAccounts,
        and(
          eq(schema.bankAccounts.tenantId, schema.deposits.tenantId),
          eq(schema.bankAccounts.id, schema.deposits.bankAccountId),
        ),
      )
      .where(eq(schema.deposits.tenantId, tenantId))
      .orderBy(desc(schema.deposits.depositDate), desc(schema.deposits.createdAt))
      .limit(PAGE_SIZE)
      .offset(window.offset);
    return {
      deposits,
      window,
      waiting: await listUndepositedPayments(tx, tenantId),
      entities: await listEntities(tx, tenantId, { includeInactive: true }),
    };
  });
  const isOwner = ctx.role === "owner";
  const companyName = new Map(data.entities.map((e) => [e.id, e.name]));
  const showCompany = data.entities.length > 1;
  const waitingCents = data.waiting.reduce((s, p) => s + p.amountCents, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deposits"
        description="Payments held in Undeposited Funds, banked as one line at a time."
        actions={
          isOwner && (
            <Button asChild size="sm">
              <Link href="/dashboard/m/accounting/banking/deposits/new">New deposit</Link>
            </Button>
          )
        }
      />

      <AccountingNav />

      {data.waiting.length > 0 && (
        <Card className="border-warning/40 bg-warning/8">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <p>
              <span className="font-mono font-medium tabular-nums">
                {formatCents(waitingCents)}
              </span>{" "}
              waiting in Undeposited Funds ·{" "}
              {data.waiting.length === 1 ? "1 payment" : `${data.waiting.length} payments`}{" "}
              not yet banked.
            </p>
            {isOwner && (
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/m/accounting/banking/deposits/new">
                  Record deposit
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <DataTable
        isEmpty={data.deposits.length === 0}
        empty={
          <EmptyState
            icon={<PiggyBank />}
            title="No deposits yet"
            description="When a payment is recorded into Undeposited Funds, bank it here with the others that went in on the same slip."
            action={
              isOwner && data.waiting.length > 0 ? (
                <Button asChild size="sm">
                  <Link href="/dashboard/m/accounting/banking/deposits/new">
                    New deposit
                  </Link>
                </Button>
              ) : undefined
            }
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Account</TableHead>
              {showCompany && <TableHead>Company</TableHead>}
              <TableHead className="hidden sm:table-cell">Memo</TableHead>
              <TableHead className="text-right">Payments</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.deposits.map((d) => (
              <LinkRow key={d.id} href={`/dashboard/m/accounting/banking/deposits/${d.id}`}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {d.depositDate}
                </TableCell>
                <TableCell className="font-medium">{d.registerName}</TableCell>
                {showCompany && (
                  <TableCell className="text-xs text-muted-foreground">
                    {companyName.get(d.entityId) ?? "—"}
                  </TableCell>
                )}
                <TableCell className="hidden max-w-[260px] truncate text-muted-foreground sm:table-cell">
                  {d.memo || "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{d.payments}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatCents(d.totalCents)}
                </TableCell>
                <TableCell>
                  <Badge variant={d.status === "void" ? "outline" : "default"}>
                    {d.status}
                  </Badge>
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>

      <Pager
        window={data.window}
        noun={{ one: "deposit", many: "deposits" }}
        hrefFor={(page) =>
          `/dashboard/m/accounting/banking/deposits${page > 1 ? `?page=${page}` : ""}`
        }
      />
    </div>
  );
}
