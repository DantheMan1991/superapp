import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
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
import { formatCents, toSafeCents } from "@/modules/accounting/lib/money";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline"> = {
  posted: "default",
  draft: "secondary",
  void: "outline",
};

export default async function JournalPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const { entries, entities } = await withTenant(ctx.tenant.id, async (tx) => ({
    entities: await listEntities(tx, ctx.tenant.id, { includeInactive: true }),
    entries: await tx
      .select({
        id: schema.journalEntries.id,
        entryDate: schema.journalEntries.entryDate,
        memo: schema.journalEntries.memo,
        status: schema.journalEntries.status,
        source: schema.journalEntries.source,
        entityId: schema.journalEntries.entityId,
        totalDebits: sql<string>`coalesce(sum(case when ${schema.journalLines.amountCents} > 0 then ${schema.journalLines.amountCents} else 0 end), 0)`,
      })
      .from(schema.journalEntries)
      .leftJoin(
        schema.journalLines,
        and(
          eq(schema.journalLines.tenantId, schema.journalEntries.tenantId),
          eq(schema.journalLines.entryId, schema.journalEntries.id),
        ),
      )
      .where(eq(schema.journalEntries.tenantId, ctx.tenant.id))
      .groupBy(schema.journalEntries.id)
      .orderBy(
        desc(schema.journalEntries.entryDate),
        desc(schema.journalEntries.createdAt),
      )
      .limit(200),
  }));

  // The column appears only for a tenant with more than one company — ADR 0010:
  // the single-company client never learns the concept exists.
  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const showEntity = entities.length > 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal"
        description={
          // "Every entry in Test's books" is the TENANT's name, and at two
          // companies it reads as one company's ledger while the table beside
          // it shows a Company column with two different values in it. Found by
          // driving the live app after ADR 0010 slice 1 landed. The list itself
          // is unscoped and stays that way — the journal is where you see
          // everything; the reports are where you scope.
          entities.length > 1
            ? `Every entry across all ${entities.length} companies.`
            : `Every entry in ${ctx.tenant.name}'s books.`
        }
        actions={
          <Button asChild size="sm">
            <Link href="/dashboard/m/accounting/journal/new">New entry</Link>
          </Button>
        }
      />

      <AccountingNav />

      <DataTable
        isEmpty={entries.length === 0}
        empty={
          <EmptyState
            icon={<BookOpen />}
            title="Open the books"
            description="The first entry starts the ledger. Most entries arrive on their own, from invoices, bills and the bank feed."
            action={
              <Button asChild size="sm">
                <Link href="/dashboard/m/accounting/journal/new">
                  New entry
                </Link>
              </Button>
            }
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Memo</TableHead>
              {showEntity && <TableHead>Company</TableHead>}
              <TableHead className="hidden sm:table-cell">Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  <Link
                    className="hover:underline"
                    href={`/dashboard/m/accounting/journal/${e.id}`}
                  >
                    {e.entryDate}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <Link
                    className="block truncate hover:underline"
                    href={`/dashboard/m/accounting/journal/${e.id}`}
                  >
                    {e.memo || (
                      <span className="text-subtle-foreground">—</span>
                    )}
                  </Link>
                </TableCell>
                {showEntity && (
                  <TableCell className="text-xs text-muted-foreground">
                    {entityName.get(e.entityId) ?? "—"}
                  </TableCell>
                )}
                <TableCell className="hidden text-xs text-subtle-foreground sm:table-cell">
                  {e.source.replaceAll("_", " ")}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE[e.status] ?? "outline"}>
                    {e.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {formatCents(toSafeCents(e.totalDebits))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
