import Link from "next/link";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
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
import { valueStock } from "@/packs/inventory/ops";
import { AsOfPicker } from "@/packs/inventory/components/valuation-controls";
import { VALUATION_METHOD_NOTES } from "@/packs/inventory/vocabulary";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/inventory";

/**
 * **WHAT THE SHELF IS WORTH.**
 *
 * The page that finally answers the third of the design's three layers —
 * quantities, cost accumulation, and financial presentation. Nothing here posts
 * to the ledger; this is the number a posting WOULD write, on a screen where a
 * person can disagree with it first.
 *
 * **THE INCOMPLETE BANNER IS THE POINT OF THE PAGE, not a warning bolted onto
 * it.** A total on its own cannot be checked — "$4,200" reads identically
 * whether it covers the whole farm or everything except three pens of birds
 * nobody costed. If a later change moves the total somewhere the caveat does not
 * follow, that is the defect.
 */
export default async function InventoryValuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "inventory");

  const today = todayInTimezone(ctx.tenant.timezone);
  const currencySymbol = ctx.tenant.currencySymbol;
  // A balance sheet is always as of a day. Defaulting to today is the ordinary
  // case; the picker exists because the interesting question is usually about a
  // period end that has already passed.
  const asOf = typeof query.asOf === "string" && query.asOf ? query.asOf : today;

  const valuation = await withTenant(
    ctx.tenant.id,
    (tx) => valueStock(tx, ctx.tenant.id, { asOf }),
    { role: ctx.role },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="What it is worth"
        description="The cost standing in stock on hand. Not what it would sell for — what it cost to have."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AsOfPicker asOf={asOf} today={today} />
            <Link
              href={BASE}
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Inventory
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              On hand at {asOf}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatMoney(valuation.total.valueCents, currencySymbol)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {valuation.total.valuedLines === 0
                ? "Nothing on hand that anybody has costed."
                : `Across ${valuation.total.valuedLines} ${
                    valuation.total.valuedLines === 1 ? "line" : "lines"
                  } of stock.`}
            </p>
          </CardContent>
        </Card>

        <Card
          className={valuation.total.incomplete ? "border-destructive/40" : ""}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              What this figure leaves out
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* NEVER LET THE TOTAL TRAVEL ALONE. Understated by an unknown
                amount is a different fact from understated by nothing. */}
            {valuation.total.incomplete ? (
              <>
                <div className="flex items-center gap-2 text-2xl font-semibold tabular-nums text-destructive">
                  <TriangleAlert className="h-5 w-5" />
                  {valuation.total.unvaluedLines}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {valuation.total.unvaluedLines === 1
                    ? "One batch has"
                    : `${valuation.total.unvaluedLines} batches have`}{" "}
                  no cost recorded — {valuation.total.unvaluedQuantity} in all.
                  The total above is short by whatever they are worth, which
                  nobody has said. Raised stock has no purchase price, so this is
                  ordinary rather than a mistake.
                </p>
              </>
            ) : (
              <>
                <div className="text-2xl font-semibold text-muted-foreground">
                  Nothing
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every batch on hand carries a cost, so the figure beside this
                  is the whole of it.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {valuation.rows.length === 0 ? (
        <EmptyState
          title="Nothing on hand"
          description="Receive some stock and what it cost will stand here."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Batch by batch</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>What</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead>How it was valued</TableHead>
                    <TableHead className="text-right">Worth</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {valuation.rows.map((row) => (
                    <TableRow key={`${row.itemId}:${row.lotId ?? ""}`}>
                      <TableCell>
                        <Link
                          href={`${BASE}/${row.itemId}`}
                          className="hover:underline"
                        >
                          {row.itemName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.lotCode ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.quantity} {row.unit}
                      </TableCell>
                      <TableCell>
                        {/* A reader is entitled to know which of the three
                            they are looking at: one is measured, one is an
                            average over a fungible item, one is an admission. */}
                        <Badge
                          variant={
                            row.method === "none" ? "destructive" : "secondary"
                          }
                        >
                          {VALUATION_METHOD_NOTES[row.method].label}
                        </Badge>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {VALUATION_METHOD_NOTES[row.method].note}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.valueCents === null ? (
                          <span className="text-muted-foreground">
                            Not known
                          </span>
                        ) : (
                          formatMoney(row.valueCents, currencySymbol)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
