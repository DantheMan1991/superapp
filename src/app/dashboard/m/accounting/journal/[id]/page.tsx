import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { DocumentAttachments } from "@/modules/accounting/components/document-attachments";
import {
  getClosedThrough,
  getSettings,
  listDimensionMembers,
  listEntities,
} from "@/modules/accounting/core";
import { dimensionTypesFrom } from "@/lib/dimension-options";
import { formatCents, todayInTimezone } from "@/modules/accounting/lib/money";
import { EntryActions } from "../entry-actions";
import { EntryEditor } from "../entry-editor";

export const dynamic = "force-dynamic";

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const entry = await tx.query.journalEntries.findFirst({
      where: and(
        eq(schema.journalEntries.tenantId, ctx.tenant.id),
        eq(schema.journalEntries.id, id),
      ),
    });
    if (!entry) return null;
    const lines = await tx
      .select({
        id: schema.journalLines.id,
        accountId: schema.journalLines.accountId,
        amountCents: schema.journalLines.amountCents,
        memo: schema.journalLines.memo,
        lineNo: schema.journalLines.lineNo,
        accountCode: schema.accounts.code,
        accountName: schema.accounts.name,
      })
      .from(schema.journalLines)
      .innerJoin(
        schema.accounts,
        and(
          eq(schema.accounts.tenantId, schema.journalLines.tenantId),
          eq(schema.accounts.id, schema.journalLines.accountId),
        ),
      )
      .where(
        and(
          eq(schema.journalLines.tenantId, ctx.tenant.id),
          eq(schema.journalLines.entryId, id),
        ),
      )
      .orderBy(asc(schema.journalLines.lineNo));
    /**
     * The tags on those lines. `editEntry` deletes every line and re-inserts
     * it, so `line_dimensions` cascades away — a tag the form does not carry
     * through is a tag deleted by the next save, which is the same trap the
     * invoice and bill builders each had to be shown the compiler to avoid.
     *
     * They are read for the READ-ONLY table too. An entry that can be tagged
     * and cannot be seen to be tagged is half a feature, and this table is how
     * anybody checks what a correction actually did.
     */
    const dims =
      lines.length === 0
        ? []
        : await tx
            .select({
              journalLineId: schema.lineDimensions.journalLineId,
              memberId: schema.lineDimensions.memberId,
            })
            .from(schema.lineDimensions)
            .where(
              and(
                eq(schema.lineDimensions.tenantId, ctx.tenant.id),
                inArray(
                  schema.lineDimensions.journalLineId,
                  lines.map((l) => l.id),
                ),
              ),
            );
    const accounts = await tx
      .select({
        id: schema.accounts.id,
        code: schema.accounts.code,
        name: schema.accounts.name,
        accountType: schema.accounts.accountType,
      })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.tenantId, ctx.tenant.id),
          eq(schema.accounts.isActive, true),
        ),
      )
      .orderBy(asc(schema.accounts.code));
    const settings = await getSettings(tx, ctx.tenant.id);
    const reversal = entry.reversesEntryId
      ? null
      : await tx.query.journalEntries.findFirst({
          where: and(
            eq(schema.journalEntries.tenantId, ctx.tenant.id),
            eq(schema.journalEntries.reversesEntryId, id),
          ),
        });
    // Register ownership, so an EDIT offers the same accounts a create does.
    // The entry's company is fixed, so the filter is exact here.
    const registers = await tx.query.bankAccounts.findMany({
      where: eq(schema.bankAccounts.tenantId, ctx.tenant.id),
      columns: { accountId: true, entityId: true },
    });
    const ownerOf = new Map(registers.map((r) => [r.accountId, r.entityId]));
    return {
      entry,
      lines: lines.map((l) => ({
        ...l,
        dimensionMemberIds: dims
          .filter((d) => d.journalLineId === l.id)
          .map((d) => d.memberId),
      })),
      // Unfiltered: `dimensionTypesFrom` owns the active-only rule.
      dimensionMembers: await listDimensionMembers(tx, ctx.tenant.id),
      accounts: accounts.map((a) => ({
        ...a,
        ...(ownerOf.has(a.id) ? { registerEntityId: ownerOf.get(a.id)! } : {}),
      })),
      settings,
      closedThrough: await getClosedThrough(tx, ctx.tenant.id, entry.entityId),
      // WHICH COMPANY'S BOOKS this entry is in. The journal LIST grew a Company
      // column in slice 1 and the detail page never did — so a two-company
      // tenant could open an entry and not be told whose books it belongs to,
      // on the page where they void and reverse it. Undefined at one company.
      companyName: await (async () => {
        const entities = await listEntities(tx, ctx.tenant.id, {
          includeInactive: true,
        });
        return entities.length > 1
          ? (entities.find((e) => e.id === entry.entityId)?.name ?? null)
          : null;
      })(),
      reversal,
    };
  });
  if (!data) notFound();
  const { entry, lines, accounts, settings, reversal } = data;

  const isOwner = ctx.role === "owner";
  // THE ENTRY'S OWN COMPANY decides whether it sits in a closed period (ADR
  // 0010 slice 4) — a tenant-wide date would lock an entry whose books are open.
  const inClosedPeriod =
    !!data.closedThrough && entry.entryDate <= data.closedThrough;
  const canMutatePosted =
    settings.entryEditPolicy === "standard" && !inClosedPeriod;
  const editing =
    edit === "1" &&
    isOwner &&
    (entry.status === "draft" || (entry.status === "posted" && canMutatePosted));

  /**
   * What to call each member on screen. Retired ones are in here too — an
   * entry posted last spring under a line of business since wound up still has
   * to read as what it was.
   */
  const memberName = new Map(
    data.dimensionMembers.map((m) => [m.id, m.displayName]),
  );

  const totalDebits = lines
    .filter((l) => l.amountCents > 0)
    .reduce((a, l) => a + l.amountCents, 0);
  const totalCredits = lines
    .filter((l) => l.amountCents < 0)
    .reduce((a, l) => a - l.amountCents, 0);

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Journal entry"
          description={
            <>
              {data.companyName ? `${data.companyName} · ` : ""}
              {entry.entryDate} · {entry.source.replaceAll("_", " ")}
              {entry.memo ? ` · ${entry.memo}` : ""}
            </>
          }
          actions={
            <>
              <Badge
                variant={
                  entry.status === "posted"
                    ? "default"
                    : entry.status === "draft"
                      ? "secondary"
                      : "outline"
                }
              >
                {entry.status}
              </Badge>
              {inClosedPeriod && <Badge variant="outline">closed period</Badge>}
              {!editing && (
                <>
                  {isOwner &&
                    (entry.status === "draft" ||
                      (entry.status === "posted" &&
                        canMutatePosted &&
                        !reversal)) && (
                      <a
                        className="text-sm font-medium underline underline-offset-2"
                        href={`/dashboard/m/accounting/journal/${entry.id}?edit=1`}
                      >
                        Edit
                      </a>
                    )}
                  <EntryActions
                    entryId={entry.id}
                    version={entry.version}
                    status={entry.status}
                    canPost={isOwner}
                    canMutatePosted={canMutatePosted && !reversal}
                  />
                </>
              )}
            </>
          }
        />
        <div className="mt-1">
          {entry.reversesEntryId && (
            <p className="mt-1 text-xs text-muted-foreground">
              Reversal of{" "}
              <a
                className="underline underline-offset-2"
                href={`/dashboard/m/accounting/journal/${entry.reversesEntryId}`}
              >
                this entry
              </a>
              .
            </p>
          )}
          {reversal && (
            <p className="mt-1 text-xs text-muted-foreground">
              Reversed by{" "}
              <a
                className="underline underline-offset-2"
                href={`/dashboard/m/accounting/journal/${reversal.id}`}
              >
                this entry
              </a>
              .
            </p>
          )}
        </div>
      </div>

      <AccountingNav />

      {editing ? (
        <>
          {entry.status === "posted" && (
            <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
              You are editing a posted entry. The change takes effect
              immediately and the before/after is recorded in the audit log.
            </p>
          )}
          <EntryEditor
            accounts={accounts}
            canPost={isOwner}
            today={todayInTimezone(ctx.tenant.timezone)}
            entry={{
              id: entry.id,
              version: entry.version,
              entityId: entry.entityId,
              entryDate: entry.entryDate,
              memo: entry.memo,
              lines: lines.map((l) => ({
                accountId: l.accountId,
                amountCents: l.amountCents,
                memo: l.memo,
                dimensionMemberIds: l.dimensionMemberIds,
              })),
            }}
            /* Plus whatever these lines already hold, retired or not.
               `postEntry` refuses an inactive member on every write, so without
               this a retired tag makes the entry unsaveable with nothing on
               screen to change. */
            dimensionTypes={dimensionTypesFrom(data.dimensionMembers, {
              keepIds: lines.flatMap((l) => l.dimensionMemberIds),
            })}
          />
        </>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="hidden sm:table-cell">Memo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-sm">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {l.accountCode}
                      </span>
                      {l.accountName}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {l.amountCents > 0 ? formatCents(l.amountCents) : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {l.amountCents < 0 ? formatCents(-l.amountCents) : ""}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {l.memo}
                      {l.dimensionMemberIds.length > 0 && (
                        <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                          {l.dimensionMemberIds.map((id) => (
                            <span
                              key={id}
                              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground"
                            >
                              {memberName.get(id) ?? "—"}
                            </span>
                          ))}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell className="text-sm">Total</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCents(totalDebits)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatCents(totalCredits)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell" />
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <DocumentAttachments
        tenantId={ctx.tenant.id}
        target={{ type: "entry", id: entry.id }}
      />
    </div>
  );
}
