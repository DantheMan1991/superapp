import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { ListSearch } from "@/components/app/list-search";
import { Pager } from "@/components/app/pager";
import { ilikePattern, pageFrom, pageWindow, searchTerm } from "@/lib/list-query";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getBalances, listDimensionMembers } from "@/modules/accounting/core";
import { dimensionTypesFrom } from "@/lib/dimension-options";
import {
  formatCents,
  formatCentsSigned,
  parseMoneyToCents,
  todayInTimezone,
} from "@/modules/accounting/lib/money";
import { findMatchCandidatesBatch } from "@/modules/accounting/banking/match";
import { readAiSuggestion } from "@/modules/accounting/banking/review";
import { readRuleSuggestion } from "@/modules/accounting/banking/rules";
import { listRegisterPayees } from "@/modules/accounting/banking/payees";
import {
  BankAccountActiveToggle,
  PayeeVendors,
  RegisterTabs,
  ReviewTable,
  SuggestButton,
  type RegisterPayeeView,
} from "./register-controls";

export const dynamic = "force-dynamic";

/**
 * Rows per page. Twice the other lists': a feed row is one line, and a
 * month of a busy account is about this many. The list used to stop dead at
 * 300 with no way past.
 */
const PAGE_SIZE = 100;

export default async function BankRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const tab = ["unreviewed", "all", "excluded"].includes(sp.tab ?? "")
    ? (sp.tab as "unreviewed" | "all" | "excluded")
    : "unreviewed";
  const term = searchTerm(sp.q);
  const pattern = term ? ilikePattern(term) : null;
  // `45.10`, `-45.10` or `(45.10)` also finds the rows for exactly that
  // amount, either direction — the one thing about a bank line everybody
  // remembers is the figure.
  const cents = term ? parseMoneyToCents(term.replace(/^[-(]|\)$/g, "")) : null;

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
    const today = todayInTimezone(ctx.tenant.timezone);
    const [balance] = await getBalances(tx, tenantId, {
      // Combined — see the register list page for why.
      scope: { kind: "combined" },
      asOf: today,
      accountIds: [bankAccount.accountId],
    });
    // The search reads the description as the bank gave it, the payee a
    // rule or a person set, and the amount. One predicate for the count and
    // the page, so "of 312" and the rows can never describe different lists.
    const rowWhere = and(
      eq(schema.bankTransactions.tenantId, tenantId),
      eq(schema.bankTransactions.bankAccountId, id),
      ...(tab === "all"
        ? []
        : [eq(schema.bankTransactions.status, tab)]),
      pattern
        ? or(
            ilike(schema.bankTransactions.description, pattern),
            exists(
              tx
                .select({ one: sql`1` })
                .from(schema.vendors)
                .where(
                  and(
                    eq(schema.vendors.tenantId, schema.bankTransactions.tenantId),
                    eq(schema.vendors.id, schema.bankTransactions.vendorId),
                    ilike(schema.vendors.name, pattern),
                  ),
                ),
            ),
            ...(cents !== null
              ? [sql`abs(${schema.bankTransactions.amountCents}) = ${cents}`]
              : []),
          )
        : undefined,
    );
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.bankTransactions)
      .where(rowWhere);
    const window = pageWindow(pageFrom(sp.page), PAGE_SIZE, total);
    // The core select, NOT `tx.query.bankTransactions.findMany`: the
    // relational API aliases the table (`"bankTransactions"`) while the
    // correlated `exists` above names the real one, and Postgres refuses the
    // reference ("invalid reference to FROM-clause entry"). The count query
    // never had the problem, because `select().from()` does not alias.
    const txns = await tx
      .select()
      .from(schema.bankTransactions)
      .where(rowWhere)
      .orderBy(
        desc(schema.bankTransactions.txnDate),
        desc(schema.bankTransactions.createdAt),
      )
      .limit(PAGE_SIZE)
      .offset(window.offset);
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
    // is satisfied by exactly one entry — categorize OR match — and an entry
    // by one row per register, which is how the other side of a transfer
    // gets offered here).
    const unreviewedTxns = txns.filter((t) => t.status === "unreviewed");
    const matchCandidates = await findMatchCandidatesBatch(tx, tenantId, {
      bankAccountId: bankAccount.id,
      ledgerAccountId: bankAccount.accountId,
      txns: unreviewedTxns.map((t) => ({
        id: t.id,
        amountCents: t.amountCents,
        txnDate: t.txnDate,
      })),
    });
    // Which posted rows posted their entry THEMSELVES, as opposed to
    // matching one: the difference between Undo (void the entry) and Unmatch
    // (unlink, entry stays), so the list can offer the one that works.
    const linkedEntryIds = txns
      .map((t) => t.journalEntryId)
      .filter((v): v is string => !!v);
    const linkedEntries =
      linkedEntryIds.length === 0
        ? []
        : await tx.query.journalEntries.findMany({
            where: and(
              eq(schema.journalEntries.tenantId, tenantId),
              inArray(schema.journalEntries.id, linkedEntryIds),
            ),
            columns: { id: true, source: true, sourceId: true },
          });
    // Every active register: the same company's are offered as transfers,
    // and none of them is offered as a plain category.
    const registers = await tx.query.bankAccounts.findMany({
      where: and(
        eq(schema.bankAccounts.tenantId, tenantId),
        eq(schema.bankAccounts.isActive, true),
      ),
      columns: { id: true, accountId: true, name: true, entityId: true },
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
    // Payee names for the rows that have one — one query, not one per row.
    const vendorIds = [
      ...new Set(txns.map((t) => t.vendorId).filter((v): v is string => !!v)),
    ];
    const vendorRows =
      vendorIds.length === 0
        ? []
        : await tx.query.vendors.findMany({
            where: and(
              eq(schema.vendors.tenantId, tenantId),
              inArray(schema.vendors.id, vendorIds),
            ),
            columns: { id: true, name: true },
          });
    // Unfiltered on purpose — `dimensionTypesFrom` owns the active-only rule,
    // so no screen can forget it.
    const dimensionMembers = await listDimensionMembers(tx, tenantId);
    // The payees nobody has named yet, over the WHOLE register rather than the
    // page being shown: the question is about the statement, not the window.
    const payees = await listRegisterPayees(tx, tenantId, id);
    return {
      bankAccount,
      balance,
      txns,
      counts,
      categories,
      matchCandidates,
      attachmentCounts,
      vendorRows,
      dimensionMembers,
      registers,
      linkedEntries,
      window,
      payees,
    };
    // The role travels with the read: a personal register and its rows are
    // visible to owners and the accountant only (drizzle/0279, ADR 0034).
    // Without it this page would 404 for the owner who created the account.
  }, { role: ctx.role, userId: ctx.userId });
  if (!data) notFound();
  const { bankAccount, txns, counts } = data;

  // The pager keeps the tab and the search term. Only a page past the first
  // is written, so page one's URL is the plain one the tabs link to.
  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    if (tab !== "unreviewed") p.set("tab", tab);
    if (term) p.set("q", term);
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return `/dashboard/m/accounting/banking/${id}${s ? `?${s}` : ""}`;
  };

  const countOf = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const personal = bankAccount.kind === "personal";
  const net = data.balance?.netCents ?? 0;
  // A card shows what is owed, and a personal register what the owner has
  // put in net of what they took out (ADR 0034) — both are the credit side
  // read as a positive figure.
  const display = bankAccount.kind === "credit_card" || personal ? -net : net;
  const isOwner = ctx.role === "owner";
  // Money is formatted on the server, so the dialog stays a dumb renderer.
  const payees: RegisterPayeeView[] = data.payees.map((p) => ({
    phrase: p.phrase,
    label: p.label,
    count: p.count,
    sample: p.sample,
    totalLabel: formatCents(p.totalCents),
    existingVendorId: p.existingVendorId,
    existingVendorName: p.existingVendorName,
  }));

  const attachmentsOf = new Map(
    data.attachmentCounts.map((a) => [a.bankTransactionId, a.n]),
  );
  const vendorName = new Map(data.vendorRows.map((v) => [v.id, v.name]));
  const entryById = new Map(data.linkedEntries.map((e) => [e.id, e]));
  const rows = txns.map((t) => {
    const suggestion = readAiSuggestion(t);
    const rule = readRuleSuggestion(t);
    const linked = t.journalEntryId ? entryById.get(t.journalEntryId) : undefined;
    return {
      attachmentCount: attachmentsOf.get(t.id) ?? 0,
      id: t.id,
      txnDate: t.txnDate,
      description: t.description,
      amountCents: t.amountCents,
      status: t.status,
      journalEntryId: t.journalEntryId,
      postedHere: linked?.source === "bank_import" && linked.sourceId === t.id,
      source: t.source,
      suggestion: suggestion
        ? {
            accountId: suggestion.accountId,
            accountCode: suggestion.accountCode,
            confidence: suggestion.confidence,
            reason: suggestion.reason ?? null,
            personal: suggestion.personal === true,
          }
        : null,
      ruleSuggestion: rule
        ? {
            ruleName: rule.ruleName,
            accountId: rule.accountId,
            accountCode: rule.accountCode,
            action: rule.action ?? "categorize",
          }
        : null,
      payee: t.vendorId ? (vendorName.get(t.vendorId) ?? null) : null,
      matchCandidates: data.matchCandidates.get(t.id) ?? [],
    };
  });
  const dimensionTypes = dimensionTypesFrom(data.dimensionMembers);

  /**
   * A register's ledger account is never a CATEGORY. Coding a feed row to
   * another bank account is a transfer, so the same company's other
   * registers are offered as `Transfer to/from …` at the end of the picker
   * instead, and another company's are not offered at all — `postEntry`
   * refuses a line on a foreign register, and money between two companies
   * is recorded from the Companies page as a linked pair.
   */
  const registerAccountIds = new Set(data.registers.map((r) => r.accountId));
  const categoryOptions = data.categories
    .filter((a) => !registerAccountIds.has(a.id))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, accountType: a.accountType }));
  const transferTargets = data.registers
    .filter((r) => r.id !== bankAccount.id && r.entityId === bankAccount.entityId)
    .map((r) => ({ accountId: r.accountId, name: r.name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={bankAccount.name}
        description={
          <>
            {personal ? "personal account" : bankAccount.kind.replaceAll("_", " ")}
            {bankAccount.institution ? ` · ${bankAccount.institution}` : ""}
            {bankAccount.last4 ? ` ···· ${bankAccount.last4}` : ""} ·{" "}
            {bankAccount.kind === "credit_card"
              ? "owed"
              : personal
                ? "put in by you, net"
                : "balance"}{" "}
            <span className="font-mono font-medium tabular-nums">
              {formatCentsSigned(display)}
            </span>
          </>
        }
        actions={
          <>
            {bankAccount.plaidItemId && (
              <Badge className="bg-success/12 text-success-foreground hover:bg-success/12">
                connected
              </Badge>
            )}
            {!bankAccount.isActive && <Badge variant="outline">closed</Badge>}
            {isOwner && (
              <>
                {/* A closed register takes nothing new, so the controls that
                    would create something are not offered — the server refuses
                    them anyway, and a button that always errors is worse than
                    no button. Reopening is the one thing left to do. */}
                {bankAccount.isActive && (
                  <>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/dashboard/m/accounting/banking/${id}/import`}>
                        Import CSV
                      </Link>
                    </Button>
                    <SuggestButton
                      bankAccountId={id}
                      disabled={countOf("unreviewed") === 0}
                    />
                    {/* A personal register is never reconciled: its statement
                        balance is the owner's, and only the business's lines
                        ever posted. The server refuses it too (ADR 0034). */}
                    {!personal && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/dashboard/m/accounting/banking/${id}/reconcile`}>
                          Reconcile
                        </Link>
                      </Button>
                    )}
                  </>
                )}
                <BankAccountActiveToggle
                  bankAccountId={id}
                  version={bankAccount.version}
                  active={bankAccount.isActive}
                />
              </>
            )}
          </>
        }
      />

      <AccountingNav />

      {/* What this register IS, stated on the page that works it, because the
          verbs below mean something different here: Post is "this one is the
          business's", Personal is "this one is mine". */}
      {personal && (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            Your own account, with some of the business&apos;s money running
            through it. Only the lines you post reach the books, as money you put
            in or took out. Everything you set aside as personal stays out of
            them: never counted, never reported, and never seen by staff.
          </CardContent>
        </Card>
      )}

      {!bankAccount.isActive && (
        <Card className="border-warning/40 bg-warning/8">
          <CardContent className="py-3 text-sm">
            This account is closed. Everything already in the books stays, and
            you can still read and tidy the list below — but nothing new posts
            to it until you reopen it.
          </CardContent>
        </Card>
      )}

      {/* The Vendors list filling itself out of a statement just imported
          (onboarding slice 2b). Owners only, and gone once every payee has a
          name. */}
      {isOwner && payees.length > 0 && (
        <PayeeVendors bankAccountId={id} payees={payees} />
      )}

      <div className="flex justify-end">
        <ListSearch placeholder="Search description, payee or amount" />
      </div>

      <RegisterTabs
        bankAccountId={id}
        active={tab}
        term={term}
        personal={personal}
        counts={{
          unreviewed: countOf("unreviewed"),
          all: counts.reduce((s, c) => s + c.n, 0),
          excluded: countOf("excluded"),
        }}
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {term
              ? `Nothing matches “${term}”. Try fewer words, or clear the search.`
              : tab === "unreviewed"
                ? personal
                  ? "Nothing to review — everything is sorted."
                  : "Nothing to review — the feed is clear."
                : "No transactions here yet."}
          </CardContent>
        </Card>
      ) : (
        <ReviewTable
          tab={tab}
          rows={rows}
          categories={categoryOptions}
          transferTargets={transferTargets}
          dimensionTypes={dimensionTypes}
          canAct={isOwner}
          personal={personal}
        />
      )}

      <Pager
        window={data.window}
        noun={{ one: "transaction", many: "transactions" }}
        hrefFor={pageHref}
      />
    </div>
  );
}
