import { and, asc, eq, sql } from "drizzle-orm";
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
import { affiliateBalances, listEntities } from "@/modules/accounting/core";
import { formatCentsSigned, todayInTimezone } from "@/modules/accounting/lib/money";
import {
  ActiveToggle,
  AddCompanyButton,
  MakeDefaultButton,
  RenameButton,
} from "./companies-controls";
import { TransferButton } from "./transfer-controls";

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

  const {
    entities,
    entryCounts,
    owed,
    registers,
    today,
    codable,
    allRegisterAccountIds,
  } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
    entities: await listEntities(tx, ctx.tenant.id, { includeInactive: true }),
    // Who owes whom, walked from the intercompany links rather than held in
    // ninety accounts (ADR 0010 slice 2).
    owed: await affiliateBalances(tx, ctx.tenant.id),
    // ACTIVE registers, for the "paid from" and "cash in" choices.
    registers: await tx.query.bankAccounts.findMany({
      where: and(
        eq(schema.bankAccounts.tenantId, ctx.tenant.id),
        eq(schema.bankAccounts.isActive, true),
      ),
    }),
    /**
     * EVERY register, active or not, purely to exclude them from "what did
     * they get".
     *
     * The first cut excluded only the ACTIVE ones, so a DEACTIVATED register
     * belonging to another company stayed in the list — and `postEntry` refuses
     * it, because the guard does not care whether a register is active. Found
     * by driving it: Oak Row was offered Test's retired "Rules Test Checking".
     * Deactivating a register does not stop it being somebody's.
     */
    allRegisterAccountIds: (
      await tx.query.bankAccounts.findMany({
        where: eq(schema.bankAccounts.tenantId, ctx.tenant.id),
        columns: { accountId: true },
      })
    ).map((r) => r.accountId),
    today: todayInTimezone(ctx.tenant.timezone),
    // What the receiving side may have got, other than cash. Registers are
    // offered separately and per company, so they are excluded here along with
    // the two affiliate accounts — naming one of those as "what they got" would
    // put the affiliate leg on both sides of the same entry.
    codable: await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, ctx.tenant.id),
        eq(schema.accounts.isActive, true),
      ),
      orderBy: asc(schema.accounts.code),
    }),
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
  }),
  );

  const countOf = new Map(entryCounts.map((r) => [r.entityId, r.n]));
  const isOwner = ctx.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description="Each company keeps its own books — its own trial balance, profit & loss and balance sheet. The chart of accounts, customers, vendors and contacts are shared across all of them."
        icon={<Building2 />}
        actions={
          isOwner ? (
            <div className="flex flex-wrap gap-2">
              {/* Only at two: with one company there is nowhere to move it to. */}
              {entities.length > 1 && (
                <TransferButton
                  registers={registers.map((r) => ({
                    ledgerAccountId: r.accountId,
                    name: r.name,
                    entityId: r.entityId,
                    entityName:
                      entities.find((e) => e.id === r.entityId)?.name ?? "—",
                  }))}
                  companies={entities
                    .filter((e) => e.isActive)
                    .map((e) => ({ id: e.id, name: e.name }))}
                  accounts={codable
                    .filter(
                      (a) =>
                        !allRegisterAccountIds.includes(a.id) &&
                        a.subtype !== "due_from_affiliate" &&
                        a.subtype !== "due_to_affiliate",
                    )
                    .map((a) => ({ id: a.id, code: a.code, name: a.name }))}
                  today={today}
                />
              )}
              <AddCompanyButton />
            </div>
          ) : undefined
        }
      />

      <AccountingNav />

      {entities.length > 1 && (
        // Said once, on the only screen where somebody is thinking about it.
        // The rest of the module has no place to explain this and no reason to.
        <div className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Reports carry a <strong className="font-medium">Company</strong>{" "}
          control, and every statement and export says which one it covers.
          Invoices, bills and bank accounts each belong to one company, and
          money moving between two of them is recorded on both sides at once.
        </div>
      )}

      {/*
        WHO OWES WHOM, and the reason one shared account per side is enough.
        The balance sheet says "Due from Affiliates 12,400"; this says from
        whom, walked from the links. Shown only when there is something to
        show — a permanently empty card would be furniture.
      */}
      {owed.length > 0 && (
        <DataTable isEmpty={false}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Owed by / to</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owed.map((r) => {
                const self = entities.find((e) => e.id === r.entityId);
                const other = entities.find(
                  (e) => e.id === r.counterpartyEntityId,
                );
                return (
                  <TableRow key={`${r.entityId}-${r.counterpartyEntityId}`}>
                    <TableCell className="text-sm font-medium">
                      {self?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.netCents > 0 ? "is owed by " : "owes "}
                      {other?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {formatCentsSigned(Math.abs(r.netCents))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTable>
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
