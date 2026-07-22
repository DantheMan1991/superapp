import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
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
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { DocumentAttachments } from "@/modules/accounting/components/document-attachments";
import { getSettings } from "@/modules/accounting/core";
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
    return { entry, lines, accounts, settings, reversal };
  });
  if (!data) notFound();
  const { entry, lines, accounts, settings, reversal } = data;

  const isOwner = ctx.role === "owner";
  const inClosedPeriod =
    !!settings.closedThrough && entry.entryDate <= settings.closedThrough;
  const canMutatePosted =
    settings.entryEditPolicy === "standard" && !inClosedPeriod;
  const editing =
    edit === "1" &&
    isOwner &&
    (entry.status === "draft" || (entry.status === "posted" && canMutatePosted));

  const totalDebits = lines
    .filter((l) => l.amountCents > 0)
    .reduce((a, l) => a + l.amountCents, 0);
  const totalCredits = lines
    .filter((l) => l.amountCents < 0)
    .reduce((a, l) => a - l.amountCents, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Journal entry
            </h1>
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
          </div>
          <p className="text-sm text-muted-foreground">
            {entry.entryDate} · {entry.source.replaceAll("_", " ")}
            {entry.memo ? ` · ${entry.memo}` : ""}
          </p>
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
        {!editing && (
          <div className="flex items-center gap-2">
            {isOwner &&
              (entry.status === "draft" ||
                (entry.status === "posted" && canMutatePosted && !reversal)) && (
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
          </div>
        )}
      </div>

      <AccountingNav />

      {editing ? (
        <>
          {entry.status === "posted" && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              You are editing a posted entry. The change takes effect
              immediately and the before/after is recorded in the audit log.
            </p>
          )}
          <EntryEditor
            accounts={accounts}
            canPost={isOwner}
            today={todayInTimezone(settings.bookkeepingTimezone)}
            entry={{
              id: entry.id,
              version: entry.version,
              entryDate: entry.entryDate,
              memo: entry.memo,
              lines: lines.map((l) => ({
                accountId: l.accountId,
                amountCents: l.amountCents,
                memo: l.memo,
              })),
            }}
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
