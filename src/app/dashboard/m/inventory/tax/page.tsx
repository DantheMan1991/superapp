import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTaxRules, taxRuleCoverage } from "@/packs/inventory/ops";
import { TIMING_RULE_LABELS } from "@/packs/inventory/core/tax-rules";
import { slugLabel } from "@/packs/inventory/vocabulary";
import { TaxRuleForm } from "@/packs/inventory/components/tax-rule-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/inventory";

/**
 * **WHERE AN ACCOUNTANT'S DECISION GETS RECORDED.**
 * [ADR 0013](../../../../../../docs/decisions/0013-inventory-tax-treatment.md).
 *
 * **NOTHING ON THIS PAGE CHANGES A REPORT YET**, and the page says so rather
 * than implying otherwise. Stage 1 is the record and the resolution; the lens
 * that applies anything other than "when it is used" is the next slice. A screen
 * that quietly suggested it was already working would be the exact failure the
 * ADR exists to prevent — a setting that is plausible, balanced and wrong.
 *
 * **BUILT FROM THE CATEGORIES THE BUSINESS ACTUALLY HOLDS**, not from the
 * suggested list. `item_kind` is an open taxonomy, so a farm that typed
 * `bedding` has a category the vocabulary has never heard of, and a page built
 * from suggestions would leave it out of the one place somebody checks.
 */
export default async function InventoryTaxPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "inventory");
  const today = todayInTimezone(ctx.tenant.timezone);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [coverage, rules, accounts] = await Promise.all([
        taxRuleCoverage(tx, ctx.tenant.id),
        listTaxRules(tx, ctx.tenant.id),
        tx
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
          .orderBy(schema.accounts.code),
      ]);
      return { coverage, rules, accounts };
    },
    { role: ctx.role },
  );

  const isOwner = ctx.role === "owner";
  const byKind = new Map(data.rules.map((r) => [r.itemKind, r]));
  const accountChoices = data.accounts
    .filter((a) => a.accountType === "expense")
    .map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }));
  const accountNames = new Map(
    data.accounts.map((a) => [a.id, `${a.code} · ${a.name}`]),
  );
  const recorded = data.rules.length;

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        All inventory
      </Link>

      <PageHeader
        title="When stock is deducted"
        description="What an accountant decided about each kind of thing you hold, and where it is written down."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {/* **THIS CARD SAID "does not change your reports yet" UNTIL THE
                LENS SHIPPED, and it kept saying it after.** Caught by opening
                the page an hour later. A screen that under-claims is not the
                safe direction: somebody reading it would set a rule believing
                it was inert, and their cash-basis reports would move. */}
            What this changes, and what it does not
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Anything set to <strong>when it is used</strong> leaves your reports
            exactly as they are, and that is where every category starts.
          </p>
          <p>
            Set a category to <strong>when it is paid for</strong>{" "}
            and your cash-basis reports change: that stock stops appearing on the balance
            sheet, and its cost lands on the day the supplier&apos;s bill was
            paid, under the account named beside it.{" "}
            <strong>Your accrual reports are untouched</strong> — the books are
            the books.
          </p>
          <p>
            {/* The whole reason the setting exists: the software must not hold
                an opinion about a tax election. ADR 0013. */}
            The software does not have a view on which answer is right for your
            business. It offers the moments it can put a date on, and your
            accountant picks.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">
          By category {recorded > 0 && `· ${recorded} recorded`}
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>What</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead>Deducted</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Decided by</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.coverage.map((row) => {
              const stored = byKind.get(row.itemKind) ?? null;
              const isDefault = row.itemKind === null;
              return (
                <TableRow key={row.itemKind ?? "__default__"}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {isDefault ? "Everything else" : slugLabel(row.itemKind!)}
                      {/* Says WHERE the answer came from. A category with no row
                          of its own inherits, and a person checking their
                          accountant's decision needs to see that rather than a
                          value with no provenance. */}
                      {row.resolved.source === "tenant_default" && !isDefault && (
                        <Badge variant="outline">inherited</Badge>
                      )}
                      {row.resolved.source === "built_in" && (
                        <Badge variant="outline">not decided</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {isDefault ? "—" : row.items}
                  </TableCell>
                  <TableCell>
                    {TIMING_RULE_LABELS[row.resolved.timingRule]}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.resolved.expenseAccountId
                      ? (accountNames.get(row.resolved.expenseAccountId) ?? "—")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {stored?.decidedBy ? (
                      <>
                        {stored.decidedBy}
                        {stored.decidedOn && (
                          <div className="text-xs">{stored.decidedOn}</div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isOwner && (
                      <TaxRuleForm
                        itemKind={row.itemKind}
                        current={
                          stored
                            ? {
                                timingRule: stored.timingRule,
                                expenseAccountId: stored.expenseAccountId,
                                decidedBy: stored.decidedBy,
                                decidedOn: stored.decidedOn,
                                notes: stored.notes,
                              }
                            : null
                        }
                        accounts={accountChoices}
                        today={today}
                        trigger={stored ? "Edit" : "Record"}
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {data.coverage.length === 1 && (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No items yet, so there are no categories to decide about. The default
            row above is what a new one will inherit.
          </p>
        )}
      </div>
    </div>
  );
}
