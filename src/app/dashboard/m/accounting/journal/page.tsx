import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
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

  const entries = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({
        id: schema.journalEntries.id,
        entryDate: schema.journalEntries.entryDate,
        memo: schema.journalEntries.memo,
        status: schema.journalEntries.status,
        source: schema.journalEntries.source,
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
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
          <p className="text-sm text-muted-foreground">
            Every entry in {ctx.tenant.name}&apos;s books.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/dashboard/m/accounting/journal/new">New entry</Link>
        </Button>
      </div>

      <AccountingNav />

      <Card>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No entries yet. Create the first one to start the books.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Memo</TableHead>
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
                        {e.memo || <span className="text-muted-foreground">—</span>}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {e.source.replaceAll("_", " ")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[e.status] ?? "outline"}>
                        {e.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCents(toSafeCents(e.totalDebits))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
