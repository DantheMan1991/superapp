import { and, eq, sql } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
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
import {
  ActiveToggle,
  AddCompanyButton,
  MakeDefaultButton,
  RenameButton,
} from "./companies-controls";

export const dynamic = "force-dynamic";

/**
 * The companies whose books this client keeps (ADR 0010).
 *
 * Reachable from one Companies card on the accounting hub rather than an
 * eleventh tab in `AccountingNav` — that strip was rebuilt because ten tabs
 * already wrapped onto two lines, and most tenants have exactly one company
 * for ever. The page still exists at one, because adding the second is how a
 * tenant ever gets to two.
 */
export default async function CompaniesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const { entities, entryCounts } = await withTenant(ctx.tenant.id, async (tx) => ({
    entities: await listEntities(tx, ctx.tenant.id, { includeInactive: true }),
    // How many entries each set of books holds — the figure that says whether
    // deactivating one would strand anything.
    entryCounts: await tx
      .select({
        entityId: schema.journalEntries.entityId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.tenantId, ctx.tenant.id),
          eq(schema.journalEntries.status, "posted"),
        ),
      )
      .groupBy(schema.journalEntries.entityId),
  }));

  const countOf = new Map(entryCounts.map((r) => [r.entityId, r.n]));
  const isOwner = ctx.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description="Each company keeps its own books — its own trial balance, profit & loss and balance sheet. The chart of accounts, customers, vendors and contacts are shared across all of them."
        icon={<Building2 />}
        actions={isOwner ? <AddCompanyButton /> : undefined}
      />

      <AccountingNav />

      {entities.length > 1 && (
        // Said once, on the only screen where somebody is thinking about it.
        // The rest of the module has no place to explain this and no reason to.
        <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Reports carry a <strong className="font-medium">Company</strong>{" "}
          control, and every statement and export says which one it covers.
          Invoices, bills and bank transactions all post to the default company
          for now — a journal entry is the one thing that can name another.
        </div>
      )}

      <DataTable isEmpty={false}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead className="hidden sm:table-cell">Legal name</TableHead>
              <TableHead className="text-right">Posted entries</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entities.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-sm font-medium">
                  {e.name}
                  {e.isDefault && (
                    <Badge variant="secondary" className="ml-2">
                      Default
                    </Badge>
                  )}
                  {!e.isActive && (
                    <Badge variant="outline" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                  {e.legalName || <span className="text-subtle-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {countOf.get(e.id) ?? 0}
                </TableCell>
                <TableCell className="text-right">
                  {isOwner && (
                    <div className="flex justify-end gap-1">
                      <RenameButton
                        entityId={e.id}
                        name={e.name}
                        legalName={e.legalName}
                      />
                      {!e.isDefault && e.isActive && (
                        <MakeDefaultButton entityId={e.id} name={e.name} />
                      )}
                      {!e.isDefault && (
                        <ActiveToggle
                          entityId={e.id}
                          name={e.name}
                          isActive={e.isActive}
                        />
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
