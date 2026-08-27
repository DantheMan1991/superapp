import Link from "next/link";
import { Coins } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
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
import { InventoryNav } from "@/packs/inventory/components/inventory-nav";
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
  const asOf =
    typeof query.asOf === "string" && query.asOf ? query.asOf : today;

  const valuation = await withTenant(
    ctx.tenant.id,
    (tx) => valueStock(tx, ctx.tenant.id, { asOf }),
    { role: ctx.role },
  );

  return (
    <div className="space-y-6">
      {/* The hand-rolled `‹ Inventory` link that used to sit beside the picker
          is gone: the strip below goes everywhere it went, from every page in
          the pack rather than only this one. */}
      <PageHeader
        title="What it is worth"
        description="The cost standing in stock on hand. Not what it would sell for — what it cost to have."
        icon={<Coins />}
        actions={<AsOfPicker asOf={asOf} today={today} />}
      />

      <InventoryNav isOwner={ctx.role === "owner"} />

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label={`On hand at ${asOf}`}
          value={formatMoney(valuation.total.valueCents, currencySymbol)}
          footnote={
            valuation.total.valuedLines === 0
              ? "Nothing on hand that anybody has costed."
              : `Across ${valuation.total.valuedLines} ${
                  valuation.total.valuedLines === 1 ? "line" : "lines"
                } of stock.`
          }
        />

        {/**
         * NEVER LET THE TOTAL TRAVEL ALONE. Understated by an unknown amount is
         * a different fact from understated by nothing.
         *
         * The old card carried a `TriangleAlert` glyph and a `border-destructive/40`
         * edge. Both are dropped, and the `tone` carries it instead: the panel
         * is elevated rather than outlined under this design, so an extra
         * border draws the boundary twice — and the figure is the thing that
         * should be red, not the box around it.
         */}
        <StatCard
          label="What this figure leaves out"
          value={
            valuation.total.incomplete
              ? valuation.total.unvaluedLines
              : "Nothing"
          }
          tone={valuation.total.incomplete ? "destructive" : "default"}
          footnote={
            valuation.total.incomplete
              ? `${
                  valuation.total.unvaluedLines === 1
                    ? "One batch has"
                    : `${valuation.total.unvaluedLines} batches have`
                } no cost recorded — ${valuation.total.unvaluedQuantity} in all. The stock total is short by whatever they are worth, which nobody has said. Raised stock has no purchase price, so this is ordinary rather than a mistake.`
              : "Every batch on hand carries a cost, so the stock total is the whole of it."
          }
        />
      </div>

      <section>
        <h2 className="mb-3 font-heading text-xl font-semibold tracking-heading">
          Batch by batch
        </h2>
        {/* `DataTable` scrolls its own overflow, so the hand-rolled
            `overflow-x-auto` wrapper that used to sit here is gone. */}
        <DataTable
          isEmpty={valuation.rows.length === 0}
          empty={
            <EmptyState
              title="Nothing on hand"
              description="Receive some stock and what it cost will stand here."
            />
          }
        >
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
                      <span className="text-muted-foreground">Not known</span>
                    ) : (
                      formatMoney(row.valueCents, currencySymbol)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTable>
      </section>
    </div>
  );
}
