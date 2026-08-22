import Link from "next/link";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
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
import {
  grniPosition,
  inventoryTreatmentOf,
  matchableBillLines,
  unbilledReceipts,
} from "@/packs/inventory/ledger-ops";
import {
  MatchDialog,
  TreatmentControl,
  UnmatchButton,
} from "@/packs/inventory/components/matching-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/inventory";

/**
 * **WHAT HAS ARRIVED AND WHAT HAS BEEN INVOICED FOR IT.**
 *
 * The screen the posting engine has been waiting for. Everything here was
 * reachable only from ops until now, which is why this page is also the first
 * time anybody can turn posting ON at all.
 *
 * The two halves are deliberately on one page rather than two: "deliveries with
 * no invoice" and "bill lines with no delivery" are the same question asked from
 * opposite ends, and the whole value of GRNI is seeing them together. A
 * reconciliation split across two screens is one nobody completes.
 */
export default async function InventoryMatchingPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "inventory");

  const currencySymbol = ctx.tenant.currencySymbol;
  const isOwner = ctx.role === "owner";

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [treatment, position, open, lines] = await Promise.all([
        inventoryTreatmentOf(tx, ctx.tenant.id),
        grniPosition(tx, ctx.tenant.id),
        unbilledReceipts(tx, ctx.tenant.id, { limit: 100 }),
        matchableBillLines(tx, ctx.tenant.id),
      ]);
      return { treatment, position, open, lines };
    },
    { role: ctx.role },
  );

  const { treatment, position, open, lines } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deliveries and invoices"
        description="What has arrived, what has been billed for it, and the gap between the two."
        actions={
          <Link
            href={BASE}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Inventory
          </Link>
        }
      />

      <TreatmentControl treatment={treatment} isOwner={isOwner} />

      {treatment === "capitalise" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Arrived, not yet invoiced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatMoney(position.accountCents, currencySymbol)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {/* THE ACCOUNT IS THE HEADLINE, because the account is the answer.
                  The deliveries are the working, and the two are shown together
                  precisely so a difference is visible instead of assumed away. */}
              What Goods Received Not Invoiced is holding.{" "}
              {position.awaitingInvoiceCount === 0
                ? "Every priced delivery has an invoice against it."
                : `${position.awaitingInvoiceCount} ${
                    position.awaitingInvoiceCount === 1
                      ? "delivery is"
                      : "deliveries are"
                  } waiting for one, worth ${formatMoney(
                    position.awaitingInvoiceCents,
                    currencySymbol,
                  )}.`}
            </p>
            {position.differenceCents !== 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {formatMoney(
                    Math.abs(position.differenceCents),
                    currencySymbol,
                  )}{" "}
                  of that never reached the books.
                </span>{" "}
                Almost always deliveries recorded before stock went on the
                balance sheet — switching it on does not go back and rewrite
                them. They can still be matched to a bill; they just have
                nothing to clear.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {treatment === "none"
              ? "Bills that could be matched, once stock is on the balance sheet"
              : "Bills waiting to be matched"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <EmptyState
              title="No draft bills"
              description="A bill can only be matched while it is still a draft — once it is approved its entry has posted, and changing what the bill says would not change what was posted."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Line</TableHead>
                    <TableHead className="text-right">Charged</TableHead>
                    <TableHead>Matched</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.billLineId}>
                      <TableCell>
                        <Link
                          href={`/dashboard/m/accounting/purchases/bills/${line.billId}`}
                          className="hover:underline"
                        >
                          {line.vendorName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {line.billNumber || line.billDate}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {line.description || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(line.invoiceCents, currencySymbol)}
                      </TableCell>
                      <TableCell>
                        {line.matchedCount === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            Nothing yet
                          </span>
                        ) : (
                          <Badge variant="secondary">
                            {line.matchedCount}{" "}
                            {line.matchedCount === 1 ? "delivery" : "deliveries"}
                            {" · "}
                            {formatMoney(line.matchedCents, currencySymbol)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Matching is refused while posting is off — a bill
                            cannot settle a balance no delivery created — so the
                            button is absent rather than present and failing. */}
                        {isOwner && treatment === "capitalise" && (
                          <div className="flex items-center justify-end gap-1">
                            <MatchDialog
                              billLineId={line.billLineId}
                              vendorName={line.vendorName}
                              description={line.description}
                              invoiceCents={line.invoiceCents}
                              currencySymbol={currencySymbol}
                              deliveries={open}
                            />
                            {line.matchedCount > 0 && (
                              <UnmatchButton billLineId={line.billLineId} />
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {treatment === "none"
              ? "Priced deliveries"
              : "Deliveries with no invoice yet"}
          </CardTitle>
          {treatment === "none" && (
            <p className="text-xs text-muted-foreground">
              {/* WITH POSTING OFF THIS IS NOT A RECONCILIATION, and calling it
                  one would be the screen claiming the books know something they
                  do not. Nothing here has reached the ledger. */}
              None of these have reached the books, because stock is not on the
              balance sheet for this business. This is what would be waiting for
              an invoice if it were.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {/* A delivery with no PRICE is a different fact and belongs on the
                  valuation screen's caveat card, not here — it credited nothing,
                  so there is nothing for a bill to clear against it. */}
              Nothing waiting. A delivery recorded without a price does not
              appear here at all — it has no cost for an invoice to settle, and
              shows on{" "}
              <Link href={`${BASE}/value`} className="underline">
                what it is worth
              </Link>{" "}
              instead.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead className="text-right">Still open</TableHead>
                    <TableHead className="text-right">Worth</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {open.map((row) => (
                    <TableRow key={row.movementId}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {row.occurredOn}
                      </TableCell>
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
                        {row.openQuantity} {row.unit}
                        {row.matchedQuantity > 0 && (
                          <span className="text-muted-foreground">
                            {" "}
                            of {row.quantity}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.openCostCents, currencySymbol)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {treatment === "capitalise" && position.awaitingInvoiceCount > 0 && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            A standing balance here is ordinary — stock usually arrives before
            its invoice. It is worth a look when a delivery has been waiting
            longer than a supplier normally takes to bill, because that is either
            an invoice nobody entered or one that never came.
          </span>
        </p>
      )}
    </div>
  );
}
