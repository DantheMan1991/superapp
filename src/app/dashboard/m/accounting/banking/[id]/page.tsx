import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getBalances, getSettings } from "@/modules/accounting/core";
import {
  formatCentsSigned,
  todayInTimezone,
} from "@/modules/accounting/lib/money";
import { findMatchCandidatesBatch } from "@/modules/accounting/banking/match";
import { readAiSuggestion } from "@/modules/accounting/banking/review";
import { RegisterTabs, ReviewTable, SuggestButton } from "./register-controls";

export const dynamic = "force-dynamic";

export default async function BankRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const tab = ["unreviewed", "all", "excluded"].includes(sp.tab ?? "")
    ? (sp.tab as "unreviewed" | "all" | "excluded")
    : "unreviewed";

  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;

  const data = await withTenant(tenantId, async (tx) => {
    const bankAccount = await tx.query.bankAccounts.findFirst({
      where: and(
        eq(schema.bankAccounts.tenantId, tenantId),
        eq(schema.bankAccounts.id, id),
      ),
    });
    if (!bankAccount) return null;
    const settings = await getSettings(tx, tenantId);
    const today = todayInTimezone(settings.bookkeepingTimezone);
    const [balance] = await getBalances(tx, tenantId, {
      asOf: today,
      accountIds: [bankAccount.accountId],
    });
    const txns = await tx.query.bankTransactions.findMany({
      where: and(
        eq(schema.bankTransactions.tenantId, tenantId),
        eq(schema.bankTransactions.bankAccountId, id),
        ...(tab === "all"
          ? []
          : [eq(schema.bankTransactions.status, tab)]),
      ),
      orderBy: [
        desc(schema.bankTransactions.txnDate),
        desc(schema.bankTransactions.createdAt),
      ],
      limit: 300,
    });
    const counts = await tx
      .select({
        status: schema.bankTransactions.status,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.bankTransactions)
      .where(
        and(
          eq(schema.bankTransactions.tenantId, tenantId),
          eq(schema.bankTransactions.bankAccountId, id),
        ),
      )
      .groupBy(schema.bankTransactions.status);
    const categories = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.isActive, true),
      ),
      orderBy: (a, { asc }) => [asc(a.code)],
    });
    // Existing-entry match candidates for the review tab (P12: a feed row
    // is satisfied by exactly one entry — categorize OR match).
    const unreviewedTxns = txns.filter((t) => t.status === "unreviewed");
    const matchCandidates = await findMatchCandidatesBatch(tx, tenantId, {
      ledgerAccountId: bankAccount.accountId,
      txns: unreviewedTxns.map((t) => ({
        id: t.id,
        amountCents: t.amountCents,
        txnDate: t.txnDate,
      })),
    });
    // Receipt attachment counts (session 5) — one grouped query.
    const attachmentCounts =
      txns.length > 0
        ? await tx
            .select({
              bankTransactionId: schema.documentLinks.bankTransactionId,
              n: sql<number>`count(*)::int`,
            })
            .from(schema.documentLinks)
            .where(
              and(
                eq(schema.documentLinks.tenantId, tenantId),
                inArray(
                  schema.documentLinks.bankTransactionId,
                  txns.map((t) => t.id),
                ),
              ),
            )
            .groupBy(schema.documentLinks.bankTransactionId)
        : [];
    return {
      bankAccount,
      balance,
      txns,
      counts,
      categories,
      matchCandidates,
      attachmentCounts,
    };
  });
  if (!data) notFound();
  const { bankAccount, txns, counts } = data;

  const countOf = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const net = data.balance?.netCents ?? 0;
  const display = bankAccount.kind === "credit_card" ? -net : net;
  const isOwner = ctx.role === "owner";

  const attachmentsOf = new Map(
    data.attachmentCounts.map((a) => [a.bankTransactionId, a.n]),
  );
  const rows = txns.map((t) => {
    const suggestion = readAiSuggestion(t);
    return {
      attachmentCount: attachmentsOf.get(t.id) ?? 0,
      id: t.id,
      txnDate: t.txnDate,
      description: t.description,
      amountCents: t.amountCents,
      status: t.status,
      journalEntryId: t.journalEntryId,
      source: t.source,
      suggestion: suggestion
        ? {
            accountId: suggestion.accountId,
            accountCode: suggestion.accountCode,
            confidence: suggestion.confidence,
            reason: suggestion.reason ?? null,
          }
        : null,
      matchCandidates: data.matchCandidates.get(t.id) ?? [],
    };
  });
  const categoryOptions = data.categories
    .filter((a) => a.id !== bankAccount.accountId)
    .map((a) => ({ id: a.id, code: a.code, name: a.name, accountType: a.accountType }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {bankAccount.name}
            </h1>
            {bankAccount.plaidItemId && (
              <Badge className="bg-emerald-600 hover:bg-emerald-600">connected</Badge>
            )}
            {!bankAccount.isActive && <Badge variant="outline">inactive</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {bankAccount.kind.replaceAll("_", " ")}
            {bankAccount.institution ? ` · ${bankAccount.institution}` : ""}
            {bankAccount.last4 ? ` ···· ${bankAccount.last4}` : ""} ·{" "}
            {bankAccount.kind === "credit_card" ? "owed" : "balance"}{" "}
            <span className="font-mono font-medium">{formatCentsSigned(display)}</span>
          </p>
        </div>
        {isOwner && (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard/m/accounting/banking/${id}/import`}>
                Import CSV
              </Link>
            </Button>
            <SuggestButton bankAccountId={id} disabled={countOf("unreviewed") === 0} />
            <Button asChild size="sm" variant="outline">
              <Link href={`/dashboard/m/accounting/banking/${id}/reconcile`}>
                Reconcile
              </Link>
            </Button>
          </div>
        )}
      </div>

      <AccountingNav />

      <RegisterTabs
        bankAccountId={id}
        active={tab}
        counts={{
          unreviewed: countOf("unreviewed"),
          all: counts.reduce((s, c) => s + c.n, 0),
          excluded: countOf("excluded"),
        }}
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {tab === "unreviewed"
              ? "Nothing to review — the feed is clear."
              : "No transactions here yet."}
          </CardContent>
        </Card>
      ) : (
        <ReviewTable
          tab={tab}
          rows={rows}
          categories={categoryOptions}
          canAct={isOwner}
        />
      )}
    </div>
  );
}
